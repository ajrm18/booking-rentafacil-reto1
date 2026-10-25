import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, LessThanOrEqual } from 'typeorm';
import { Vehicle } from '../autos/entities/vehicle.entity';
import { aEstadoV2, unidadesDisponibles } from '../autos/estado-vehiculo.mapper';
import { OutboxService } from './outbox.service';
import { EVENTOS, NODO } from './nodo';
import { StockCacheService, StockUpdateMessage } from './grpc/stock-cache.service';
import { StockPushClient } from './grpc/stock-push.client';

/** Fecha (YYYY-MM-DD) y franja de 30 min de un instante, en hora de Ecuador (UTC-5). */
export function fechaYFranja(d: Date): { date: string; time_slot: string } {
  const local = new Date(d.getTime() - 5 * 60 * 60 * 1000);
  const iso = local.toISOString();
  const min = local.getUTCMinutes() < 30 ? '00' : '30';
  return { date: iso.slice(0, 10), time_slot: `${iso.slice(11, 13)}:${min}` };
}

/**
 * Efectos de integracion de un cambio de inventario: evento stock.actualizado en el outbox (misma
 * transaccion), push gRPC al Booking central y cache RAM propia. Tambien cierra los cooldowns de
 * limpieza vencidos (auto.cooldown.ended), en cada tick del worker y antes de cada busqueda.
 */
@Injectable()
export class InventarioService implements OnModuleInit {
  private readonly logger = new Logger('Inventario');

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly outbox: OutboxService,
    private readonly cache: StockCacheService,
    private readonly push: StockPushClient,
  ) {}

  onModuleInit(): void {
    this.outbox.alTick(() => this.liberarCooldownsVencidos());
  }

  /** Registra stock.actualizado dentro de la transaccion del cambio de estado. */
  async registrarCambio(
    m: EntityManager | null, v: Pick<Vehicle, 'vehicle_id' | 'status'>, motivo: string,
    correlationId?: string, cuando: Date = new Date(),
  ): Promise<void> {
    const { date, time_slot } = fechaYFranja(cuando);
    await this.outbox.registrar(m, EVENTOS.STOCK_ACTUALIZADO, {
      auto_id: v.vehicle_id,
      estado: aEstadoV2(v.status),
      available_units: unidadesDisponibles(v.status),
      date, time_slot, motivo,
    }, { subject: v.vehicle_id, correlationId });
  }

  /**
   * Despues del commit: cache propia + PushStockUpdate al Booking (sin bloquear la respuesta HTTP;
   * el push tiene su propio timeout de 5 s y circuit breaker).
   */
  notificarStock(v: Pick<Vehicle, 'vehicle_id' | 'status'>, cuando: Date = new Date()): void {
    const msg: StockUpdateMessage = {
      service_id: NODO.serviceId,
      item_id: v.vehicle_id,
      ...fechaYFranja(cuando),
      available_units: unidadesDisponibles(v.status),
      timestamp: Date.now(),
    };
    this.cache.upsert(msg);
    void this.push.push(msg);
  }

  /**
   * WASHING con wash_until vencido -> AVAILABLE (o MAINTENANCE si quedo pendiente un mantenimiento
   * preventivo), con auto.cooldown.ended + stock.actualizado. UPDATE condicionado: dos procesos
   * concurrentes no emiten el evento dos veces.
   */
  async liberarCooldownsVencidos(correlationId?: string): Promise<number> {
    const vencidos = await this.ds.getRepository(Vehicle).find({
      where: { status: 'WASHING', wash_until: LessThanOrEqual(new Date()) },
      select: { vehicle_id: true, wash_until: true, mantenimiento_requerido: true, status: true },
    });
    let liberados = 0;
    for (const v of vencidos) {
      const destino = v.mantenimiento_requerido ? 'MAINTENANCE' : 'AVAILABLE';
      const ok = await this.ds.transaction(async (m) => {
        const r = await m.createQueryBuilder().update(Vehicle)
          .set({ status: destino, wash_until: null })
          .where("vehicle_id = :id AND status = 'WASHING' AND wash_until <= NOW()", { id: v.vehicle_id })
          .execute();
        if (!r.affected) return false;
        await this.outbox.registrar(m, EVENTOS.COOLDOWN_TERMINADO, {
          auto_id: v.vehicle_id,
          estado_anterior: 'EN_LIMPIEZA',
          estado: aEstadoV2(destino),
          cooldown_minutos: 120,
          fin_cooldown: new Date(v.wash_until!).toISOString(),
        }, { subject: v.vehicle_id, correlationId });
        await this.registrarCambio(m, { vehicle_id: v.vehicle_id, status: destino }, 'cooldown.ended', correlationId);
        return true;
      });
      if (ok) {
        liberados++;
        this.notificarStock({ vehicle_id: v.vehicle_id, status: destino });
      }
    }
    if (liberados) this.logger.log(`${liberados} vehiculo(s) salieron del cooldown de limpieza`);
    return liberados;
  }
}

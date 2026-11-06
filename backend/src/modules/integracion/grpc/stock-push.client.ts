import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { log } from '../../../common/app-logger';
import { logError } from '../../../common/file-log';
import { claveConfigurada, httpSaliente } from '../../../common/http-saliente';
import { correlationActual } from '../../../common/request-context';
import { GrpcLog } from '../entities/grpc-log.entity';
import { inventoryProtoPath, PROTO_LOADER_OPTIONS } from './proto-path';
import { StockUpdateMessage } from './stock-cache.service';

export type EstadoCircuito = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

const DEADLINE_MS = 5000;          // tolerancia perimetral de 5 s del contrato
const FALLOS_PARA_ABRIR = 3;
const ENFRIAMIENTO_MS = 30_000;

/** slot-YYYYMMDD-HHMM (formato canonico de la guia de integracion §3). */
export const slotIdDe = (date: string, timeSlot: string) => `slot-${date.replace(/-/g, '')}-${timeSlot.replace(':', '')}`;

export interface ResultadoPush { ok: boolean; canal: 'GRPC' | 'REST_FALLBACK' | 'NONE'; detalle?: string }

/**
 * RentaFacil es CLIENTE gRPC del InventoryStockService del Booking central
 * (BOOKING_GRPC_HOST, p. ej. rda1-backend-integracion-sistemas.onrender.com:50051). Circuit
 * breaker: tras 3 fallos seguidos deja de intentar 30 s. Si gRPC falla o el circuito esta abierto,
 * hace fallback REST a BOOKING_REST_STOCK_URL. Cada push queda en db_inventory.grpc_log.
 *
 * Nota: el proto oficial (sin modificar) no declara slot_id; se calcula y se envia en el REST y
 * en los logs, y gRPC lo descarta al serializar.
 */
@Injectable()
export class StockPushClient implements OnModuleDestroy {
  readonly destino = (process.env.BOOKING_GRPC_HOST || process.env.BOOKING_GRPC_URL || '').trim();
  readonly restUrl = (process.env.BOOKING_REST_STOCK_URL || '').trim();
  private cliente: any = null;
  private fallos = 0;
  private abiertoHasta = 0;
  private ultimoError: string | null = null;

  constructor(@Optional() @InjectRepository(GrpcLog) private readonly bitacora?: Repository<GrpcLog>) {}

  get configurado(): boolean {
    return !!this.destino || !!this.restUrl;
  }

  get circuito(): EstadoCircuito {
    if (this.fallos < FALLOS_PARA_ABRIR) return 'CLOSED';
    return Date.now() < this.abiertoHasta ? 'OPEN' : 'HALF_OPEN';
  }

  get error(): string | null {
    return this.ultimoError;
  }

  /** Envia el mensaje; resuelve false (sin lanzar) si no hay destino o fallan gRPC y REST. */
  async push(msg: StockUpdateMessage): Promise<boolean> {
    return (await this.enviar(msg)).ok;
  }

  async enviar(msg: StockUpdateMessage): Promise<ResultadoPush> {
    const slotId = slotIdDe(msg.date, msg.time_slot);
    const etiqueta = `PushStockUpdate item=${msg.item_id} available=${msg.available_units}`;
    if (!this.configurado) {
      log.info('GRPC', `${etiqueta} -> SKIPPED (BOOKING_GRPC_HOST no configurado)`, { slot_id: slotId });
      void this.auditar(msg, slotId, 'NONE', 'SKIPPED', 'sin destino');
      return { ok: false, canal: 'NONE', detalle: 'sin destino' };
    }
    let motivo = 'gRPC no configurado';
    if (this.destino && this.circuito !== 'OPEN') {
      try {
        const ack = await this.llamar({ ...msg, slot_id: slotId } as any);
        this.fallos = 0; this.ultimoError = null;
        if (ack?.success !== false) {
          log.info('GRPC', `${etiqueta} -> ACK`, { slot_id: slotId, destino: this.destino, mensaje: ack?.message });
          void this.auditar(msg, slotId, 'GRPC', 'ACK', ack?.message ?? null);
          return { ok: true, canal: 'GRPC', detalle: ack?.message };
        }
        motivo = `NACK ${ack?.message ?? ''}`.trim();
        log.warn('GRPC', `${etiqueta} -> NACK`, { slot_id: slotId, mensaje: ack?.message });
      } catch (e: any) {
        this.fallos++;
        this.ultimoError = e?.message ?? String(e);
        if (this.fallos >= FALLOS_PARA_ABRIR) this.abiertoHasta = Date.now() + ENFRIAMIENTO_MS;
        motivo = this.ultimoError!;
        log.warn('GRPC', `${etiqueta} -> NACK`, { slot_id: slotId, destino: this.destino, error: this.ultimoError, circuito: this.circuito });
        await logError('grpc.PushStockUpdate', { destino: this.destino, mensaje: msg, error: this.ultimoError });
      }
    } else if (this.destino) {
      motivo = 'circuito gRPC abierto';
    }
    return this.fallbackRest(msg, slotId, motivo);
  }

  /** POST BOOKING_REST_STOCK_URL { item_id, available_units, date, reason } con X-API-Key. */
  private async fallbackRest(msg: StockUpdateMessage, slotId: string, motivo: string): Promise<ResultadoPush> {
    const etiqueta = `PushStockUpdate item=${msg.item_id} available=${msg.available_units}`;
    if (!this.restUrl) {
      void this.auditar(msg, slotId, 'GRPC', 'NACK', motivo);
      return { ok: false, canal: 'GRPC', detalle: motivo };
    }
    const clave = claveConfigurada(process.env.BOOKING_API_KEY);
    try {
      const r = await httpSaliente(this.restUrl, {
        headers: clave ? { 'X-API-Key': clave } : {},
        body: {
          service_id: msg.service_id, item_id: msg.item_id, available_units: msg.available_units, date: msg.date,
          time_slot: msg.time_slot, slot_id: slotId, timestamp: msg.timestamp,
          reason: msg.available_units ? 'STOCK_RELEASED' : 'ORDER_CREATED',
        },
        timeoutMs: DEADLINE_MS,
      });
      if (r.ok) {
        log.info('GRPC', `${etiqueta} -> ACK (fallback REST ${r.status})`, { slot_id: slotId, motivo_fallback: motivo, ms: r.ms });
        void this.auditar(msg, slotId, 'REST_FALLBACK', 'ACK', `HTTP ${r.status}`);
        return { ok: true, canal: 'REST_FALLBACK', detalle: `HTTP ${r.status}` };
      }
      log.warn('GRPC', `${etiqueta} -> NACK (fallback REST ${r.status})`, { slot_id: slotId });
      void this.auditar(msg, slotId, 'REST_FALLBACK', 'NACK', `HTTP ${r.status}`);
      await logError('rest.inventory.stock', { url: this.restUrl, mensaje: msg, status: r.status, body: r.body });
      return { ok: false, canal: 'REST_FALLBACK', detalle: `HTTP ${r.status}` };
    } catch (e: any) {
      log.warn('GRPC', `${etiqueta} -> NACK (fallback REST ${e?.status ?? 'ERROR'})`, { slot_id: slotId, error: e?.message });
      void this.auditar(msg, slotId, 'REST_FALLBACK', 'NACK', e?.message ?? 'error');
      await logError('rest.inventory.stock', { url: this.restUrl, mensaje: msg, error: e?.message });
      return { ok: false, canal: 'REST_FALLBACK', detalle: e?.message };
    }
  }

  private async auditar(msg: StockUpdateMessage, slotId: string, canal: string, resultado: string, detalle: string | null) {
    if (!this.bitacora) return;
    try {
      await this.bitacora.insert({
        item_id: msg.item_id, available_units: msg.available_units, date: msg.date, time_slot: msg.time_slot, slot_id: slotId,
        canal, resultado, detalle: detalle?.slice(0, 300) ?? null, correlation_id: correlationActual() ?? null,
      });
    } catch { /* la auditoria nunca rompe el push */ }
  }

  private llamar(msg: StockUpdateMessage): Promise<any> {
    if (!this.cliente) {
      const def = protoLoader.loadSync(inventoryProtoPath(), PROTO_LOADER_OPTIONS);
      const pkg: any = grpc.loadPackageDefinition(def).inventory;
      const tls = process.env.BOOKING_GRPC_TLS === 'true';
      this.cliente = new pkg.InventoryStockService(
        this.destino, tls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure(),
      );
    }
    return new Promise((resolve, reject) => {
      this.cliente.PushStockUpdate(msg, { deadline: new Date(Date.now() + DEADLINE_MS) },
        (err: Error | null, ack: any) => (err ? reject(err) : resolve(ack)));
    });
  }

  onModuleDestroy(): void {
    this.cliente?.close?.();
  }
}

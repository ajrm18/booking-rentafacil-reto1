import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { HealthV2Service } from '../autos-v2/health-v2.service';
import { StockPushClient } from '../integracion/grpc/stock-push.client';
import { NODO } from '../integracion/nodo';
import { BookingNotifierService } from './booking-notifier.service';
import { VERSION_V3 } from './v3';

/**
 * GET /api/v3/health y /api/v3/autos/health (semaforo LED del Booking, < 500 ms).
 * Reusa la consulta de v2 (presupuesto de 400 ms a la BD) y agrega el estado del Booking central
 * y el outbox de notificaciones. Nunca hace llamadas de red salientes.
 *
 * Supabase (us-east-1) esta lejos de Azure brazilsouth: una conexion fria puede tardar mas que el
 * presupuesto. Por eso un refresco en segundo plano cada 10 s mantiene caliente el pool y deja
 * una instantanea; el endpoint responde con ella (< 50 ms) y solo consulta en vivo si es vieja.
 */
@Injectable()
export class HealthV3Service implements OnModuleInit, OnModuleDestroy {
  private snapshot: { at: number; h: Awaited<ReturnType<HealthV2Service['estado']>>; pendientes: number } | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly v2: HealthV2Service,
    private readonly push: StockPushClient,
    private readonly notificador: BookingNotifierService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    void this.refrescar();
    this.timer = setInterval(() => { void this.refrescar(); }, 10_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async refrescar() {
    const [h, pendientes] = await Promise.all([
      this.v2.estado(),
      Promise.race([this.notificador.contarPendientes(), new Promise<number>((r) => setTimeout(() => r(0), 300).unref())]),
    ]);
    // Una lectura fallida no pisa una buena reciente (salvo que tenga mas de 30 s)
    if (h.dependencias.base_datos === 'UP' || !this.snapshot || Date.now() - this.snapshot.at > 30_000) {
      this.snapshot = { at: Date.now(), h, pendientes };
    }
    return this.snapshot;
  }

  async estado() {
    const t0 = Date.now();
    const fresca = this.snapshot && Date.now() - this.snapshot.at < 15_000 ? this.snapshot : await this.refrescar();
    const { h, pendientes: notifPendientes } = fresca!;
    const notif = this.notificador.estado;
    const circuitoAbierto = this.push.circuito === 'OPEN' || notif.circuito === 'OPEN';
    const circuito = circuitoAbierto ? 'OPEN' : this.push.circuito === 'HALF_OPEN' || notif.circuito === 'HALF_OPEN' ? 'HALF_OPEN' : 'CLOSED';
    const booking = !notif.configurado && !this.push.configurado ? 'NOT_CONFIGURED' : circuitoAbierto ? 'DOWN' : 'UP';

    let status = h.status;
    if (status === 'HEALTHY' && circuitoAbierto) status = 'DEGRADED';

    return {
      status,
      nodo_id: process.env.NODE_ID || NODO.id,
      nombre_proveedor: process.env.PROVIDER_NAME || NODO.nombre,
      vertical: process.env.VERTICAL || NODO.vertical,
      version: VERSION_V3,
      uptime_seconds: Math.floor(process.uptime()),
      latencia_ms: Math.max(1, Date.now() - t0),
      latencia_bd_ms: h.latencia_ms,
      total_vehiculos: h.total_vehiculos,
      circuit_breaker_estado: circuito,
      cooldown_activo_count: h.cooldown_activo_count,
      dependencias: {
        base_datos: h.dependencias.base_datos,
        rabbitmq: h.dependencias.rabbitmq,
        booking_central: booking,
        grpc_push_booking: this.push.destino ? `${this.push.circuito} ${this.push.destino}` : 'NOT_CONFIGURED',
      },
      outbox_pendientes: (h.outbox_pendientes ?? 0) + notifPendientes,
      outbox_detalle: { eventos_rabbitmq: h.outbox_pendientes ?? 0, notificaciones_booking: notifPendientes },
      timestamp: new Date().toISOString(),
      ...(h.error && { error: h.error }),
    };
  }
}

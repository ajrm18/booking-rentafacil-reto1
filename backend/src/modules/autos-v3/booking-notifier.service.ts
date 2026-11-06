import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import CircuitBreaker = require('opossum');
import { log } from '../../common/app-logger';
import { logError } from '../../common/file-log';
import { claveConfigurada, httpSaliente, RespuestaSaliente } from '../../common/http-saliente';
import { conCorrelacion } from '../../common/request-context';
import { OutboxService } from '../integracion/outbox.service';
import { EVENTOS } from '../integracion/nodo';
import { BookingNotification } from './entities/booking-notification.entity';

/** Backoff exponencial de reintentos: 1 s, 5 s, 15 s, 1 min, 5 min (despues queda FAILED). */
export const BACKOFF_MS = [1_000, 5_000, 15_000, 60_000, 300_000];
export const TIMEOUT_MS = 5_000;

export const etiquetaEspera = (ms: number) => (ms >= 60_000 ? `${ms / 60_000}min` : `${ms / 1000}s`);

export interface DatosCheckin {
  order_id: string;
  pnr: string;
  client_id: string | null;
  admin_id: string;
  fecha_checkin: Date;
  correlationId: string;
}

export interface EstadoNotificador { configurado: boolean; circuito: 'CLOSED' | 'OPEN' | 'HALF_OPEN'; url: string | null }

class ErrorBooking extends Error {
  constructor(message: string, readonly status: number, readonly body?: any) { super(message); }
}

/**
 * Notificacion fire-and-forget del check-in de entrega al Booking central:
 *   POST {BOOKING_CHECKIN_URL}/{external_order_id}/checkin
 * Nunca bloquea ni hace fallar el check-in local. Cada notificacion se guarda primero en
 * db_outbox.outbox_booking_notifications; si el Booking falla (timeout, 4xx, 5xx o
 * acknowledged != true) un worker reintenta con backoff exponencial. Circuit breaker Opossum
 * (timeout 5 s). El resultado sale como CloudEvent auto.checkin.notified (success | failed).
 */
@Injectable()
export class BookingNotifierService implements OnModuleInit, OnModuleDestroy {
  private readonly breaker: CircuitBreaker<[BookingNotification], RespuestaSaliente>;
  private timer: NodeJS.Timeout | null = null;
  private procesando = false;

  constructor(
    @InjectRepository(BookingNotification) private readonly repo: Repository<BookingNotification>,
    private readonly outbox: OutboxService,
  ) {
    this.breaker = new CircuitBreaker((n: BookingNotification) => this.post(n), {
      timeout: TIMEOUT_MS,
      errorThresholdPercentage: 50,
      volumeThreshold: 3,
      resetTimeout: 30_000,
    });
    this.breaker.on('open', () => log.warn('BOOKING-NOTIFY', 'circuit breaker -> OPEN (Booking central no responde)'));
    this.breaker.on('halfOpen', () => log.info('BOOKING-NOTIFY', 'circuit breaker -> HALF_OPEN'));
    this.breaker.on('close', () => log.info('BOOKING-NOTIFY', 'circuit breaker -> CLOSED'));
  }

  /** Base: BOOKING_CHECKIN_URL o BOOKING_BASE_URL + /reservas. */
  get baseUrl(): string | null {
    const directo = (process.env.BOOKING_CHECKIN_URL || '').trim();
    if (directo) return directo.replace(/\/+$/, '');
    const base = (process.env.BOOKING_BASE_URL || '').trim();
    return base ? `${base.replace(/\/+$/, '')}/reservas` : null;
  }

  get estado(): EstadoNotificador {
    const c = this.breaker.opened ? 'OPEN' : this.breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED';
    return { configurado: !!this.baseUrl, circuito: c, url: this.baseUrl };
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.BOOKING_NOTIFY_WORKER === 'off') return;
    this.timer = setInterval(() => { void this.procesarPendientes(); }, 1_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.breaker.shutdown();
  }

  /** Cuerpo exacto del requerimiento v3.1 (Bloque 4). */
  static cuerpo(d: DatosCheckin) {
    return {
      external_order_id: d.pnr,
      client_id: d.client_id,
      estado: 'CONFIRMADO_ASISTIDO',
      admin_id: d.admin_id,
      fecha_checkin: d.fecha_checkin.toISOString(),
      observaciones: 'Vehiculo entregado fisicamente con contrato y licencia validada',
    };
  }

  /**
   * Registra la notificacion y dispara el primer intento SIN esperarlo. Devuelve el registro
   * (o null si el Booking no esta configurado). Nunca lanza.
   */
  async notificarCheckin(d: DatosCheckin): Promise<BookingNotification | null> {
    try {
      const base = this.baseUrl;
      if (!base) {
        log.warn('BOOKING-NOTIFY', `checkin ${d.pnr} -> NOT_CONFIGURED (sin BOOKING_CHECKIN_URL)`, { correlation: d.correlationId });
        return null;
      }
      const n = await this.repo.save(this.repo.create({
        tipo: 'CHECKIN_ENTREGA',
        order_id: d.order_id,
        external_order_id: d.pnr,
        url: `${base}/${encodeURIComponent(d.pnr)}/checkin`,
        payload: BookingNotifierService.cuerpo(d),
        correlation_id: d.correlationId,
        status: 'PENDING',
        attempts: 0,
        // Margen para el primer intento en vuelo; si el proceso muere antes, el worker lo retoma
        next_attempt_at: new Date(Date.now() + 10_000),
      }));
      void this.intentar(n); // fire-and-forget
      return n;
    } catch (e: any) {
      log.error('BOOKING-NOTIFY', `no se pudo registrar la notificacion de ${d.pnr}`, { error: e?.message, correlation: d.correlationId });
      await logError('booking.checkin.registrar', { pnr: d.pnr, error: e?.message });
      return null;
    }
  }

  /** Un intento de envio con su efecto (SENT / reintento / FAILED). Nunca lanza. */
  async intentar(n: BookingNotification): Promise<'SENT' | 'RETRY' | 'FAILED'> {
    return conCorrelacion(n.correlation_id ?? n.id, async () => {
      const ruta = `POST /reservas/${n.external_order_id}/checkin`;
      const intento = n.attempts + 1;
      try {
        const r = await this.breaker.fire(n);
        await this.repo.update({ id: n.id }, {
          status: 'SENT', attempts: intento, sent_at: new Date(), next_attempt_at: null,
          last_status_code: r.status, last_error: null, respuesta: r.body ?? null,
        });
        log.info('BOOKING-NOTIFY', `${ruta} -> ${r.status} OK`, { correlation: n.correlation_id, intento, ms: r.ms, status_booking: r.body?.status });
        await this.emitir(n, 'success', r.status, intento);
        return 'SENT';
      } catch (e: any) {
        const status = e instanceof ErrorBooking ? e.status : e?.code === 'EOPENBREAKER' ? 503 : e?.code === 'ETIMEDOUT' ? 504 : e?.status ?? 502;
        const espera = BACKOFF_MS[n.attempts]; // n.attempts reintentos ya hechos
        const agotado = espera === undefined;
        await this.repo.update({ id: n.id }, {
          status: agotado ? 'FAILED' : 'PENDING', attempts: intento, last_status_code: status,
          last_error: String(e?.message ?? e).slice(0, 300), respuesta: e?.body ?? null,
          next_attempt_at: agotado ? null : new Date(Date.now() + espera),
        });
        if (agotado) {
          log.error('BOOKING-NOTIFY', `${ruta} -> ERROR ${status} | reintentos agotados`, { correlation: n.correlation_id, intento });
        } else {
          log.warn('BOOKING-NOTIFY', `${ruta} -> ERROR ${status} | retry_in=${etiquetaEspera(espera)}`, { correlation: n.correlation_id, intento, error: String(e?.message ?? e).slice(0, 120) });
        }
        await logError('booking.checkin', { url: n.url, pnr: n.external_order_id, status, intento, error: e?.message, correlation_id: n.correlation_id });
        if (intento === 1 || agotado) await this.emitir(n, 'failed', status, intento, !agotado);
        return agotado ? 'FAILED' : 'RETRY';
      }
    });
  }

  /** Worker: reintenta las notificaciones cuyo backoff ya vencio. */
  async procesarPendientes(): Promise<number> {
    if (this.procesando) return 0;
    this.procesando = true;
    try {
      const pendientes = await this.repo.find({
        where: { status: 'PENDING', next_attempt_at: LessThanOrEqual(new Date()) },
        order: { created_at: 'ASC' }, take: 20,
      });
      for (const n of pendientes) await this.intentar(n);
      return pendientes.length;
    } catch (e: any) {
      log.warn('BOOKING-NOTIFY', `worker: ${e?.message}`);
      return 0;
    } finally {
      this.procesando = false;
    }
  }

  async contarPendientes(): Promise<number> {
    try { return await this.repo.count({ where: { status: 'PENDING' } }); } catch { return 0; }
  }

  async deOrden(orderId: string): Promise<BookingNotification | null> {
    return this.repo.findOne({ where: { order_id: orderId }, order: { created_at: 'DESC' } });
  }

  /** POST real al Booking; exito solo con 2xx y { acknowledged: true }. */
  private async post(n: BookingNotification): Promise<RespuestaSaliente> {
    const clave = claveConfigurada(process.env.BOOKING_API_KEY);
    const r = await httpSaliente(n.url, {
      method: 'POST',
      headers: { ...(clave ? { 'X-API-Key': clave } : {}), 'Idempotency-Key': n.id },
      body: n.payload,
      timeoutMs: TIMEOUT_MS,
      correlationId: n.correlation_id ?? undefined,
    });
    if (!r.ok) throw new ErrorBooking(`HTTP ${r.status}`, r.status, r.body);
    if (r.body?.acknowledged !== true) throw new ErrorBooking('respuesta sin acknowledged=true', r.status, r.body);
    return r;
  }

  private async emitir(n: BookingNotification, resultado: 'success' | 'failed', status: number, intento: number, reintentara = false) {
    try {
      await this.outbox.registrar(null, EVENTOS.CHECKIN_NOTIFICADO, {
        resultado, order_id: n.order_id, pnr: n.external_order_id, client_id: n.payload?.client_id ?? null,
        estado: 'CONFIRMADO_ASISTIDO', http_status: status, intento, reintentara, destino: n.url,
      }, { subject: n.order_id, correlationId: n.correlation_id ?? undefined });
    } catch { /* el outbox caido no afecta al check-in */ }
  }
}

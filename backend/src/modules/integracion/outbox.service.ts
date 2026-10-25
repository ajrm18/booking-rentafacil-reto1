import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { OutboxEvent } from './entities/outbox-event.entity';
import { EventBusService } from './event-bus.service';
import { ceTypeDe, NODO, TipoEvento } from './nodo';

const LOTE = 50;
const MAX_INTENTOS = 5;

export interface OpcionesEvento { subject?: string; correlationId?: string }

/**
 * Transactional Outbox + worker de publicacion. `registrar` se llama con el EntityManager de la
 * transaccion que cambia el estado (orden/vehiculo), de modo que el evento existe si y solo si el
 * cambio se confirmo. El worker lee la tabla cada OUTBOX_INTERVAL_MS (5 s) y publica en RabbitMQ.
 */
@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Outbox');
  private timer: NodeJS.Timeout | null = null;
  private procesando = false;
  /** Tareas periodicas extra que comparten el tick del worker (vencimiento de cooldowns). */
  private readonly tareas: Array<() => Promise<unknown>> = [];

  constructor(
    @InjectRepository(OutboxEvent) private readonly repo: Repository<OutboxEvent>,
    private readonly bus: EventBusService,
  ) {}

  onModuleInit(): void {
    // En pruebas el worker no corre solo: los tests llaman a tick() cuando lo necesitan
    if (process.env.NODE_ENV === 'test' || process.env.OUTBOX_WORKER === 'off') return;
    const cada = Number(process.env.OUTBOX_INTERVAL_MS) || 5000;
    this.timer = setInterval(() => { void this.tick(); }, cada);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  alTick(tarea: () => Promise<unknown>): void {
    this.tareas.push(tarea);
  }

  async registrar(
    manager: EntityManager | null, routingKey: TipoEvento, data: Record<string, any>, opts: OpcionesEvento = {},
  ): Promise<OutboxEvent> {
    const repo = manager ? manager.getRepository(OutboxEvent) : this.repo;
    return repo.save(repo.create({
      event_id: `evt-car-${randomUUID().slice(0, 13)}`,
      routing_key: routingKey,
      ce_type: ceTypeDe(routingKey),
      source: NODO.ceSource,
      subject: opts.subject ?? null,
      correlation_id: opts.correlationId ?? null,
      data: { ...data, nodo_id: NODO.id },
      publish_status: 'PENDING',
    }));
  }

  /** Sobre CloudEvents v1.0 (modo estructurado) con la extension correlation_id del contrato. */
  aCloudEvent(e: OutboxEvent): Record<string, any> {
    return {
      specversion: '1.0',
      type: e.ce_type,
      source: e.source,
      id: e.event_id,
      time: new Date(e.time).toISOString(),
      ...(e.subject && { subject: e.subject }),
      correlation_id: e.correlation_id ?? e.event_id,
      datacontenttype: 'application/json',
      data: e.data,
    };
  }

  /**
   * Feed de GET /autos/eventos en orden de insercion. Sin `after` devuelve los ultimos `limit`
   * eventos; con `after` (id de un evento) los siguientes, para que un consumidor avance el cursor.
   */
  async feed(limit: number, after?: string): Promise<{ events: any[]; total: number }> {
    const take = Math.min(Math.max(Math.trunc(limit) || 10, 1), 100);
    let filas: OutboxEvent[];
    if (after) {
      const ref = await this.repo.findOne({ where: { event_id: after } });
      filas = ref
        ? await this.repo.find({ where: { seq: MoreThan(ref.seq) }, order: { seq: 'ASC' }, take })
        : [];
    } else {
      filas = (await this.repo.find({ order: { seq: 'DESC' }, take })).reverse();
    }
    const total = await this.repo.count();
    return {
      total,
      events: filas.map((e) => ({
        ...this.aCloudEvent(e),
        routing_key: e.routing_key,
        exchange: 'booking.events',
        publish_status: e.publish_status,
        published_at: e.published_at ? new Date(e.published_at).toISOString() : null,
        attempts: e.attempts,
      })),
    };
  }

  async contarPendientes(): Promise<number> {
    return this.repo.count({ where: { publish_status: 'PENDING' } });
  }

  /** Un ciclo del worker: tareas periodicas y luego publicacion de los eventos pendientes. */
  async tick(): Promise<number> {
    if (this.procesando) return 0;
    this.procesando = true;
    try {
      for (const t of this.tareas) await t().catch((e) => this.logger.warn(`Tarea periodica: ${e?.message}`));
      return await this.publicarPendientes();
    } catch (e: any) {
      this.logger.warn(`Worker outbox: ${e?.message}`);
      return 0;
    } finally {
      this.procesando = false;
    }
  }

  private async publicarPendientes(): Promise<number> {
    const pendientes = await this.repo.find({
      where: { publish_status: 'PENDING', attempts: LessThanOrEqual(MAX_INTENTOS) },
      order: { seq: 'ASC' }, take: LOTE,
    });
    if (pendientes.length === 0) return 0;

    if (!this.bus.habilitado) {
      // Modo degradado: sin broker, el evento queda registrado en el log y en el feed
      for (const e of pendientes) this.logger.log(`[${e.routing_key}] ${JSON.stringify(this.aCloudEvent(e))}`);
      await this.repo.update({ seq: In(pendientes.map((e) => e.seq)) }, { publish_status: 'LOGGED', published_at: new Date() });
      return pendientes.length;
    }

    let publicados = 0;
    for (const e of pendientes) {
      try {
        await this.bus.publicar(e.routing_key, this.aCloudEvent(e));
        await this.repo.update({ seq: e.seq }, { publish_status: 'PUBLISHED', published_at: new Date(), attempts: e.attempts + 1 });
        publicados++;
      } catch (err: any) {
        const intentos = e.attempts + 1;
        await this.repo.update({ seq: e.seq }, {
          attempts: intentos,
          last_error: String(err?.message ?? err).slice(0, 300),
          publish_status: intentos >= MAX_INTENTOS ? 'FAILED' : 'PENDING',
        });
        break; // broker caido: se reintenta en el siguiente tick, respetando el orden
      }
    }
    return publicados;
  }
}

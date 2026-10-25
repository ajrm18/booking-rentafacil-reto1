import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as amqp from 'amqplib';
import { EVENTOS, EXCHANGE_EVENTOS } from './nodo';

export type EstadoBus = 'DISABLED' | 'CONNECTED' | 'DISCONNECTED';

const DLX = `${EXCHANGE_EVENTOS}.dlx`;
const RECONEXION_MS = 15_000;

/**
 * Publicador AMQP hacia el exchange topic `booking.events` (RabbitMQ compartido con el Booking).
 *
 * Se usa amqplib directamente: el ClientProxy RMQ de @nestjs/microservices 10 publica en una cola
 * y no en un exchange topic con routing key, que es lo que exige el contrato.
 * Sin RABBITMQ_URL el bus queda deshabilitado (modo degradado): el OutboxWorker solo registra
 * los eventos en el log y /autos/health lo informa.
 */
@Injectable()
export class EventBusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('EventBus');
  private readonly url = process.env.RABBITMQ_URL?.trim() || '';
  private conexion: amqp.ChannelModel | null = null;
  private canal: amqp.ConfirmChannel | null = null;
  private conectando: Promise<void> | null = null;
  private siguienteIntento = 0;

  /** Conecta y declara exchange/colas al arrancar (sin bloquear el arranque si el broker no responde). */
  onModuleInit(): void {
    if (this.habilitado) void this.asegurarConexion();
  }

  get habilitado(): boolean {
    return !!this.url;
  }

  get estado(): EstadoBus {
    if (!this.habilitado) return 'DISABLED';
    return this.canal ? 'CONNECTED' : 'DISCONNECTED';
  }

  /** Publica un CloudEvent (modo estructurado, application/cloudevents+json) con confirmacion del broker. */
  async publicar(routingKey: string, evento: Record<string, any>): Promise<void> {
    const canal = await this.obtenerCanal();
    const cuerpo = Buffer.from(JSON.stringify(evento));
    await new Promise<void>((resolve, reject) => {
      canal.publish(EXCHANGE_EVENTOS, routingKey, cuerpo, {
        persistent: true,
        contentType: 'application/cloudevents+json',
        messageId: evento.id,
        timestamp: Math.floor(Date.now() / 1000),
        correlationId: evento.correlation_id,
        headers: { 'ce-specversion': evento.specversion, 'ce-type': evento.type, 'ce-source': evento.source },
      }, (err) => (err ? reject(err) : resolve()));
    });
  }

  /** Intenta conectar sin lanzar (lo usa el worker para reflejar el estado en /health). */
  async asegurarConexion(): Promise<void> {
    if (!this.habilitado || this.canal) return;
    await this.obtenerCanal().catch(() => undefined);
  }

  private async obtenerCanal(): Promise<amqp.ConfirmChannel> {
    if (!this.habilitado) throw new Error('RabbitMQ deshabilitado (sin RABBITMQ_URL)');
    if (this.canal) return this.canal;
    if (!this.conectando) {
      if (Date.now() < this.siguienteIntento) throw new Error('RabbitMQ no disponible; se reintentara');
      this.conectando = this.conectar().finally(() => { this.conectando = null; });
    }
    await this.conectando;
    if (!this.canal) throw new Error('RabbitMQ no disponible');
    return this.canal;
  }

  private async conectar(): Promise<void> {
    try {
      const conexion = await amqp.connect(this.url, { timeout: 5000 });
      const canal = await conexion.createConfirmChannel();
      await canal.assertExchange(EXCHANGE_EVENTOS, 'topic', { durable: true });
      await canal.assertExchange(DLX, 'fanout', { durable: true });
      await canal.assertQueue('q.dead_letter', { durable: true });
      await canal.bindQueue('q.dead_letter', DLX, '');
      // Colas del diagrama (q.<routing key>) para que los eventos no se pierdan sin consumidores
      for (const rk of Object.values(EVENTOS)) {
        const cola = `q.${rk}`;
        await canal.assertQueue(cola, { durable: true, arguments: { 'x-dead-letter-exchange': DLX } });
        await canal.bindQueue(cola, EXCHANGE_EVENTOS, rk);
      }
      const caida = (motivo: string) => {
        if (this.conexion !== conexion) return;
        this.logger.warn(`Conexion con RabbitMQ perdida: ${motivo}`);
        this.conexion = null; this.canal = null;
        conexion.close().catch(() => undefined);
      };
      // Sin manejadores, un 'error' de la conexion o del canal tumbaria el proceso
      conexion.on('close', () => caida('close'));
      conexion.on('error', (e) => caida(e?.message ?? 'error'));
      canal.on('error', (e) => caida(`canal: ${e?.message ?? 'error'}`));
      canal.on('close', () => caida('canal cerrado'));
      this.conexion = conexion; this.canal = canal;
      this.logger.log(`Conectado a RabbitMQ, exchange ${EXCHANGE_EVENTOS} (topic, durable)`);
    } catch (e: any) {
      this.siguienteIntento = Date.now() + RECONEXION_MS;
      this.logger.warn(`No se pudo conectar a RabbitMQ: ${e?.message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    const c = this.conexion;
    this.conexion = null; this.canal = null;
    await c?.close().catch(() => undefined);
  }
}

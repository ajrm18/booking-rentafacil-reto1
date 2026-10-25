import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type EstadoPublicacion = 'PENDING' | 'PUBLISHED' | 'LOGGED' | 'FAILED';

/**
 * Transactional Outbox (schema_outbox del diagrama de arquitectura): cada evento de negocio se
 * inserta aqui en la misma transaccion que el cambio de estado, y el OutboxWorker lo publica en
 * RabbitMQ (exchange booking.events) cada 5 s. GET /api/v2/autos/eventos expone esta tabla.
 *
 * Vive en el schema public: synchronize de TypeORM no crea schemas de Postgres en el arranque
 * de Render, asi que "schema_outbox" es una agrupacion logica.
 */
@Entity('outbox_events')
export class OutboxEvent {
  /** Orden total de insercion: cursor del feed (?after=). */
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  seq: string;

  /** id del CloudEvent (evt-car-...). */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 60, name: 'event_id' })
  event_id: string;

  /** Routing key en booking.events (auto.order.confirmed, stock.actualizado, ...). */
  @Index()
  @Column({ type: 'varchar', length: 60, name: 'routing_key' })
  routing_key: string;

  /** Atributo `type` del CloudEvent (ec.edu.epn.booking.autos.order.confirmed, ...). */
  @Column({ type: 'varchar', length: 120, name: 'ce_type' })
  ce_type: string;

  @Column({ type: 'varchar', length: 120 })
  source: string;

  /** Recurso afectado (vehicle_id u order_id). */
  @Column({ type: 'varchar', length: 80, nullable: true })
  subject: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true, name: 'correlation_id' })
  correlation_id: string | null;

  @Column({ type: 'jsonb' })
  data: Record<string, any>;

  @CreateDateColumn({ type: 'timestamptz', name: 'time' })
  time: Date;

  @Index()
  @Column({ type: 'varchar', length: 12, default: 'PENDING', name: 'publish_status' })
  publish_status: EstadoPublicacion;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz', nullable: true, name: 'published_at' })
  published_at: Date | null;

  @Column({ type: 'varchar', length: 300, nullable: true, name: 'last_error' })
  last_error: string | null;
}

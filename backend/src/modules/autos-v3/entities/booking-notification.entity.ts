import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ESQUEMAS } from '../../../common/schemas';

export type EstadoNotificacion = 'PENDING' | 'SENT' | 'FAILED';

/**
 * Outbox de notificaciones HTTP al Booking central (db_outbox.outbox_booking_notifications):
 * el check-in local nunca espera al Booking; si el POST falla, el worker reintenta con backoff
 * exponencial 1 s, 5 s, 15 s, 1 min, 5 min.
 */
@Entity({ schema: ESQUEMAS.OUTBOX, name: 'outbox_booking_notifications' })
@Index(['status', 'next_attempt_at'])
export class BookingNotification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40 })
  tipo: string; // CHECKIN_ENTREGA

  @Index()
  @Column({ type: 'uuid' })
  order_id: string;

  @Column({ type: 'varchar', length: 40 })
  external_order_id: string;

  @Column({ type: 'text' })
  url: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  @Column({ type: 'varchar', length: 120, nullable: true })
  correlation_id: string | null;

  @Column({ type: 'varchar', length: 10, default: 'PENDING' })
  status: EstadoNotificacion;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  next_attempt_at: Date | null;

  @Column({ type: 'int', nullable: true })
  last_status_code: number | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  last_error: string | null;

  @Column({ type: 'jsonb', nullable: true })
  respuesta: any;

  @Column({ type: 'timestamptz', nullable: true })
  sent_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

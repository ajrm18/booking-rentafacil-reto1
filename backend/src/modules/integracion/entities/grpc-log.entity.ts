import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { ESQUEMAS } from '../../../common/schemas';

/** Auditoria de cada PushStockUpdate enviado al Booking central (db_inventory.grpc_log). */
@Entity({ schema: ESQUEMAS.INVENTORY, name: 'grpc_log' })
export class GrpcLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 40 })
  item_id: string;

  @Column({ type: 'int' })
  available_units: number;

  @Column({ type: 'varchar', length: 10 })
  date: string;

  @Column({ type: 'varchar', length: 5 })
  time_slot: string;

  @Column({ type: 'varchar', length: 30 })
  slot_id: string;

  /** GRPC | REST_FALLBACK | NONE */
  @Column({ type: 'varchar', length: 15 })
  canal: string;

  /** ACK | NACK | SKIPPED */
  @Column({ type: 'varchar', length: 10 })
  resultado: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  detalle: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  correlation_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

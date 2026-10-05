import {
  Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { ColumnNumericTransformer } from '../../../common/transformers/column-numeric.transformer';

/**
 * Orden de renta creada por POST /orders/create.
 * order_id es UUID (segun contrato components.schemas.OrderDetail.order_id).
 */
@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  order_id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 40 })
  locator: string;

  @Column({ type: 'varchar', length: 20, default: 'CONFIRMED' })
  status: 'CONFIRMED' | 'CANCELLED' | 'PENDING';

  @Column({ type: 'varchar', length: 40 })
  vehicle_id: string;

  @Column({ type: 'varchar', length: 200, nullable: true, name: 'owner_sub' })
  owner_sub: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  hold_id: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  order_preview_id: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  payment_reference: string;

  @Column({ type: 'jsonb' })
  vehicle_details: any;

  @Column({ type: 'jsonb' })
  route_details: any;

  @Column({ type: 'jsonb', nullable: true })
  driver_details: any;

  @Column({ type: 'jsonb', nullable: true, default: [] })
  extras: string[];

  @Column('numeric', { precision: 10, scale: 2, transformer: new ColumnNumericTransformer() })
  total_price: number;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  currency: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 60, nullable: true, name: 'idempotency_key' })
  idempotency_key: string;

  @CreateDateColumn({ name: 'creation_date' })
  creation_date: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at: Date;
}

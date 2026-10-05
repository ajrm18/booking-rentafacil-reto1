import {
  Column, CreateDateColumn, Entity, PrimaryColumn,
} from 'typeorm';
import { ColumnNumericTransformer } from '../../../common/transformers/column-numeric.transformer';

/**
 * Previsualizacion de una orden (POST /orders/preview) que congela el precio
 * hasta que el cliente confirme con POST /orders/create.
 */
@Entity('order_previews')
export class OrderPreview {
  @PrimaryColumn({ type: 'varchar', length: 60 })
  order_preview_id: string;

  @Column({ type: 'varchar', length: 40 })
  vehicle_id: string;

  @Column({ type: 'varchar', length: 200 })
  search_token: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  hold_id: string;

  @Column({ type: 'jsonb', nullable: true })
  route: any;

  @Column({ type: 'jsonb', nullable: true, default: [] })
  extras: string[];

  @Column('numeric', { precision: 10, scale: 2, transformer: new ColumnNumericTransformer() })
  total_price: number;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  currency: string;

  @Column({ type: 'jsonb' })
  breakdown: any;

  @Column({ type: 'smallint', default: 1 })
  total_days: number;

  @Column({ type: 'timestamp', name: 'expires_at' })
  expires_at: Date;

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;
}

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

  /** Devolucion del vehiculo (POST /admin/orders/{id}/return). La orden sigue CONFIRMED. */
  @Column({ type: 'timestamptz', nullable: true, name: 'returned_at' })
  returned_at: Date | null;

  /** `sub` del JWT del admin que registro la devolucion. */
  @Column({ type: 'varchar', length: 200, nullable: true, name: 'returned_by_sub' })
  returned_by_sub: string | null;

  // ── Reto 2 (/api/v2): cobertura, Saga de cancelacion y triple check-in ──────────────

  /** BASICA | TOTAL (solo ordenes creadas por /api/v2/autos/orders/create). */
  @Column({ type: 'varchar', length: 10, nullable: true, name: 'tipo_cobertura' })
  tipo_cobertura: string | null;

  /** Desglose de precio de /api/v2 (dias, base, cobertura, recargo por edad, deposito). */
  @Column({ type: 'jsonb', nullable: true, name: 'desglose_precio' })
  desglose_precio: any;

  /** Reembolso de la compensacion Saga (100 %). */
  @Column({ type: 'varchar', length: 40, nullable: true, name: 'refund_id' })
  refund_id: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'cancelled_at' })
  cancelled_at: Date | null;

  @Column({ type: 'varchar', length: 300, nullable: true, name: 'motivo_cancelacion' })
  motivo_cancelacion: string | null;

  /** Check-in 1 (digital, cliente). */
  @Column({ type: 'timestamptz', nullable: true, name: 'checkin_digital_at' })
  checkin_digital_at: Date | null;

  /** Licencia validada en el check-in digital y confirmada en mostrador. */
  @Column({ type: 'varchar', length: 40, nullable: true, name: 'licencia_verificada' })
  licencia_verificada: string | null;

  /** Check-in 2 (entrega en mostrador, agente). */
  @Column({ type: 'timestamptz', nullable: true, name: 'checkin_entrega_at' })
  checkin_entrega_at: Date | null;

  @Column({ type: 'varchar', length: 120, nullable: true, name: 'tecnico_entrega' })
  tecnico_entrega: string | null;

  @Column({ type: 'int', nullable: true, name: 'km_salida' })
  km_salida: number | null;

  /** Check-in 3 (devolucion en patio, agente). Tambien fija returned_at para el panel v1. */
  @Column({ type: 'timestamptz', nullable: true, name: 'checkin_devolucion_at' })
  checkin_devolucion_at: Date | null;

  @Column({ type: 'int', nullable: true, name: 'km_retorno' })
  km_retorno: number | null;

  @Column({ type: 'int', nullable: true, name: 'nivel_combustible_retorno' })
  nivel_combustible_retorno: number | null;

  @Column({ type: 'text', nullable: true, name: 'observaciones_devolucion' })
  observaciones_devolucion: string | null;

  @CreateDateColumn({ name: 'creation_date' })
  creation_date: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at: Date;
}

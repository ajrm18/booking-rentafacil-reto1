import {
  Column, CreateDateColumn, Entity, JoinColumn, ManyToOne,
  OneToMany, PrimaryColumn, UpdateDateColumn,
} from 'typeorm';
import { ColumnNumericTransformer } from '../../../common/transformers/column-numeric.transformer';
import { Depot } from './depot.entity';
import { Supplier } from './supplier.entity';
import { VehicleImage } from './vehicle-image.entity';

/**
 * Inventario de vehiculos. Su vehicle_id es un string (Ej: VEH-1001) para respetar el
 * contrato components.schemas.CarSearchResponse.data.items.vehicle_id (type: string).
 */
@Entity('vehicles')
export class Vehicle {
  @PrimaryColumn({ type: 'varchar', length: 40 })
  vehicle_id: string;

  @Column({ type: 'varchar', length: 60 })
  make: string;

  @Column({ type: 'varchar', length: 80 })
  model: string;

  @Column({ type: 'smallint' })
  year: number;

  @Column({ type: 'varchar', length: 20, unique: true })
  plate: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  color: string;

  @Column({ type: 'smallint', default: 5 })
  seats: number;

  @Column({ type: 'smallint', default: 4 })
  doors: number;

  @Column({ type: 'smallint', default: 3, name: 'bag_capacity' })
  bag_capacity: number;

  @Column({ type: 'varchar', length: 20, default: 'manual' })
  transmission: string;

  @Column({ type: 'varchar', length: 20, default: 'gasolina' })
  fuel_type: string;

  @Column({ type: 'varchar', length: 40, default: 'Compacto' })
  car_type: string;

  @Column({ type: 'boolean', default: true, name: 'air_conditioning' })
  air_conditioning: boolean;

  @Column('numeric', { precision: 10, scale: 2, name: 'price_per_day', transformer: new ColumnNumericTransformer() })
  price_per_day: number;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'main_image_url' })
  main_image_url: string;

  @Column({ type: 'varchar', length: 20, default: 'AVAILABLE' })
  status: string;

  @ManyToOne(() => Depot, (d) => d.vehicles, { eager: true })
  @JoinColumn({ name: 'depot_id' })
  depot: Depot;

  @Column({ name: 'depot_id' })
  depot_id: number;

  @ManyToOne(() => Supplier, (s) => s.vehicles, { eager: true })
  @JoinColumn({ name: 'supplier_id' })
  supplier: Supplier;

  @Column({ name: 'supplier_id' })
  supplier_id: number;

  @OneToMany(() => VehicleImage, (i) => i.vehicle, { cascade: true })
  images: VehicleImage[];

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at: Date;
}

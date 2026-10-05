import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Vehicle } from './vehicle.entity';

/**
 * Proveedor de renta (Ej: Hertz, Avis, Enterprise).
 * Mapea con components.schemas.SuppliersResponse.data.items
 */
@Entity('suppliers')
export class Supplier {
  @PrimaryGeneratedColumn()
  supplier_id: number;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  brand: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @OneToMany(() => Vehicle, (v) => v.supplier)
  vehicles: Vehicle[];
}

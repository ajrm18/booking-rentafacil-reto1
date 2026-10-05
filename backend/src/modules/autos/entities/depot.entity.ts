import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { ColumnNumericTransformer } from '../../../common/transformers/column-numeric.transformer';
import { Vehicle } from './vehicle.entity';

/**
 * Agencia de renta (punto de recogida/entrega).
 * Mapea con components.schemas.DepotsResponse.data.items
 */
@Entity('depots')
export class Depot {
  @PrimaryGeneratedColumn()
  depot_id: number;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'varchar', length: 80 })
  city: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  address: string;

  @Column({ type: 'varchar', length: 8, nullable: true })
  airport: string;

  @Column({ type: 'int', nullable: true })
  city_id: number;

  @Column('numeric', { precision: 10, scale: 6, nullable: true, transformer: new ColumnNumericTransformer() })
  latitude: number;

  @Column('numeric', { precision: 10, scale: 6, nullable: true, transformer: new ColumnNumericTransformer() })
  longitude: number;

  @Column('numeric', { precision: 3, scale: 2, default: 4.5, transformer: new ColumnNumericTransformer() })
  score: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @OneToMany(() => Vehicle, (v) => v.depot)
  vehicles: Vehicle[];
}

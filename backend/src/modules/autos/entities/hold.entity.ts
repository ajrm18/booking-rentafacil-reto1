import {
  Column, CreateDateColumn, Entity, PrimaryColumn,
} from 'typeorm';

/**
 * Bloqueo temporal del vehiculo (15 minutos por defecto) creado por POST /orders/hold.
 */
@Entity('holds')
export class Hold {
  @PrimaryColumn({ type: 'varchar', length: 60 })
  hold_id: string;

  @Column({ type: 'varchar', length: 40 })
  vehicle_id: string;

  @Column({ type: 'varchar', length: 200 })
  search_token: string;

  @Column({ type: 'varchar', length: 20, default: 'HELD' })
  status: 'HELD' | 'FAILED';

  @Column({ type: 'int', nullable: true })
  driver_age: number;

  @Column({ type: 'timestamp', name: 'expires_at' })
  expires_at: Date;

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;
}

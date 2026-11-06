import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ESQUEMAS } from '../../../common/schemas';

/** Bitacora del mostrador (db_counter.checkins): una fila por check-in digital, entrega o devolucion. */
@Entity({ schema: ESQUEMAS.COUNTER, name: 'checkins' })
export class Checkin {
  @PrimaryGeneratedColumn('uuid')
  checkin_id: string;

  @Index()
  @Column({ type: 'uuid' })
  order_id: string;

  @Column({ type: 'varchar', length: 40 })
  pnr: string;

  @Column({ type: 'varchar', length: 20 })
  tipo: 'DIGITAL' | 'ENTREGA' | 'DEVOLUCION';

  @Column({ type: 'varchar', length: 40 })
  vehicle_id: string;

  @Column({ type: 'uuid', nullable: true })
  client_id: string | null;

  @Column({ type: 'int', nullable: true })
  km: number | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  licencia_presentada: string | null;

  @Column({ type: 'varchar', length: 200 })
  admin_id: string;

  @Column({ type: 'varchar', length: 30 })
  estado_resultante: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  correlation_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

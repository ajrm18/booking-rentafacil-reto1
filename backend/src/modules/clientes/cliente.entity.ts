import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ESQUEMAS } from '../../common/schemas';

export type OrigenCliente = 'LOCAL' | 'BOOKING' | 'WEB';

/**
 * Cliente cross-platform v3.1 (db_identity.clientes). Email e identificacion (cedula o pasaporte)
 * son unicos: un cliente creado en el Booking central que llega a reservar aqui no se duplica.
 */
@Entity({ schema: ESQUEMAS.IDENTITY, name: 'clientes' })
export class Cliente {
  @PrimaryGeneratedColumn('uuid')
  client_id: string;

  @Column({ type: 'varchar', length: 200 })
  nombre: string;

  @Index('idx_clientes_email')
  @Column({ type: 'varchar', length: 160, unique: true })
  email: string;

  @Index('idx_clientes_identificacion')
  @Column({ type: 'varchar', length: 20, unique: true })
  identificacion: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  telefono: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  licencia: string | null;

  @Column({ type: 'varchar', length: 20, default: 'LOCAL' })
  origen: OrigenCliente;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;
}

import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type UserRole = 'client' | 'admin';

/**
 * Usuarios que pueden obtener un JWT en POST /auth/token (Authorization Server local del Reto 1).
 * El email es el `sub` del token y por tanto el dueño (owner_sub) de sus órdenes.
 * La contraseña se guarda como hash scrypt con sal (formato "scrypt$<sal>$<hash>"), nunca en claro.
 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  user_id: string;

  @Column({ type: 'varchar', length: 80 })
  first_name: string;

  @Column({ type: 'varchar', length: 80 })
  last_name: string;

  @Column({ type: 'varchar', length: 160, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 200, select: false })
  password_hash: string;

  @Column({ type: 'varchar', length: 10, default: 'client' })
  role: UserRole;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  national_id: string | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at: Date;
}

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Bitacora auditable de POST /api/v2/autos/{id}/mantenimiento/registro (tabla mantenimiento_log
 * del diagrama de arquitectura).
 */
@Entity('mantenimiento_log')
export class MantenimientoLog {
  @PrimaryColumn({ type: 'varchar', length: 40, name: 'bitacora_id' })
  bitacora_id: string;

  @Index()
  @Column({ type: 'varchar', length: 40, name: 'vehicle_id' })
  vehicle_id: string;

  @Column({ type: 'varchar', length: 80, name: 'tecnico_id' })
  tecnico_id: string;

  /** `sub` del JWT de quien registro (auditoria). */
  @Column({ type: 'varchar', length: 200, nullable: true, name: 'registrado_por' })
  registrado_por: string | null;

  @Column({ type: 'int', name: 'kilometraje_registrado' })
  kilometraje_registrado: number;

  @Column({ type: 'int', name: 'nivel_combustible' })
  nivel_combustible: number;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'condiciones_carroceria' })
  condiciones_carroceria: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true, name: 'estado_neumaticos' })
  estado_neumaticos: string | null;

  @Column({ type: 'text', nullable: true })
  observaciones: string | null;

  @Column({ type: 'boolean', default: false, name: 'mantenimiento_realizado' })
  mantenimiento_realizado: boolean;

  @Column({ type: 'int', name: 'proximo_mantenimiento_km' })
  proximo_mantenimiento_km: number;

  @Column({ type: 'boolean', name: 'alerta_emitida' })
  alerta_emitida: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;
}

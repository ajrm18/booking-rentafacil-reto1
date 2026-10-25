import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { ColumnNumericTransformer } from '../../../common/transformers/column-numeric.transformer';

/**
 * Acuerdo B2B de promociones y combos con el Booking (Catedra RDA2 §9). Una sola fila, la del
 * proveedor NODE_AUT_LOCAL; GET/PUT /api/v2/autos/promociones/contrato la leen y la actualizan.
 */
@Entity('contrato_promociones_b2b')
export class ContratoPromociones {
  @PrimaryColumn({ type: 'varchar', length: 40, name: 'proveedor_codigo' })
  proveedor_codigo: string;

  @Column({ type: 'varchar', length: 120, name: 'nombre_socio' })
  nombre_socio: string;

  @Column({ type: 'varchar', length: 20, default: 'AUTOS' })
  vertical: string;

  /** Pregunta obligatoria 1: ¿acepta participar en combos turisticos? */
  @Column({ type: 'boolean', default: false, name: 'permite_promociones' })
  permite_promociones: boolean;

  /** Pregunta obligatoria 2: porcentaje maximo de descuento autorizado (0 a 100). */
  @Column('numeric', { precision: 5, scale: 2, default: 0, name: 'porcentaje_descuento_maximo', transformer: new ColumnNumericTransformer() })
  porcentaje_descuento_maximo: number;

  @Column({ type: 'jsonb', default: [], name: 'destinos_habilitados' })
  destinos_habilitados: string[];

  @Column({ type: 'date', nullable: true, name: 'vigencia_hasta' })
  vigencia_hasta: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'condiciones_combo' })
  condiciones_combo: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true, name: 'actualizado_por' })
  actualizado_por: string | null;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at: Date;
}

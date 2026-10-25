import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Respuestas ya emitidas por las mutaciones de /api/v2 (cancel, check-in, devolucion,
 * mantenimiento, promociones), por Idempotency-Key. Un reintento con la misma clave recibe la
 * misma respuesta sin volver a aplicar la operacion, tambien despues de un reinicio del servidor.
 * (POST /orders/create usa la columna orders.idempotency_key, igual que en el Reto 1.)
 */
@Entity('idempotency_records')
export class IdempotencyRecord {
  @PrimaryColumn({ type: 'varchar', length: 60, name: 'idempotency_key' })
  idempotency_key: string;

  /** Operacion y recurso (ej. "checkin-devolucion:RF8K2M4Q"): la misma clave no se reutiliza en otra. */
  @Column({ type: 'varchar', length: 160 })
  scope: string;

  @Column({ type: 'int', name: 'status_code' })
  status_code: number;

  @Column({ type: 'jsonb' })
  response: any;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;
}

import {
  Column, CreateDateColumn, Entity, JoinColumn, ManyToOne,
  OneToMany, PrimaryColumn, UpdateDateColumn,
} from 'typeorm';
import { ColumnNumericTransformer } from '../../../common/transformers/column-numeric.transformer';
import { Depot } from './depot.entity';
import { Supplier } from './supplier.entity';
import { VehicleImage } from './vehicle-image.entity';

/**
 * Estados internos de vehicles.status (columna en ingles desde el Reto 1). RESERVED es el "rentado"
 * del dominio: lo pone /orders/create y lo libera /orders/{id}/cancel o la devolucion (-> WASHING).
 * READY_FOR_PICKUP (check-in digital hecho) y DELIVERED (llaves entregadas) se agregan en el Reto 2.
 */
export const VEHICLE_STATUSES = [
  'AVAILABLE', 'RESERVED', 'READY_FOR_PICKUP', 'DELIVERED', 'WASHING', 'MAINTENANCE', 'INACTIVE',
] as const;
export type VehicleStatus = typeof VEHICLE_STATUSES[number];

/**
 * Las 6 fases canonicas de la maquina de estados (autos-openapi-v2.yaml, EstadoVehiculoEnum,
 * Catedra RDA2 §5). Es el estado que se expone en /api/v2; la traduccion desde/hacia
 * VehicleStatus vive en estado-vehiculo.mapper.ts.
 */
export enum EstadoVehiculoEnum {
  DISPONIBLE = 'DISPONIBLE',
  RESERVADO = 'RESERVADO',
  LISTO_PARA_ENTREGAR = 'LISTO_PARA_ENTREGAR',
  ENTREGADO = 'ENTREGADO',
  EN_LIMPIEZA = 'EN_LIMPIEZA',
  EN_MANTENIMIENTO = 'EN_MANTENIMIENTO',
}

/** Cooldown de limpieza tras la devolucion: exactamente 2 horas (CE01). Antes eran 24 h. */
export const COOLDOWN_MINUTES = 120;
export const WASH_HOURS = COOLDOWN_MINUTES / 60;

/** Fin del cooldown de limpieza que empieza en `desde` (valor de disponible_desde / wash_until). */
export function calcularDisponibleDesde(desde: Date = new Date()): Date {
  return new Date(desde.getTime() + COOLDOWN_MINUTES * 60 * 1000);
}

/** Intervalo por defecto entre mantenimientos preventivos. */
export const INTERVALO_MANTENIMIENTO_KM = 10000;

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

  /**
   * Estado operativo (columna varchar, valores en VEHICLE_STATUSES). WASHING = lavado tras la
   * devolucion; vuelve a AVAILABLE cuando vence wash_until.
   */
  @Column({ type: 'varchar', length: 20, default: 'AVAILABLE' })
  status: string;

  /**
   * Fin del lavado post-devolucion (solo con status WASHING). En /api/v2 se expone como
   * `disponible_desde`; la columna conserva su nombre del Reto 1 para no recrearla.
   */
  @Column({ type: 'timestamptz', nullable: true, name: 'wash_until' })
  wash_until: Date | null;

  /** Odometro actual (lo actualizan los check-in de entrega/devolucion y el registro de mantenimiento). */
  @Column({ type: 'int', default: 0, name: 'kilometraje_actual' })
  kilometraje_actual: number;

  /** Umbral del proximo mantenimiento preventivo. */
  @Column({ type: 'int', default: INTERVALO_MANTENIMIENTO_KM, name: 'proximo_mantenimiento_km' })
  proximo_mantenimiento_km: number;

  /** true cuando kilometraje_actual >= proximo_mantenimiento_km y aun no se registra el mantenimiento. */
  @Column({ type: 'boolean', default: false, name: 'mantenimiento_requerido' })
  mantenimiento_requerido: boolean;

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

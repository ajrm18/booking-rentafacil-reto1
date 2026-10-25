import { EstadoVehiculoEnum, VehicleStatus } from './entities/vehicle.entity';

/**
 * Traduccion entre el estado interno (vehicles.status, en ingles desde el Reto 1) y las 6 fases
 * del contrato v2 (EstadoVehiculoEnum). Es biyectiva para los 6 estados operativos; INACTIVE
 * (baja administrativa, sin equivalente en el contrato) se publica como EN_MANTENIMIENTO.
 */
const A_V2: Record<VehicleStatus, EstadoVehiculoEnum> = {
  AVAILABLE: EstadoVehiculoEnum.DISPONIBLE,
  RESERVED: EstadoVehiculoEnum.RESERVADO,
  READY_FOR_PICKUP: EstadoVehiculoEnum.LISTO_PARA_ENTREGAR,
  DELIVERED: EstadoVehiculoEnum.ENTREGADO,
  WASHING: EstadoVehiculoEnum.EN_LIMPIEZA,
  MAINTENANCE: EstadoVehiculoEnum.EN_MANTENIMIENTO,
  INACTIVE: EstadoVehiculoEnum.EN_MANTENIMIENTO,
};

const DESDE_V2: Record<EstadoVehiculoEnum, VehicleStatus> = {
  [EstadoVehiculoEnum.DISPONIBLE]: 'AVAILABLE',
  [EstadoVehiculoEnum.RESERVADO]: 'RESERVED',
  [EstadoVehiculoEnum.LISTO_PARA_ENTREGAR]: 'READY_FOR_PICKUP',
  [EstadoVehiculoEnum.ENTREGADO]: 'DELIVERED',
  [EstadoVehiculoEnum.EN_LIMPIEZA]: 'WASHING',
  [EstadoVehiculoEnum.EN_MANTENIMIENTO]: 'MAINTENANCE',
};

/** Estados que conoce /api/v1 (Reto 1): las fases nuevas se ven ahi como RESERVED (auto ocupado). */
export type EstadoV1 = 'AVAILABLE' | 'RESERVED' | 'WASHING' | 'MAINTENANCE' | 'INACTIVE';

export function aEstadoV2(status: string): EstadoVehiculoEnum {
  const e = A_V2[status as VehicleStatus];
  if (!e) throw new Error(`Estado de vehiculo desconocido: ${status}`);
  return e;
}

export function desdeEstadoV2(estado: string): VehicleStatus {
  const s = DESDE_V2[estado as EstadoVehiculoEnum];
  if (!s) throw new Error(`Estado v2 desconocido: ${estado}`);
  return s;
}

export function aEstadoV1(status: string): EstadoV1 {
  if (status === 'READY_FOR_PICKUP' || status === 'DELIVERED') return 'RESERVED';
  return status as EstadoV1;
}

/** Acepta un estado en ingles o en espanol y devuelve el interno (para filtros y PUT del admin). */
export function normalizarEstado(valor: string): VehicleStatus | undefined {
  if (!valor) return undefined;
  const v = valor.trim().toUpperCase();
  if (v in A_V2) return v as VehicleStatus;
  return DESDE_V2[v as EstadoVehiculoEnum];
}

/** Unidades disponibles para el canal gRPC: 1 solo si el auto se puede reservar. */
export const unidadesDisponibles = (status: string) => (status === 'AVAILABLE' ? 1 : 0);

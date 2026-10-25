import { calcularDisponibleDesde, COOLDOWN_MINUTES, Vehicle } from '../autos/entities/vehicle.entity';
import { aEstadoV2 } from '../autos/estado-vehiculo.mapper';
import { invalido, ParametroInvalido, problema } from './problema';

/**
 * Reglas de negocio del contrato v2 sin dependencias de BD (probadas en test/unit/reglas-v2.spec.ts).
 */

/** Franja horaria estricta de 30 minutos: HH:00 o HH:30 (00:00 ... 23:30). */
export const FRANJA_30_MIN = /^([01]\d|2[0-3]):(00|30)$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
/** Las fechas/franjas del contrato se interpretan en hora de Ecuador continental. */
export const ZONA_EC = '-05:00';

export const MAX_DIAS = 90;
export const MS_DIA = 24 * 60 * 60 * 1000;
export const EDAD_MINIMA = 18;
export const RECARGO_EDAD_DIARIO = 10;

/** Todas las franjas validas (para el dropdown del frontend y la documentacion). */
export const FRANJAS = Array.from({ length: 48 }, (_, i) =>
  `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

export interface Periodo { pickup: Date; dropoff: Date; dias: number; pickup_date: string; dropoff_date: string; pickup_time: string; dropoff_time: string }

/**
 * Valida y convierte fecha + franja de recogida/devolucion. Reglas: franjas de 30 min, recogida no
 * pasada (tolerancia de 30 min), devolucion posterior y como maximo MAX_DIAS dias.
 */
export function parsearPeriodo(
  e: { pickup_date?: any; pickup_time?: any; dropoff_date?: any; dropoff_time?: any },
  nombres = { pickup_date: 'pickup_date', pickup_time: 'pickup_time', dropoff_date: 'dropoff_date', dropoff_time: 'dropoff_time' },
  ahora = new Date(),
): Periodo {
  const errores: ParametroInvalido[] = [];
  const fecha = (k: 'pickup_date' | 'dropoff_date') => {
    const v = e[k];
    if (typeof v !== 'string' || !FECHA.test(v) || isNaN(Date.parse(`${v}T00:00:00Z`))) {
      errores.push({ name: nombres[k], reason: 'Fecha obligatoria con formato YYYY-MM-DD' });
    }
    return v as string;
  };
  const franja = (k: 'pickup_time' | 'dropoff_time') => {
    const v = e[k];
    if (typeof v !== 'string' || !FRANJA_30_MIN.test(v)) {
      errores.push({ name: nombres[k], reason: 'Franja horaria estricta de 30 minutos (HH:00 o HH:30, ej. 10:00 o 10:30)' });
    }
    return v as string;
  };
  const pd = fecha('pickup_date'), pt = franja('pickup_time'), dd = fecha('dropoff_date'), dt = franja('dropoff_time');
  if (errores.length) throw invalido(errores);

  const pickup = new Date(`${pd}T${pt}:00${ZONA_EC}`);
  const dropoff = new Date(`${dd}T${dt}:00${ZONA_EC}`);
  if (pickup.getTime() < ahora.getTime() - 30 * 60 * 1000) {
    throw invalido([{ name: nombres.pickup_date, reason: 'La fecha de recogida no puede ser en el pasado.' }]);
  }
  if (dropoff <= pickup) {
    throw invalido([{ name: nombres.dropoff_date, reason: 'La devolución debe ser posterior a la recogida.' }]);
  }
  const dias = Math.max(1, Math.ceil((dropoff.getTime() - pickup.getTime()) / MS_DIA));
  if (dias > MAX_DIAS) {
    throw invalido([{ name: nombres.dropoff_date, reason: `El alquiler no puede superar los ${MAX_DIAS} días.` }]);
  }
  return { pickup, dropoff, dias, pickup_date: pd, dropoff_date: dd, pickup_time: pt, dropoff_time: dt };
}

export interface EvaluacionEdad { recargo: boolean; motivo: 'JOVEN' | 'SENIOR' | null }

/**
 * Control etario HU-AUT-01: menor de 18 -> HTTP 422 (rechazo legal); menor de 25 o mayor de 70 ->
 * recargo (no es error). Sin edad declarada no hay recargo.
 */
export function evaluarEdad(edad: unknown, campo = 'driver_age'): EvaluacionEdad {
  if (edad === undefined || edad === null || edad === '') return { recargo: false, motivo: null };
  const n = Number(edad);
  if (!Number.isInteger(n) || n < 0 || n > 120) {
    throw invalido([{ name: campo, reason: 'La edad del conductor debe ser un número entero' }]);
  }
  if (n < EDAD_MINIMA) {
    throw problema(422, 'DRIVER_AGE_RESTRICTION',
      `El conductor principal tiene ${n} años. La edad mínima legal para rentar un vehículo es ${EDAD_MINIMA} años.`,
      { title: 'Conductor menor de edad', invalid_params: [{ name: campo, reason: `Debe tener al menos ${EDAD_MINIMA} años` }] });
  }
  if (n < 25) return { recargo: true, motivo: 'JOVEN' };
  if (n > 70) return { recargo: true, motivo: 'SENIOR' };
  return { recargo: false, motivo: null };
}

/** true si el vehiculo esta en la fase EN_LIMPIEZA con el cooldown de 2 h aun corriendo. */
export function enCooldown(v: Pick<Vehicle, 'status' | 'wash_until'>, ahora = new Date()): boolean {
  return v.status === 'WASHING' && !!v.wash_until && new Date(v.wash_until).getTime() > ahora.getTime();
}

export function segundosRestantesCooldown(v: Pick<Vehicle, 'status' | 'wash_until'>, ahora = new Date()): number {
  if (!enCooldown(v, ahora)) return 0;
  return Math.ceil((new Date(v.wash_until!).getTime() - ahora.getTime()) / 1000);
}

const horaUtc = (d: Date) => d.toISOString().slice(11, 16);

/**
 * Lanza el 409 del contrato si el vehiculo no se puede reservar: VEHICLE_IN_CLEANING_COOLDOWN
 * durante las 2 h de limpieza, VEHICLE_NOT_AVAILABLE en cualquier otra fase distinta de DISPONIBLE.
 */
export function assertReservable(v: Pick<Vehicle, 'vehicle_id' | 'status' | 'wash_until'>, ahora = new Date()): void {
  if (v.status === 'AVAILABLE') return;
  if (enCooldown(v, ahora)) {
    const fin = new Date(v.wash_until!);
    throw problema(409, 'VEHICLE_IN_CLEANING_COOLDOWN',
      `El vehículo ${v.vehicle_id} se encuentra en fase de limpieza y desinfección obligatoria de ${COOLDOWN_MINUTES} minutos tras su retorno. ` +
      `Estará disponible nuevamente a las ${horaUtc(fin)} UTC.`,
      { title: 'Vehículo en Cooldown de Limpieza Obligatorio (2 Horas)', disponible_desde: fin.toISOString() });
  }
  throw problema(409, 'VEHICLE_NOT_AVAILABLE',
    `El vehículo ${v.vehicle_id} no está disponible (estado ${aEstadoV2(v.status)}).`,
    { title: 'Vehículo no disponible' });
}

export { calcularDisponibleDesde };

// ── Coberturas (HU-AUT-03) ─────────────────────────────────────────────────────

export type TipoCobertura = 'BASICA' | 'TOTAL';

export const COBERTURAS: Record<TipoCobertura, {
  nombre: string; costo_adicional_diario: number; franquicia: number; deposito_garantia: number; descripcion: string; beneficios: string[];
}> = {
  BASICA: {
    nombre: 'Protección Básica (Incluida)',
    costo_adicional_diario: 0,
    franquicia: 1200,
    deposito_garantia: 500,
    descripcion: 'Incluida en la tarifa. Ante daños el cliente responde hasta la franquicia de $1,200.00; se retiene un depósito de garantía en tarjeta de crédito.',
    beneficios: ['Responsabilidad civil obligatoria', 'Asistencia en carretera 24/7', 'Protección contra robo con franquicia'],
  },
  TOTAL: {
    nombre: 'Cobertura Total / Protección Premium',
    costo_adicional_diario: 18,
    franquicia: 0,
    deposito_garantia: 0,
    descripcion: 'Elimina totalmente la franquicia ante daños en carrocería, cristales, neumáticos y llaves.',
    beneficios: ['Franquicia $0.00', 'Depósito retenido $0.00', 'Cristales, neumáticos y bajos', 'Pérdida de llaves', 'Asistencia en carretera 24/7'],
  },
};

/** Acepta tipo_cobertura o el alias `cobertura` (PREMIUM se trata como TOTAL). */
export function normalizarCobertura(valor: unknown, campo = 'tipo_cobertura'): TipoCobertura {
  if (valor === undefined || valor === null || valor === '') return 'BASICA';
  const v = String(valor).toUpperCase();
  if (v === 'BASICA') return 'BASICA';
  if (v === 'TOTAL' || v === 'PREMIUM') return 'TOTAL';
  throw invalido([{ name: campo, reason: 'Debe ser BASICA o TOTAL' }]);
}

export interface Desglose {
  dias: number; precio_diario: number; base: number; cobertura: TipoCobertura; costo_cobertura: number;
  recargo_edad: number; motivo_recargo: string | null; deposito_garantia: number; total: number;
}

/** Tarifa v2 (precios con impuestos incluidos, como el ejemplo del contrato: 3 x 35.50 + 3 x 18 = 160.50). */
export function calcularPrecio(precioDiario: number, dias: number, cobertura: TipoCobertura, edad: EvaluacionEdad): Desglose {
  const r2 = (n: number) => Number(n.toFixed(2));
  const base = r2(precioDiario * dias);
  const costoCobertura = r2(COBERTURAS[cobertura].costo_adicional_diario * dias);
  const recargo = edad.recargo ? r2(RECARGO_EDAD_DIARIO * dias) : 0;
  return {
    dias, precio_diario: Number(precioDiario), base, cobertura, costo_cobertura: costoCobertura,
    recargo_edad: recargo, motivo_recargo: edad.motivo, deposito_garantia: COBERTURAS[cobertura].deposito_garantia,
    total: r2(base + costoCobertura + recargo),
  };
}

// ── Categorias y transmision del contrato <-> valores internos ───────────────

export const CATEGORIA_V2: Record<string, string> = {
  Compacto: 'ECONOMICO', Sedan: 'COMPACTO', SUV: 'SUV', Lujo: 'PREMIUM', Camioneta: 'VAN',
};
export const TRANSMISION_V2: Record<string, string> = { manual: 'MANUAL', automatica: 'AUTOMATICO' };

export const categoriasInternas = (categoria: string) =>
  Object.entries(CATEGORIA_V2).filter(([, v]) => v === categoria).map(([k]) => k);
export const transmisionInterna = (t: string) =>
  Object.entries(TRANSMISION_V2).find(([, v]) => v === t)?.[0];

const IATA_CIUDAD: Record<string, string> = { UIO: 'Quito', GYE: 'Guayaquil', CUE: 'Cuenca', MEC: 'Manta', GPS: 'Galápagos' };

export const sinTildes = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Ciudad de un pickup_location del contrato ("UIO", "Quito" o "Aeropuerto Mariscal Sucre (UIO), Quito"):
 * primero un codigo IATA entre parentesis o suelto y si no, el nombre de alguna ciudad conocida.
 */
export function resolverCiudad(ubicacion: string | undefined, ciudades: string[]): string | null | undefined {
  if (!ubicacion || !ubicacion.trim()) return undefined; // sin filtro
  const texto = ubicacion.trim();
  const iata = texto.match(/\(([A-Z]{3})\)/)?.[1] ?? (/^[A-Za-z]{3}$/.test(texto) ? texto.toUpperCase() : undefined);
  if (iata && IATA_CIUDAD[iata]) return IATA_CIUDAD[iata];
  const t = sinTildes(texto);
  return ciudades.find((c) => t.includes(sinTildes(c))) ?? null; // null: ubicacion sin agencias
}

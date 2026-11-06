import { Order } from '../autos/entities/order.entity';
import { Vehicle } from '../autos/entities/vehicle.entity';
import { unidadesDisponibles } from '../autos/estado-vehiculo.mapper';
import { enCooldown } from '../autos-v2/reglas';
import { estadoOrdenV2 } from '../autos-v2/v2.mapper';

export const VERSION_V3 = process.env.PROVIDER_VERSION || '3.0.0';

/** Reescribe los enlaces HATEOAS /api/v2/... de las respuestas reutilizadas a /api/v3/... */
export function aV3<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  return JSON.parse(JSON.stringify(obj).replace(/\/api\/v2\//g, '/api/v3/'));
}

/**
 * Catalogo v3: a cada tarjeta de vehiculo (AutoVehiculoCardV2) le agrega status, stock y
 * available_units (1 = DISPONIBLE, 0 = ocupado), que es lo que el Booking sincroniza.
 */
export function conStockV3<T>(obj: T): T {
  const visitar = (x: any): any => {
    if (Array.isArray(x)) return x.map(visitar);
    if (!x || typeof x !== 'object') return x;
    const out: any = {};
    for (const [k, v] of Object.entries(x)) out[k] = visitar(v);
    if (typeof out.vehicle_id === 'string' && 'precio_diario' in out && typeof out.estado === 'string') {
      const unidades = out.estado === 'DISPONIBLE' ? 1 : 0;
      out.status = out.status ?? out.estado;
      out.stock = unidades;
      out.available_units = unidades;
    }
    return out;
  };
  return aV3(visitar(obj));
}

/** Unidades de un vehiculo para gRPC/REST (re-export para los controladores). */
export const unidadesDe = (v: Pick<Vehicle, 'status'>) => unidadesDisponibles(v.status);

export type EstadoMostrador = 'RESERVADO' | 'PENDIENTE_ENTREGA' | 'CONFIRMADO_ASISTIDO' | 'EN_LIMPIEZA' | 'COMPLETADA' | 'CANCELLED' | 'VENCIDA';

/**
 * Estado visual del mostrador (badge del buscador):
 *  RESERVADO / PENDIENTE_ENTREGA (amarillo) -> CONFIRMADO_ASISTIDO (verde) -> EN_LIMPIEZA (azul) / COMPLETADA;
 *  CANCELLED (rojo).
 */
export function estadoMostrador(o: Order, v?: Pick<Vehicle, 'status' | 'wash_until'> | null): EstadoMostrador {
  const e = estadoOrdenV2(o);
  if (e === 'CANCELLED') return 'CANCELLED';
  if (o.checkin_devolucion_at || o.returned_at) return v && enCooldown(v) ? 'EN_LIMPIEZA' : 'COMPLETADA';
  if (o.checkin_entrega_at) return 'CONFIRMADO_ASISTIDO';
  if (e === 'COMPLETADA') return 'VENCIDA';
  if (o.checkin_digital_at) return 'PENDIENTE_ENTREGA';
  return 'RESERVADO';
}

export type TipoBusqueda = 'EMAIL' | 'IDENTIFICACION' | 'PNR';

/** Deteccion del buscador unificado: @ -> email; 10 digitos -> cedula; si no -> PNR. */
export function detectarTipo(q: string): TipoBusqueda {
  const t = q.trim();
  if (t.includes('@')) return 'EMAIL';
  if (/^\d{10}$/.test(t)) return 'IDENTIFICACION';
  return 'PNR';
}

/**
 * Traduce los codigos v2 al catalogo canonico de errores del contrato v3.0.0:
 *  409 VEHICLE_UNAVAILABLE | OUT_OF_STOCK | VEHICLE_IN_CLEANING_COOLDOWN (activan Saga)
 *  422 DRIVER_UNDERAGE | INVALID_DATES | INVALID_PAYLOAD (semanticos, sin Saga)
 *  400 MALFORMED_REQUEST | IDEMPOTENCY_CONFLICT (sintaxis)
 */
export function traducirProblemaV3(body: Record<string, any>, status: number): { status: number; body: Record<string, any> } {
  const code = String(body.code ?? '');
  const params: any[] = body.invalid_params ?? body.invalidParams ?? [];
  const tipo = (c: string) => `https://booking.epn.edu.ec/errors/${c.toLowerCase().replace(/_/g, '-')}`;
  const con = (s: number, c: string, title?: string) => ({
    status: s, body: { ...body, status: s, code: c, type: tipo(c), ...(title && { title }), ...(c !== code && code && { legacy_code: code }) },
  });
  switch (code) {
    case 'VEHICLE_NOT_AVAILABLE':
    case 'CAR_NO_LONGER_AVAILABLE':
      return con(409, 'VEHICLE_UNAVAILABLE', 'Vehículo No Disponible');
    case 'VEHICLE_IN_CLEANING_COOLDOWN':
    case 'OUT_OF_STOCK':
    case 'VEHICLE_UNAVAILABLE':
      return con(409, code);
    case 'DRIVER_AGE_RESTRICTION':
      return con(422, 'DRIVER_UNDERAGE');
    case 'IDEMPOTENCY_KEY_REUSED':
      return con(400, 'IDEMPOTENCY_CONFLICT', 'Conflicto de idempotencia');
    case 'IDEMPOTENCY_KEY_REQUIRED':
    case 'IDEMPOTENCY_KEY_INVALID':
      return con(400, 'MALFORMED_REQUEST');
    case 'VALIDATION_FAILED': {
      const fechas = params.some((p) => /date|fecha|time|hora|dropoff|pickup/i.test(String(p?.name ?? '')));
      return con(422, fechas ? 'INVALID_DATES' : 'INVALID_PAYLOAD', fechas ? 'Fechas inválidas' : 'Payload inválido');
    }
    default:
      if (status === 400 && !code) return con(400, 'MALFORMED_REQUEST', 'Solicitud mal formada');
      return { status, body };
  }
}

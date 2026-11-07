import { createHash } from 'crypto';
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
 * Estado del vehiculo en el catalogo v3 (Ajuste 2): RESERVADO es por rango de fechas, no por el
 * vehiculo entero. RESERVADO / LISTO_PARA_ENTREGAR / ENTREGADO se publican como DISPONIBLE porque
 * el auto sigue teniendo rangos libres futuros; solo EN_LIMPIEZA y EN_MANTENIMIENTO lo ocultan.
 */
export function estadoCatalogoV3(estado: string): string {
  return ['RESERVADO', 'LISTO_PARA_ENTREGAR', 'ENTREGADO'].includes(estado) ? 'DISPONIBLE' : estado;
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
      out.estado = estadoCatalogoV3(out.estado);
      const unidades = out.estado === 'DISPONIBLE' ? 1 : 0;
      out.status = out.estado;
      out.stock = unidades;
      out.available_units = unidades;
    }
    return out;
  };
  return aV3(visitar(obj));
}

// ═══════════════════════════════════════════════════════════════════════════
//  Bloqueo de disponibilidad por rango de fechas (Ajuste 2)
// ═══════════════════════════════════════════════════════════════════════════

/** YYYY-MM-DD de un ISO 8601 (toISOString().slice(0, 10)); null si no es fecha. */
export function fechaDe(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(v as any);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** [a1, a2] y [b1, b2] (YYYY-MM-DD, inclusivos) se cruzan cuando a1 <= b2 AND b1 <= a2. */
export const rangosSeCruzan = (a1: string, a2: string, b1: string, b2: string) => a1 <= b2 && b1 <= a2;

/** Una orden bloquea su rango mientras esta CONFIRMED (incluye ENTREGADO) y el auto no se devolvio. */
export const bloqueaRango = (o: Pick<Order, 'status' | 'checkin_devolucion_at' | 'returned_at'>) =>
  o.status === 'CONFIRMED' && !o.checkin_devolucion_at && !o.returned_at;

export function rangoDeOrden(o: Pick<Order, 'route_details'>): { pickup_date: string | null; dropoff_date: string | null } {
  return { pickup_date: fechaDe(o.route_details?.pickup?.datetime), dropoff_date: fechaDe(o.route_details?.dropoff?.datetime) };
}

/** true si la orden activa ocupa algun dia de [desde, hasta]. */
export function ordenCruzaRango(o: Pick<Order, 'status' | 'checkin_devolucion_at' | 'returned_at' | 'route_details'>, desde: string, hasta: string): boolean {
  if (!bloqueaRango(o)) return false;
  const r = rangoDeOrden(o);
  if (!r.pickup_date || !r.dropoff_date) return true; // sin fechas legibles: conservador
  return rangosSeCruzan(r.pickup_date, r.dropoff_date, desde, hasta);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Respuestas de ordenes v3 (Ajustes 3 y 5)
// ═══════════════════════════════════════════════════════════════════════════

/** estado_orden interno ENTREGADO -> status API v3 CONFIRMADO_ASISTIDO (v2 sigue con ENTREGADO). */
export const statusV3 = (s: unknown) => (s === 'ENTREGADO' ? 'CONFIRMADO_ASISTIDO' : s);

/**
 * Agrega pickup_date / dropoff_date (YYYY-MM-DD) y traduce status/estado al vocabulario v3.
 * Las fechas salen de route_details de la orden o, si no se pasa, de recogida/devolucion del DTO.
 */
export function conFechasV3<T extends Record<string, any>>(r: T, o?: Pick<Order, 'route_details'> | null): T & { pickup_date: string | null; dropoff_date: string | null } {
  const desdeOrden = o ? rangoDeOrden(o) : null;
  const out: any = {
    ...r,
    pickup_date: desdeOrden?.pickup_date ?? fechaDe(r?.recogida?.fecha_hora) ?? null,
    dropoff_date: desdeOrden?.dropoff_date ?? fechaDe(r?.devolucion?.fecha_hora) ?? null,
  };
  if ('status' in out) out.status = statusV3(out.status);
  if ('estado' in out) out.estado = statusV3(out.estado);
  return out;
}

/**
 * Idempotency-Key derivada para POST /api/v3/autos/orders/{pnr}/cancel sin cabecera (Ajuste 1):
 * pnr + fecha UTC -> UUID estable, asi los reintentos del mismo dia se deduplican.
 */
export function claveCancelacionDerivada(pnr: string, ahora = new Date()): string {
  const h = createHash('sha256').update(`cancel:${pnr.trim().toUpperCase()}:${ahora.toISOString().slice(0, 10)}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[parseInt(h[16], 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
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

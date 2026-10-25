import { calcularDisponibleDesde, COOLDOWN_MINUTES, Vehicle } from '../autos/entities/vehicle.entity';
import { Order } from '../autos/entities/order.entity';
import { aEstadoV2 } from '../autos/estado-vehiculo.mapper';
import { CATEGORIA_V2, COBERTURAS, enCooldown, segundosRestantesCooldown, TipoCobertura, TRANSMISION_V2 } from './reglas';

const BASE = '/api/v2/autos';
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export const categoriaV2 = (carType: string) => CATEGORIA_V2[carType] ?? 'COMPACTO';
export const transmisionV2 = (t: string) => TRANSMISION_V2[t] ?? String(t).toUpperCase();

/** components.schemas.AutoVehiculoCardV2 (campos en espanol + alias en ingles del contrato). */
export function aVehiculoCard(v: Vehicle, precioTotal?: number): Record<string, any> {
  const total = precioTotal ?? Number(v.price_per_day);
  const imagenes = (v.images ?? []).slice().sort((a, b) => a.position - b.position).map((i) => i.url);
  const grandes = Math.ceil((v.bag_capacity ?? 0) / 2);
  const ubicacion = v.depot ? `${v.depot.name}${v.depot.address ? ` (${v.depot.address})` : ''}` : null;
  return {
    vehicle_id: v.vehicle_id,
    marca: v.make,
    modelo: v.model,
    anio: v.year,
    categoria: categoriaV2(v.car_type),
    precio_diario: Number(v.price_per_day),
    precio_total: total,
    moneda: 'USD',
    transmision: transmisionV2(v.transmission),
    combustible: v.fuel_type,
    asientos: v.seats,
    puertas: v.doors,
    maletas_grandes: grandes,
    maletas_pequenas: Math.max(0, (v.bag_capacity ?? 0) - grandes),
    aire_acondicionado: v.air_conditioning,
    kilometraje_ilimitado: true,
    politica_combustible: 'LLENO_A_LLENO',
    cancelacion_gratuita: true,
    proveedor: {
      nombre: v.supplier?.name ?? 'RentaFacil EC',
      rating: v.depot?.score != null ? Number((Number(v.depot.score) * 2).toFixed(1)) : null,
      ubicacion,
    },
    agencia: v.depot ? { depot_id: v.depot.depot_id, nombre: v.depot.name, ciudad: v.depot.city, aeropuerto: v.depot.airport } : null,
    estado: aEstadoV2(v.status),
    kilometraje_actual: v.kilometraje_actual ?? 0,
    proximo_mantenimiento_km: v.proximo_mantenimiento_km,
    mantenimiento_requerido: !!v.mantenimiento_requerido,
    foto_url: v.main_image_url,
    images: imagenes.length ? imagenes : (v.main_image_url ? [v.main_image_url] : []),
    descripcion: v.description,
    // Alias del contrato
    auto_id: v.vehicle_id,
    id: v.vehicle_id,
    brand: v.make,
    model: v.model,
    category: categoriaV2(v.car_type),
    daily_price: Number(v.price_per_day),
    total_price_usd: total,
    currency: 'USD',
    transmission: transmisionV2(v.transmission),
    seats: v.seats,
    doors: v.doors,
    air_conditioning: v.air_conditioning,
    unlimited_mileage: true,
    fuel_policy: 'Lleno a Lleno (Full-to-Full)',
    free_cancellation: true,
    _links: {
      self: `${BASE}/${v.vehicle_id}`,
      coberturas: `${BASE}/${v.vehicle_id}/coberturas`,
      reservar: `${BASE}/orders/create`,
    },
  };
}

/** components.schemas.AutoFlotaItemV2 (Panel 2 con cronometro de cooldown). */
export function aFlotaItem(v: Vehicle, ahora = new Date()): Record<string, any> {
  const cooldown = enCooldown(v, ahora);
  return {
    id: v.vehicle_id,
    marca: v.make,
    modelo: v.model,
    placa: v.plate,
    categoria: categoriaV2(v.car_type),
    precio_diario: Number(v.price_per_day),
    estado_operativo: aEstadoV2(v.status),
    cooldown_activo: cooldown,
    segundos_restantes_cooldown: segundosRestantesCooldown(v, ahora),
    disponible_estimado_at: v.status === 'WASHING' ? iso(v.wash_until) : null,
    kilometraje_actual: v.kilometraje_actual ?? 0,
    umbral_mantenimiento_km: v.proximo_mantenimiento_km,
    alerta_mantenimiento: (v.kilometraje_actual ?? 0) >= v.proximo_mantenimiento_km,
    mantenimiento_requerido: !!v.mantenimiento_requerido,
    agencia: v.depot?.name ?? null,
    foto_url: v.main_image_url,
  };
}

/** components.schemas.DevolucionAutoResponseV2 / CooldownStatusDto. */
export function aCooldown(v: Pick<Vehicle, 'vehicle_id' | 'make' | 'model' | 'status' | 'wash_until'>) {
  const fin = v.wash_until ? new Date(v.wash_until) : calcularDisponibleDesde();
  return {
    auto_id: v.vehicle_id,
    vehiculo: `${v.make} ${v.model}`,
    estado: aEstadoV2(v.status),
    cooldown_horas: COOLDOWN_MINUTES / 60,
    cooldown_minutos: COOLDOWN_MINUTES,
    inicio_cooldown: new Date(fin.getTime() - COOLDOWN_MINUTES * 60 * 1000).toISOString(),
    disponible_desde: fin.toISOString(),
    mensaje: `Vehículo en ciclo de limpieza y desinfección. Estará disponible en ${COOLDOWN_MINUTES / 60} horas.`,
  };
}

/** Estado de la orden en v2, derivado de las marcas de tiempo (orders.status conserva los valores del v1). */
export function estadoOrdenV2(o: Order): string {
  if (o.status === 'CANCELLED') return 'CANCELLED';
  if (o.checkin_devolucion_at || o.returned_at) return 'COMPLETADA';
  if (o.checkin_entrega_at) return 'ENTREGADO';
  // Igual que el panel v1: una reserva nunca retirada cuya devolucion ya paso esta finalizada
  if (o.status === 'CONFIRMED' && reservaVencida(o)) return 'COMPLETADA';
  if (o.checkin_digital_at) return 'CHECKIN_COMPLETED';
  return o.status;
}

export function reservaVencida(o: Order, ahora = Date.now()): boolean {
  const fin = Date.parse(o.route_details?.dropoff?.datetime);
  return !isNaN(fin) && fin < ahora;
}

export const voucherReserva = (o: Order) => `BOOKING-CAR-${o.locator}-${o.vehicle_id}-${estadoOrdenV2(o)}`;
export const voucherCheckin = (o: Order) => `AUTOS-CHECKIN-${o.locator}-VERIFIED-${o.licencia_verificada ?? ''}`;

export const CHECKLIST_MOSTRADOR = [
  'Licencia de conducir física vigente',
  'Documento de identidad (cédula o pasaporte)',
  'Tarjeta de crédito a nombre del conductor principal (depósito de garantía si la cobertura es BÁSICA)',
  'Código QR del voucher (retiro express si hizo el check-in digital)',
];

/** components.schemas.AutoOrderResponseV2 + fases de check-in (extension usada por "Mis reservas"). */
export function aOrdenV2(o: Order, vehiculo?: Vehicle | null): Record<string, any> {
  const estado = estadoOrdenV2(o);
  const cobertura = (o.tipo_cobertura as TipoCobertura) ?? 'BASICA';
  const desglose = o.desglose_precio ?? null;
  const ref = o.locator;
  const links: Record<string, string> = { self: `${BASE}/orders/${ref}` };
  if (estado === 'CONFIRMED' || estado === 'CHECKIN_COMPLETED') {
    links.cancel = `${BASE}/orders/${ref}/cancel`;
    links.checkin_entrega = `${BASE}/orders/${ref}/checkin-entrega`;
  }
  if (estado === 'CONFIRMED') links.checkin = `${BASE}/reservas/${ref}/checkin`;
  if (estado === 'ENTREGADO') links.checkin_devolucion = `${BASE}/orders/${ref}/checkin-devolucion`;
  links.vehiculo = `${BASE}/${o.vehicle_id}`;

  const refund = o.refund_id ? {
    refund_id: o.refund_id, amount: Number(o.total_price), currency: o.currency, percentage: 100,
    status: 'PROCESSED', message: 'Reembolso del 100 % procesado por compensación Saga.',
  } : null;
  const enLimpieza = vehiculo && vehiculo.status === 'WASHING' && (o.checkin_devolucion_at || o.returned_at);
  const ruta = o.route_details ?? {};

  return {
    order_id: o.order_id,
    pnr: o.locator,
    status: estado,
    auto_id: o.vehicle_id,
    tipo_cobertura: cobertura,
    deposito_garantia: desglose?.deposito_garantia ?? COBERTURAS[cobertura].deposito_garantia,
    total_price: { currency: o.currency, total: Number(o.total_price), desglose },
    voucher_qr_data: o.checkin_digital_at ? voucherCheckin(o) : voucherReserva(o),
    checklist_mostrador: CHECKLIST_MOSTRADOR,
    refund,
    _links: links,
    codigo_reserva: o.locator,
    estado,
    moneda: o.currency,
    precio_total_monto: Number(o.total_price),
    reembolso_id: o.refund_id ?? null,
    monto_reembolsado: o.refund_id ? Number(o.total_price) : null,
    cooldown_info: enLimpieza ? { ...aCooldown(vehiculo!), activo: enCooldown(vehiculo!), fin_cooldown: iso(vehiculo!.wash_until), proximo_estado: 'DISPONIBLE' } : null,
    // Extensiones (no rompen el schema: el contrato v2 no declara additionalProperties: false)
    vehiculo: {
      marca: o.vehicle_details?.make, modelo: o.vehicle_details?.model, foto_url: o.vehicle_details?.main_image_url ?? null,
    },
    recogida: { fecha_hora: ruta.pickup?.datetime ?? null, lugar: ruta.pickup?.location?.name ?? ruta.pickup?.location?.airport ?? null },
    devolucion: { fecha_hora: ruta.dropoff?.datetime ?? null, lugar: ruta.dropoff?.location?.name ?? ruta.dropoff?.location?.airport ?? null },
    conductor: o.driver_details ?? null,
    propietario: o.owner_sub,
    creada_at: iso(o.creation_date),
    cancelada_at: iso(o.cancelled_at),
    checkins: {
      digital: { completado: !!o.checkin_digital_at, at: iso(o.checkin_digital_at), licencia_verificada: o.licencia_verificada },
      entrega: { completado: !!o.checkin_entrega_at, at: iso(o.checkin_entrega_at), km_salida: o.km_salida, tecnico_entrega: o.tecnico_entrega },
      devolucion: {
        completado: !!(o.checkin_devolucion_at || o.returned_at),
        at: iso(o.checkin_devolucion_at ?? o.returned_at),
        km_retorno: o.km_retorno,
        km_recorridos: o.km_retorno != null && o.km_salida != null ? o.km_retorno - o.km_salida : null,
        nivel_combustible: o.nivel_combustible_retorno,
        observaciones: o.observaciones_devolucion,
      },
    },
  };
}

/**
 * Identidad de este proveedor ante el Booking Prototipo central. Deben coincidir exactamente con
 * el formulario "Nuevo Proveedor" (docs/integracion-booking.md §3.1 y §5).
 */
export const NODO = {
  id: 'NODE_AUT_RENTAFACIL',
  nombre: 'RentaFacil EC',
  vertical: 'AUTOS',
  version: '2.0.0',
  /** service_id de los mensajes gRPC de stock. */
  serviceId: 'NODE_AUT_RENTAFACIL',
  /** Atributo `source` de los CloudEvents (mismo valor que los ejemplos del contrato v2). */
  ceSource: '/microservices/ms-autos',
  /** Prefijo del atributo `type`: ec.edu.epn.booking.autos.<evento>. */
  ceTypePrefix: 'ec.edu.epn.booking.autos',
} as const;

/** Exchange topic compartido con el Booking central. */
export const EXCHANGE_EVENTOS = 'booking.events';

/** Eventos que publica la vertical de autos (routing keys en booking.events). */
export const EVENTOS = {
  ORDEN_CONFIRMADA: 'auto.order.confirmed',
  ORDEN_CANCELADA: 'auto.order.cancelled',
  COOLDOWN_INICIADO: 'auto.cooldown.started',
  COOLDOWN_TERMINADO: 'auto.cooldown.ended',
  MANTENIMIENTO_ALERTA: 'auto.mantenimiento.alerta',
  STOCK_ACTUALIZADO: 'stock.actualizado',
} as const;
export type TipoEvento = typeof EVENTOS[keyof typeof EVENTOS];

/** `type` CloudEvent de una routing key: auto.order.confirmed -> ec.edu.epn.booking.autos.order.confirmed. */
export const ceTypeDe = (routingKey: string) => `${NODO.ceTypePrefix}.${routingKey.replace(/^auto\./, '')}`;

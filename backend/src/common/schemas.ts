/**
 * Esquemas Database-per-Service (RDA2, docs/GUIA_INTEGRACION_AUTOS.md §2): cada microservicio
 * logico es dueno de su esquema y se relaciona con los demas solo por IDs logicos.
 */
export const ESQUEMAS = {
  IDENTITY: 'db_identity',       // users, clientes
  CATALOG: 'db_catalog',         // vehicles, vehicle_images, depots, suppliers
  INVENTORY: 'db_inventory',     // grpc_log
  ORDERS: 'db_orders',           // holds, order_previews, orders, idempotency_records
  COUNTER: 'db_counter',         // checkins (digital, entrega, devolucion)
  MAINTENANCE: 'db_maintenance', // mantenimiento_log
  PRICING: 'db_pricing',         // contrato_promociones_b2b
  OUTBOX: 'db_outbox',           // outbox_events, outbox_booking_notifications
  WEBHOOKS: 'db_webhooks',       // webhook_subscriptions
} as const;

export const LISTA_ESQUEMAS = Object.values(ESQUEMAS);

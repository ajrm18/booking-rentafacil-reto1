/**
 * Corre antes de cargar cualquier modulo de prueba: si hay TEST_DATABASE_URL, la app usa esa BD
 * (ConfigModule no sobrescribe variables ya definidas con las del .env de desarrollo).
 * SUPABASE_URL tiene prioridad sobre DATABASE_URL, asi que tambien se reemplaza: las pruebas
 * NUNCA tocan la base de produccion.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_FILE = 'off';
process.env.OUTBOX_WORKER = 'off';
process.env.BOOKING_NOTIFY_WORKER = 'off';
// Las pruebas no deben publicar en el CloudAMQP real ni llamar al Booking real
process.env.RABBITMQ_URL = process.env.TEST_RABBITMQ_URL ?? '';
for (const k of ['BOOKING_GRPC_HOST', 'BOOKING_GRPC_URL', 'BOOKING_REST_STOCK_URL', 'BOOKING_CHECKIN_URL', 'BOOKING_BASE_URL', 'BOOKING_API_KEY', 'API_KEY_INTERNAL']) {
  process.env[k] = '';
}
// X-API-Key que el Booking usa para llamar a /api/v3 (las pruebas la envian en X-API-Key)
process.env.RENTAFACIL_API_KEY = 'test-rentafacil-api-key-0123456789abcdef';
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.SUPABASE_URL = process.env.TEST_DATABASE_URL;
} else {
  // Sin BD de pruebas: que ninguna prueba se conecte a Supabase por accidente
  process.env.SUPABASE_URL = '';
  process.env.DATABASE_URL = 'postgres://sin-bd-de-pruebas@127.0.0.1:1/none';
}

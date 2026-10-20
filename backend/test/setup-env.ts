/**
 * Corre antes de cargar cualquier modulo de prueba: si hay TEST_DATABASE_URL, la app usa esa BD
 * (ConfigModule no sobrescribe variables ya definidas con las del .env de desarrollo).
 */
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.NODE_ENV = 'test';
}

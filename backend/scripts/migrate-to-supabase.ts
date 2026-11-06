/**
 * Migracion idempotente a Supabase con Database-per-Service (RDA2).
 *
 *   npm run migrate:supabase            (usa SUPABASE_URL, o DATABASE_URL como respaldo)
 *   LEGACY_DATABASE_URL=postgres://...neon... npm run migrate:supabase   (copia ademas los datos de Neon)
 *
 * Pasos (todos se pueden repetir sin duplicar nada):
 *  1. CREATE SCHEMA IF NOT EXISTS de los 9 esquemas (db_identity ... db_webhooks).
 *  2. Crea/actualiza las tablas de cada esquema con las entidades TypeORM (synchronize).
 *  3. Si hay datos legados en schema public (misma BD) o en LEGACY_DATABASE_URL (Neon), los copia
 *     a su esquema nuevo con INSERT ... ON CONFLICT DO NOTHING (solo columnas comunes).
 *  4. Seed: 12 vehiculos, agencias, proveedores, usuarios demo (admin, tecnico MANTENIMIENTO,
 *     maria) y contrato_promociones_b2b (permite_promociones=true, descuento=15).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { asegurarEsquemas, requiereSsl, urlBaseDatos } from '../src/common/database';
import { LISTA_ESQUEMAS } from '../src/common/schemas';
import { sembrarTodo } from '../src/modules/autos/seeds/seed';
import { PromocionesV2Service } from '../src/modules/autos-v2/promociones-v2.service';

/** tabla legada (public) -> esquema nuevo. Orden respetando las FK (catalogo antes que imagenes). */
const MAPA: [string, string][] = [
  ['suppliers', 'db_catalog'], ['depots', 'db_catalog'], ['vehicles', 'db_catalog'], ['vehicle_images', 'db_catalog'],
  ['users', 'db_identity'],
  ['holds', 'db_orders'], ['order_previews', 'db_orders'], ['orders', 'db_orders'], ['idempotency_records', 'db_orders'],
  ['mantenimiento_log', 'db_maintenance'], ['contrato_promociones_b2b', 'db_pricing'],
  ['outbox_events', 'db_outbox'], ['webhook_subscriptions', 'db_webhooks'],
];

async function columnas(c: Client, esquema: string, tabla: string): Promise<string[]> {
  const r = await c.query('SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2', [esquema, tabla]);
  return r.rows.map((x) => x.column_name);
}

async function copiarLegado(origen: Client, destino: Client, etiqueta: string): Promise<void> {
  for (const [tabla, esquema] of MAPA) {
    const colsOrigen = await columnas(origen, 'public', tabla);
    if (!colsOrigen.length) continue;
    const colsDestino = new Set(await columnas(destino, esquema, tabla));
    const comunes = colsOrigen.filter((c) => colsDestino.has(c));
    if (!comunes.length) continue;
    const filas = (await origen.query(`SELECT ${comunes.map((c) => `"${c}"`).join(', ')} FROM public."${tabla}"`)).rows;
    let insertadas = 0;
    for (const f of filas) {
      const vals = comunes.map((c) => (f[c] !== null && typeof f[c] === 'object' && !(f[c] instanceof Date) ? JSON.stringify(f[c]) : f[c]));
      const r = await destino.query(
        `INSERT INTO ${esquema}."${tabla}" (${comunes.map((c) => `"${c}"`).join(', ')}) VALUES (${comunes.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT DO NOTHING`,
        vals,
      );
      insertadas += r.rowCount ?? 0;
    }
    console.log(`  [${etiqueta}] public.${tabla} -> ${esquema}.${tabla}: ${insertadas}/${filas.length} filas nuevas`);
  }
  // Las secuencias de las PK enteras deben seguir al maximo copiado
  for (const [tabla, esquema] of MAPA) {
    const seq = await destino.query(`SELECT pg_get_serial_sequence($1, column_name) AS s, column_name AS c FROM information_schema.columns
      WHERE table_schema = $2 AND table_name = $3 AND column_default LIKE 'nextval%'`, [`${esquema}.${tabla}`, esquema, tabla]);
    for (const { s, c } of seq.rows) {
      if (s) await destino.query(`SELECT setval('${s}', GREATEST((SELECT COALESCE(MAX("${c}"), 0) FROM ${esquema}."${tabla}"), 1))`);
    }
  }
}

async function main() {
  const url = urlBaseDatos();
  if (!url) throw new Error('Configure SUPABASE_URL (o DATABASE_URL) en backend/.env');
  const ssl = requiereSsl(url, process.env.NODE_ENV);
  console.log(`Destino: ${url.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@')}`);

  console.log('1) Esquemas Database-per-Service');
  await asegurarEsquemas(url, ssl);
  console.log(`  ${LISTA_ESQUEMAS.join(', ')}`);

  console.log('2) Tablas (TypeORM synchronize por esquema)');
  process.env.OUTBOX_WORKER = 'off';
  process.env.BOOKING_NOTIFY_WORKER = 'off';
  process.env.GRPC_ENABLED = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const ds = app.get(DataSource);

  console.log('3) Datos legados');
  const destino = new Client({ connectionString: url, ssl: ssl ? { rejectUnauthorized: false } : false });
  await destino.connect();
  try {
    await copiarLegado(destino, destino, 'misma BD');
    const legado = (process.env.LEGACY_DATABASE_URL || '').trim();
    if (legado) {
      const origen = new Client({ connectionString: legado, ssl: requiereSsl(legado, 'production') ? { rejectUnauthorized: false } : false });
      await origen.connect();
      try { await copiarLegado(origen, destino, 'Neon'); } finally { await origen.end(); }
    } else {
      console.log('  (sin LEGACY_DATABASE_URL: no se copia desde Neon)');
    }
  } finally {
    await destino.end();
  }

  console.log('4) Seed idempotente');
  await sembrarTodo(ds);
  await app.get(PromocionesV2Service).onModuleInit();
  const [{ n }] = await ds.query('SELECT COUNT(*)::int AS n FROM db_catalog.vehicles');
  const tablas = await ds.query(`SELECT table_schema, COUNT(*)::int AS tablas FROM information_schema.tables
    WHERE table_schema = ANY($1) GROUP BY table_schema ORDER BY table_schema`, [LISTA_ESQUEMAS]);
  console.table(tablas);
  console.log(`OK - ${n} vehiculos en db_catalog.vehicles`);
  await app.close();
  process.exit(0);
}

main().catch((e) => { console.error('Migracion fallida:', e?.message ?? e); process.exit(1); });

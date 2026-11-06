import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Client } from 'pg';
import { log } from './app-logger';
import { LISTA_ESQUEMAS } from './schemas';

/** SUPABASE_URL (Session pooler :5432) con DATABASE_URL como respaldo (Neon / Docker local). */
export function urlBaseDatos(get: (k: string) => string | undefined = (k) => process.env[k]): string {
  const url = (get('SUPABASE_URL') || '').trim();
  const valida = url && !url.includes('${') && /^postgres(ql)?:\/\//.test(url);
  return valida ? url : (get('DATABASE_URL') || '').trim();
}

/** TLS obligatorio en Supabase/Neon/produccion; desactivado en localhost (Docker). */
export function requiereSsl(url: string, nodeEnv?: string): boolean {
  if (/sslmode=disable/.test(url)) return false;
  if (/supabase\.com|neon\.tech|render\.com|azure/.test(url) || /sslmode=require/.test(url)) return true;
  if (/@(localhost|127\.0\.0\.1|postgres|db)(:|\/)/.test(url)) return false;
  return nodeEnv === 'production';
}

/** Crea los 9 esquemas Database-per-Service antes de que TypeORM sincronice las tablas. */
export async function asegurarEsquemas(url: string, ssl: boolean): Promise<void> {
  const c = new Client({ connectionString: url, ssl: ssl ? { rejectUnauthorized: false } : false, connectionTimeoutMillis: 10_000 });
  try {
    await c.connect();
    for (const e of LISTA_ESQUEMAS) await c.query(`CREATE SCHEMA IF NOT EXISTS ${e}`);
  } finally {
    await c.end().catch(() => undefined);
  }
}

export async function opcionesBaseDatos(config: ConfigService): Promise<TypeOrmModuleOptions> {
  const url = urlBaseDatos((k) => config.get<string>(k));
  const ssl = requiereSsl(url, config.get<string>('NODE_ENV'));
  const supabase = /supabase\.com/.test(url);
  try {
    await asegurarEsquemas(url, ssl);
    log.info('DB', `conexion ${supabase ? 'Supabase Session pooler' : 'PostgreSQL'} -> UP`, { esquemas: LISTA_ESQUEMAS.length, host: url.replace(/^.*@/, '').replace(/\/.*$/, '') });
  } catch (e: any) {
    log.error('DB', `conexion ${supabase ? 'Supabase Session pooler' : 'PostgreSQL'} -> DOWN`, { error: e?.message });
  }
  return {
    type: 'postgres',
    url,
    autoLoadEntities: true,
    // El esquema lo crea scripts/migrate-to-supabase.ts; synchronize mantiene las columnas nuevas (DB_SYNCHRONIZE=false para apagarlo)
    synchronize: config.get<string>('DB_SYNCHRONIZE') !== 'false',
    ssl: ssl ? { rejectUnauthorized: false } : false,
    // Pool pequeno: el Session pooler gratuito de Supabase limita las conexiones por cliente.
    // `prepare: false` lo piden las guias del pooler (no afecta a node-postgres, que no prepara sentencias con nombre).
    extra: { max: Number(config.get('DB_POOL_MAX') || 5), connectionTimeoutMillis: 10_000, idleTimeoutMillis: 600_000, keepAlive: true, prepare: false },
    retryAttempts: 5,
    retryDelay: 3000,
    logging: config.get<string>('NODE_ENV') === 'production' ? ['error'] : ['error', 'warn'],
  };
}

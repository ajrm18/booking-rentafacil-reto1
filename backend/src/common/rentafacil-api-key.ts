import { randomBytes, timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { log } from './app-logger';
import { correlationIdDe } from './correlation';
import { claveConfigurada } from './http-saliente';

/**
 * RENTAFACIL_API_KEY: la X-API-Key que el Booking Central usa para llamar a RentaFacil (/api/v3).
 * No confundir con BOOKING_API_KEY (la que RentaFacil usa para llamar al Booking).
 * Si no esta configurada se genera una aleatoria (equivalente a `openssl rand -hex 24`) que dura
 * lo que dure el proceso; en Azure se fija como Application setting para que sea estable.
 */
let generada: string | null = null;

/** Valor real de la variable (ignora vacio, PENDIENTE... y el placeholder <...> de .env.example). */
const claveEnv = () => {
  const v = claveConfigurada(process.env.RENTAFACIL_API_KEY);
  return v && !v.startsWith('<') ? v : null;
};

export function rentafacilApiKey(): string {
  const env = claveEnv();
  if (env) return env;
  if (!generada) generada = randomBytes(24).toString('hex');
  return generada;
}

export const rentafacilApiKeyGenerada = () => !claveEnv();

/** X-API-Key aceptadas en /api/v3: RENTAFACIL_API_KEY (Booking) y API_KEY_INTERNAL (propia, opcional). */
export function clavesApiV3(): string[] {
  return [rentafacilApiKey(), claveConfigurada(process.env.API_KEY_INTERNAL)].filter((k): k is string => !!k);
}

export function claveValidaV3(apiKey: string): boolean {
  const a = Buffer.from(String(apiKey ?? '').trim());
  if (!a.length) return false;
  return clavesApiV3().some((e) => { const b = Buffer.from(e); return a.length === b.length && timingSafeEqual(a, b); });
}

/** Rutas M2M del Booking que exigen credencial: /api/v3/autos/orders*, /api/v3/autos/reservas*, /api/v3/clientes*. */
export const RUTA_PROTEGIDA_V3 = /^\/api\/v3\/(autos\/(orders|reservas)|clientes)(\/|$)/i;

export function problemaApiKey(req: Request) {
  return {
    type: 'https://rentafacil.ec/errors/unauthorized',
    title: 'Unauthorized',
    status: 401,
    detail: 'X-API-Key missing or invalid',
    code: 'MISSING_API_KEY',
    instance: req.originalUrl ?? req.url,
    correlation_id: correlationIdDe(req) || null,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Middleware de /api/v3 (Ajuste 4 del feedback del Booking): en las rutas protegidas exige una
 * X-API-Key valida. El panel web propio (mostrador, /admin/clientes) se autentica con
 * Authorization: Bearer <JWT>; ese caso pasa y lo valida V3AuthGuard. Sin X-API-Key ni JWT,
 * o con una X-API-Key que no coincide -> 401 MISSING_API_KEY. /api/v1 y /api/v2 no se tocan.
 */
export function apiKeyV3Middleware(req: Request, res: Response, next: NextFunction): void {
  const ruta = (req.originalUrl ?? req.url ?? '').split('?')[0];
  if (req.method === 'OPTIONS' || !RUTA_PROTEGIDA_V3.test(ruta)) return next();

  const apiKey = String(req.headers['x-api-key'] ?? '').trim();
  const bearer = String(req.headers['authorization'] ?? '').startsWith('Bearer ');
  if (apiKey && claveValidaV3(apiKey)) {
    log.info('AUTH', `${ruta} -> OK sender=BOOKING`);
    return next();
  }
  if (!apiKey && bearer) {
    log.info('AUTH', `${ruta} -> OK sender=WEB_JWT`);
    return next();
  }
  log.warn('AUTH', `${ruta} -> 401 MISSING_API_KEY`, { motivo: apiKey ? 'X-API-Key invalida' : 'sin X-API-Key' });
  res.status(401).type('application/problem+json').json(problemaApiKey(req));
}

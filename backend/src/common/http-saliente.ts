import { randomUUID } from 'crypto';
import { correlationActual } from './request-context';

/**
 * Cliente HTTP saliente (fetch nativo de Node 22, sin axios): agrega X-Correlation-Id del contexto
 * de la peticion (o el que se pase) y aplica un timeout duro. Es el "interceptor" de todas las
 * llamadas a Booking central (check-in, fallback REST de stock).
 */
export interface OpcionesSaliente {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  correlationId?: string;
}

export interface RespuestaSaliente { status: number; ok: boolean; body: any; ms: number }

/** Implementacion intercambiable en pruebas (mock del fetch). */
export let fetchImpl: typeof fetch = (input, init) => fetch(input, init);
export const usarFetch = (f: typeof fetch) => { fetchImpl = f; };

export async function httpSaliente(url: string, o: OpcionesSaliente = {}): Promise<RespuestaSaliente> {
  const t0 = Date.now();
  const correlation = o.correlationId || correlationActual() || randomUUID();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 5000);
  try {
    const r = await fetchImpl(url, {
      method: o.method ?? 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Correlation-Id': correlation, ...(o.headers ?? {}) },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: ctrl.signal,
    });
    const texto = await r.text();
    let body: any = texto;
    try { body = texto ? JSON.parse(texto) : null; } catch { /* respuesta no JSON */ }
    return { status: r.status, ok: r.ok, body, ms: Date.now() - t0 };
  } catch (e: any) {
    const err: any = new Error(e?.name === 'AbortError' ? `timeout de ${o.timeoutMs ?? 5000} ms` : e?.message ?? String(e));
    err.status = e?.name === 'AbortError' ? 504 : 502;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Claves de API "por definir" (p. ej. PENDIENTE_ME_LA_DARA_EL_PROFESOR) cuentan como no configuradas. */
export function claveConfigurada(v: string | undefined): string | null {
  const s = (v ?? '').trim();
  if (!s || /^PENDIENTE/i.test(s) || /^CHANGE|^TU_/i.test(s)) return null;
  return s;
}

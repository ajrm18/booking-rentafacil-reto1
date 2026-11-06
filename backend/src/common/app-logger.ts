import { LoggerService } from '@nestjs/common';
import { join } from 'path';
import * as winston from 'winston';
import DailyRotateFile = require('winston-daily-rotate-file');
import { correlationActual } from './request-context';

export type Nivel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

const DIR = process.env.LOG_DIR || join(process.cwd(), 'logs');
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** [YYYY-MM-DD HH:mm:ss.SSS] en UTC (el Log Stream de Azure tambien usa UTC). */
export function marcaTiempo(d = new Date()): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
}

const valor = (v: unknown) => (v === undefined || v === null ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * Linea canonica de log: `[YYYY-MM-DD HH:mm:ss.SSS] [NIVEL] [MODULO] mensaje | k=v | correlation=<id>`.
 * El correlation id sale del contexto de la peticion si no se pasa explicitamente.
 */
export function formatearLinea(nivel: Nivel, modulo: string, mensaje: string, kv: Record<string, unknown> = {}, ahora = new Date()): string {
  const datos: Record<string, unknown> = { ...kv };
  if (datos.correlation === undefined) {
    const c = correlationActual();
    if (c) datos.correlation = c;
  }
  const extra = Object.entries(datos).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${valor(v)}`).join(' | ');
  return `[${marcaTiempo(ahora)}] [${nivel}] [${modulo}] ${mensaje}${extra ? ` | ${extra}` : ''}`;
}

let archivo: winston.Logger | null | undefined;

/** logs/combined-YYYY-MM-DD.log (rotacion diaria, 14 dias) + logs/error-YYYY-MM-DD.log. */
function logArchivo(): winston.Logger | null {
  if (archivo !== undefined) return archivo;
  if (process.env.NODE_ENV === 'test' || process.env.LOG_FILE === 'off') return (archivo = null);
  try {
    const formato = winston.format.printf((i) => String(i.message));
    archivo = winston.createLogger({
      level: 'debug',
      format: formato,
      transports: [
        new DailyRotateFile({ dirname: DIR, filename: 'combined-%DATE%.log', datePattern: 'YYYY-MM-DD', maxFiles: '14d', maxSize: '20m' }),
        new DailyRotateFile({ dirname: DIR, filename: 'error-%DATE%.log', datePattern: 'YYYY-MM-DD', maxFiles: '14d', level: 'error' }),
      ],
    });
    archivo.on('error', () => { archivo = null; });
  } catch {
    archivo = null; // disco de solo lectura: queda solo la consola
  }
  return archivo;
}

/** Lineas emitidas (para las pruebas): se activa con captura(true). */
let capturadas: string[] | null = null;
export const captura = (on: boolean) => { capturadas = on ? [] : null; };
export const lineasCapturadas = () => capturadas ?? [];

export function escribir(nivel: Nivel, modulo: string, mensaje: string, kv?: Record<string, unknown>): string {
  const linea = formatearLinea(nivel, modulo, mensaje, kv);
  capturadas?.push(linea);
  const silencioso = process.env.NODE_ENV === 'test' && !process.env.LOG_TEST;
  if (!silencioso) {
    if (nivel === 'ERROR') console.error(linea);
    else if (nivel === 'WARN') console.warn(linea);
    else console.log(linea);
  }
  logArchivo()?.log({ level: nivel === 'ERROR' ? 'error' : nivel === 'WARN' ? 'warn' : nivel === 'DEBUG' ? 'debug' : 'info', message: linea });
  return linea;
}

/** API corta para los modulos: log.info('CLIENTES', 'GET email=x -> FOUND', { status: 200 }). */
export const log = {
  info: (modulo: string, mensaje: string, kv?: Record<string, unknown>) => escribir('INFO', modulo, mensaje, kv),
  warn: (modulo: string, mensaje: string, kv?: Record<string, unknown>) => escribir('WARN', modulo, mensaje, kv),
  error: (modulo: string, mensaje: string, kv?: Record<string, unknown>) => escribir('ERROR', modulo, mensaje, kv),
};

/** Logger global de Nest con el mismo formato (los Logger('X') existentes salen como [X]). */
export class AppLogger implements LoggerService {
  log(message: any, context?: string) { escribir('INFO', (context || 'APP').toUpperCase(), String(message)); }
  warn(message: any, context?: string) { escribir('WARN', (context || 'APP').toUpperCase(), String(message)); }
  error(message: any, trace?: string, context?: string) {
    escribir('ERROR', (context || 'APP').toUpperCase(), String(message), trace && process.env.NODE_ENV !== 'production' ? { trace: trace.split('\n')[1]?.trim() } : undefined);
  }
  debug(message: any, context?: string) { if (process.env.LOG_DEBUG) escribir('DEBUG', (context || 'APP').toUpperCase(), String(message)); }
  verbose(message: any, context?: string) { this.debug(message, context); }
}

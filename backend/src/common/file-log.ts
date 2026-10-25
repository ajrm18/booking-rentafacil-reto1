import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';

const DIR = process.env.LOG_DIR || join(process.cwd(), 'logs');

/**
 * Registro fisico de fallos de integracion (logs/error.log, una linea JSON por evento), como pide
 * docs/integracion-booking.md §3.4 para los push de stock que fallan. Nunca lanza.
 */
export async function logError(origen: string, detalle: Record<string, any>): Promise<void> {
  try {
    await mkdir(DIR, { recursive: true });
    await appendFile(join(DIR, 'error.log'), `${JSON.stringify({ time: new Date().toISOString(), origen, ...detalle })}\n`);
  } catch { /* disco de solo lectura o sin permisos: el log de Nest ya registro el error */ }
}

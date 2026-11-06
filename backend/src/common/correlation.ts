import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { contexto } from './request-context';

export const CORRELATION_HEADER = 'X-Correlation-Id';

/**
 * Trazabilidad end-to-end: lee X-Correlation-Id (o genera un UUID v4 si el cliente no lo envia; el
 * contrato lo declara opcional), lo devuelve en la respuesta y lo deja en el contexto de la
 * peticion (AsyncLocalStorage) para los logs, las llamadas salientes y los CloudEvents.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const recibido = String(req.headers['x-correlation-id'] ?? '').trim();
  const id = recibido && recibido.length <= 120 ? recibido : randomUUID();
  (req as any).correlationId = id;
  res.setHeader(CORRELATION_HEADER, id);
  contexto.run({ correlationId: id, metodo: req.method, ruta: req.originalUrl ?? req.url }, () => next());
}

export const correlationIdDe = (req: Request): string => (req as any).correlationId ?? String(req.headers['x-correlation-id'] ?? '');

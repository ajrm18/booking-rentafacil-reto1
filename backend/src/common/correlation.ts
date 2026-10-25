import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

export const CORRELATION_HEADER = 'X-Correlation-Id';

/**
 * Trazabilidad end-to-end: propaga X-Correlation-Id (o genera uno si el cliente no lo envia; el
 * contrato v2 lo declara opcional) a la respuesta, a los Problem Details y a los CloudEvents.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const recibido = String(req.headers['x-correlation-id'] ?? '').trim();
  const id = recibido && recibido.length <= 120 ? recibido : `corr-autos-${randomUUID().slice(0, 12)}`;
  (req as any).correlationId = id;
  res.setHeader(CORRELATION_HEADER, id);
  next();
}

export const correlationIdDe = (req: Request): string => (req as any).correlationId ?? String(req.headers['x-correlation-id'] ?? '');

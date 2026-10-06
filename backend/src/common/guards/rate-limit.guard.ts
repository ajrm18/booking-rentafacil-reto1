import {
  CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Limite de peticiones por afiliado (ventana fija de 60 s), segun
 * components.responses.ProblemDetails429 de autos-openapi.yaml: responde 429 con
 * code RATE_LIMIT_EXCEEDED y la cabecera Retry-After (segundos).
 *
 * En memoria: suficiente para una sola instancia (Reto 1). En Reto 2 se movera a Redis.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private static readonly WINDOW_MS = 60_000;
  private static readonly LIMIT = Number(process.env.RATE_LIMIT_PER_MINUTE) || 120;
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const key = `${req.headers['x-affiliate-id'] ?? 'anon'}|${req.ip}`;
    const now = Date.now();

    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + RateLimitGuard.WINDOW_MS };
      this.hits.set(key, entry);
      if (this.hits.size > 10_000) this.purge(now);
    }
    entry.count++;

    if (entry.count > RateLimitGuard.LIMIT) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      throw new HttpException(
        {
          type: 'https://api.booking-hub.com/errors/rate-limit-exceeded',
          title: 'Demasiadas peticiones',
          status: HttpStatus.TOO_MANY_REQUESTS,
          detail: `Limite de ${RateLimitGuard.LIMIT} peticiones por minuto excedido. Reintente en ${retryAfter} s.`,
          code: 'RATE_LIMIT_EXCEEDED',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private purge(now: number): void {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}

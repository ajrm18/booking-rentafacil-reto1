import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { problema } from './problema';

/** UUID version 4 (variante RFC 4122), como exige components.parameters.IdempotencyKeyHeader. */
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Exige la cabecera Idempotency-Key (UUID v4) en las mutaciones de /api/v2 -> 400 si falta o es invalida. */
@Injectable()
export class IdempotencyV2Guard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const clave = String(req.headers['idempotency-key'] ?? '').trim();
    if (!clave) {
      throw problema(400, 'IDEMPOTENCY_KEY_REQUIRED',
        'Las operaciones que mutan estado requieren la cabecera Idempotency-Key (UUID v4) para tolerar reintentos de red.',
        { title: 'Falta la cabecera Idempotency-Key', invalid_params: [{ name: 'Idempotency-Key', reason: 'Cabecera obligatoria' }] });
    }
    if (!UUID_V4.test(clave)) {
      throw problema(400, 'IDEMPOTENCY_KEY_INVALID', `La cabecera Idempotency-Key debe ser un UUID v4. Recibido: "${clave}".`,
        { title: 'Idempotency-Key inválida', invalid_params: [{ name: 'Idempotency-Key', reason: 'Debe ser un UUID v4' }] });
    }
    return true;
  }
}

export const idempotencyKeyDe = (req: Request) => String(req.headers['idempotency-key']).trim().toLowerCase();

/**
 * Variante de /api/v3 para POST /autos/orders/{pnr}/cancel (Ajuste 1): la cabecera es OPCIONAL.
 * Si viene debe ser un UUID v4 (400 si no); si falta, el servicio deduplica por pnr + fecha.
 */
@Injectable()
export class IdempotencyOpcionalGuard implements CanActivate {
  private readonly estricto = new IdempotencyV2Guard();

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!String(req.headers['idempotency-key'] ?? '').trim()) return true;
    return this.estricto.canActivate(ctx);
  }
}

/** Idempotency-Key de la cabecera o '' si no vino (solo con IdempotencyOpcionalGuard). */
export const idempotencyKeyOpcionalDe = (req: Request) => String(req.headers['idempotency-key'] ?? '').trim().toLowerCase();

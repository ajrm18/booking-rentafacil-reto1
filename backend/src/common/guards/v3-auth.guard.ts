import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { log } from '../app-logger';
import { problema } from '../../modules/autos-v2/problema';
import { AuthV2, autenticarBearer, RolV2 } from '../../modules/autos-v2/v2-auth.guard';
import { claveValidaV3 } from '../rentafacil-api-key';

const ROLES_KEY = 'rolesV2';
const TOLERANTE_KEY = 'v3Tolerante';

/**
 * Endpoints publicos de lectura (p. ej. GET /autos/promociones/contrato, GET /autos/eventos): sin
 * credenciales se atienden como B2B. Las rutas M2M del Booking (/autos/orders*, /autos/reservas*,
 * /clientes*) ya NO son tolerantes: las protege apiKeyV3Middleware (401 MISSING_API_KEY).
 * Una X-API-Key INCORRECTA siempre es 401.
 */
export const ToleranteSinCredenciales = () => SetMetadata(TOLERANTE_KEY, true);

const B2B: AuthV2 = { sub: 'b2b:booking-prototipo', rol: 'B2B', scopes: [] };

/**
 * Seguridad del contrato v3 (security: BearerAuth | ApiKeyAuth):
 *  - X-API-Key valida (RENTAFACIL_API_KEY o API_KEY_INTERNAL) -> rol B2B.
 *  - Authorization: Bearer <JWT> -> rol del token (ADMIN, MANTENIMIENTO, CLIENTE).
 */
@Injectable()
export class V3AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const tolerante = this.reflector.getAllAndOverride<boolean>(TOLERANTE_KEY, [ctx.getHandler(), ctx.getClass()]);
    const auth = this.autenticar(req, !!tolerante);
    const roles = this.reflector.getAllAndOverride<RolV2[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !roles.includes(auth.rol)) {
      throw problema(403, 'FORBIDDEN', `Esta operación requiere el rol ${roles.join(' o ')}; la credencial tiene el rol ${auth.rol}.`,
        { title: 'Acceso restringido por rol insuficiente' });
    }
    (req as any).authV2 = auth;
    return true;
  }

  private autenticar(req: Request, tolerante: boolean): AuthV2 {
    const apiKey = String(req.headers['x-api-key'] ?? '').trim();
    const bearer = String(req.headers['authorization'] ?? '').startsWith('Bearer ');
    if (apiKey) {
      if (claveValidaV3(apiKey)) return B2B;
      throw problema(401, 'MISSING_API_KEY', 'X-API-Key missing or invalid', { title: 'Unauthorized', type: 'https://rentafacil.ec/errors/unauthorized' });
    }
    if (bearer) return autenticarBearer(req, this.jwt);
    if (tolerante) {
      log.info('AUTH', `${req.originalUrl.split('?')[0]} -> publico (sin credenciales)`);
      return B2B;
    }
    return autenticarBearer(req, this.jwt); // lanza el 401 estandar
  }
}

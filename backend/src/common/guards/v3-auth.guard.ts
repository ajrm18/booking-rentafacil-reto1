import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { log } from '../app-logger';
import { problema } from '../../modules/autos-v2/problema';
import { AuthV2, autenticarBearer, claveValida, clavesApi, RolV2 } from '../../modules/autos-v2/v2-auth.guard';

const ROLES_KEY = 'rolesV2';
const TOLERANTE_KEY = 'v3Tolerante';

/**
 * Endpoints que el Booking central invoca M2M (reservas, cancelacion, clientes): si llegan sin
 * credenciales se atienden como B2B con un WARN en el log, para que la demo del ingeniero no falle
 * mientras el profesor no entregue la X-API-Key definitiva. Una X-API-Key INCORRECTA siempre es 401.
 */
export const ToleranteSinCredenciales = () => SetMetadata(TOLERANTE_KEY, true);

const B2B: AuthV2 = { sub: 'b2b:booking-prototipo', rol: 'B2B', scopes: [] };

/**
 * Seguridad del contrato v3 (security: BearerAuth | ApiKeyAuth):
 *  - X-API-Key valida (BOOKING_API_KEY o API_KEY_INTERNAL) -> rol B2B.
 *  - X-API-Key presente con la clave aun "PENDIENTE" en el servidor -> B2B aceptado con WARN.
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
      const esperadas = clavesApi();
      if (!esperadas.length) {
        log.warn('AUTH', 'X-API-Key recibida pero BOOKING_API_KEY esta pendiente en el servidor -> aceptada como B2B', { ruta: req.originalUrl });
        return B2B;
      }
      if (claveValida(apiKey, esperadas)) return B2B;
      if (!bearer) throw problema(401, 'UNAUTHORIZED', 'La X-API-Key no es válida.', { title: 'Credenciales inválidas' });
    }
    if (bearer) return autenticarBearer(req, this.jwt);
    if (tolerante) {
      log.warn('AUTH', 'Peticion sin X-API-Key ni JWT -> tolerada como B2B (demo)', { ruta: req.originalUrl });
      return B2B;
    }
    return autenticarBearer(req, this.jwt); // lanza el 401 estandar
  }
}

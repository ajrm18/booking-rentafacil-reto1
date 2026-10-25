import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { problema } from './problema';

/** Roles del contrato v2 (BearerAuth: CLIENTE, ADMIN, MANTENIMIENTO) + B2B para el Booking por X-API-Key. */
export type RolV2 = 'CLIENTE' | 'ADMIN' | 'MANTENIMIENTO' | 'B2B';

export interface AuthV2 { sub: string; rol: RolV2; scopes: string[] }

const ROLES_KEY = 'rolesV2';
/** Restringe el endpoint a esos roles (sin el decorador basta con estar autenticado). */
export const Roles = (...roles: RolV2[]) => SetMetadata(ROLES_KEY, roles);

/** Rol del JWT emitido por /api/v1/auth/token (role: admin | client | mechanic). */
export function rolDesdeToken(payload: any): RolV2 {
  const r = String(payload?.role ?? '').toLowerCase();
  if (r === 'admin') return 'ADMIN';
  if (r === 'mechanic' || r === 'mantenimiento') return 'MANTENIMIENTO';
  if (r === 'cliente' || r === 'client') return 'CLIENTE';
  // Tokens del Reto 1 sin role: el scope de administracion identifica al admin
  const scopes: string[] = Array.isArray(payload?.scopes) ? payload.scopes : [];
  return scopes.includes('autos:webhooks') ? 'ADMIN' : 'CLIENTE';
}

/**
 * Seguridad global del contrato v2: BearerAuth (JWT HS256) o ApiKeyAuth (X-API-Key, comunicacion
 * M2M con el Booking; activa solo si BOOKING_API_KEY esta configurada). El rol efectivo sale
 * siempre del token: la cabecera X-Role del contrato es informativa y no eleva privilegios.
 */
@Injectable()
export class V2AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const auth = this.autenticar(req);
    const roles = this.reflector.getAllAndOverride<RolV2[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !roles.includes(auth.rol)) {
      throw problema(403, 'FORBIDDEN',
        `Esta operación requiere el rol ${roles.join(' o ')}; el token tiene el rol ${auth.rol}.`,
        { title: 'Acceso restringido por rol insuficiente' });
    }
    (req as any).authV2 = auth;
    return true;
  }

  private autenticar(req: Request): AuthV2 {
    const apiKey = req.headers['x-api-key'] as string | undefined;
    const esperada = process.env.BOOKING_API_KEY;
    if (apiKey && esperada) {
      const a = Buffer.from(apiKey), b = Buffer.from(esperada);
      if (a.length === b.length && timingSafeEqual(a, b)) return { sub: 'b2b:booking-prototipo', rol: 'B2B', scopes: [] };
      throw problema(401, 'UNAUTHORIZED', 'La X-API-Key no es válida.', { title: 'Credenciales inválidas' });
    }
    const h = req.headers['authorization'] as string | undefined;
    if (!h || !h.startsWith('Bearer ')) {
      throw problema(401, 'UNAUTHORIZED', 'Envíe la cabecera Authorization: Bearer <JWT> (POST /api/v1/auth/token) o X-API-Key.',
        { title: 'Se requiere autenticación' });
    }
    try {
      const payload: any = this.jwt.verify(h.slice(7).trim());
      return {
        sub: payload.sub, rol: rolDesdeToken(payload),
        scopes: Array.isArray(payload.scopes) ? payload.scopes : String(payload.scope ?? '').split(' ').filter(Boolean),
      };
    } catch {
      throw problema(401, 'UNAUTHORIZED', 'El token JWT expiró o no es válido. Vuelva a iniciar sesión.', { title: 'Sesión inválida o expirada' });
    }
  }
}

export const authV2De = (req: Request): AuthV2 => (req as any).authV2;
/** ADMIN y B2B (el Booking) ven y operan todas las ordenes; CLIENTE solo las suyas. */
export const veTodo = (a: AuthV2) => a.rol === 'ADMIN' || a.rol === 'B2B' || a.rol === 'MANTENIMIENTO';

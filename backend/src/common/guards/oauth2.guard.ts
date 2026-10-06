import {
  CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

/** Identidad extraida del JWT y adjuntada a request.auth por OAuth2Guard. */
export interface AuthContext { sub: string; scopes: string[] }

export const SCOPES_KEY = 'oauth2Scopes';
export const RequireScopes = (...scopes: string[]) => SetMetadata(SCOPES_KEY, scopes);

/**
 * Guard que exige un JWT (OAuth2) con los scopes declarados.
 * Se aplica a los endpoints protegidos (/orders/*, /webhooks*) segun autos-openapi.yaml.
 *
 * En un entorno productivo el token proviene del Authorization Server declarado en el contrato
 * (https://auth.booking-hub.com/oauth2/token). Para el Reto 1 se firma localmente con un
 * secreto compartido, manteniendo la misma forma del payload: sub, scopes.
 */
@Injectable()
export class OAuth2Guard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const auth = request.headers['authorization'] as string | undefined;

    if (!auth || !auth.startsWith('Bearer ')) {
      throw new HttpException(
        {
          type: 'https://api.booking-hub.com/errors/missing-token',
          title: 'Se requiere iniciar sesión',
          status: HttpStatus.UNAUTHORIZED,
          detail: 'Envíe la cabecera Authorization: Bearer <token>.',
          code: 'VALIDATION_FAILED',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const token = auth.slice(7).trim();
    let payload: any;
    try {
      payload = this.jwt.verify(token);
    } catch (e) {
      throw new HttpException(
        {
          type: 'https://api.booking-hub.com/errors/invalid-token',
          title: 'Sesión inválida o expirada',
          status: HttpStatus.UNAUTHORIZED,
          detail: 'Tu sesión expiró o no es válida. Vuelve a iniciar sesión.',
          code: 'VALIDATION_FAILED',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const required = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, [
      context.getHandler(), context.getClass(),
    ]) || [];
    const tokenScopes: string[] = Array.isArray(payload.scopes)
      ? payload.scopes
      : (payload.scope || '').split(' ').filter(Boolean);

    for (const s of required) {
      if (!tokenScopes.includes(s)) {
        throw new HttpException(
          {
            type: 'https://api.booking-hub.com/errors/insufficient-scope',
            title: 'Permisos insuficientes',
            status: HttpStatus.FORBIDDEN,
            detail: `El token no tiene el permiso requerido: ${s}`,
            code: 'VALIDATION_FAILED',
          },
          HttpStatus.FORBIDDEN,
        );
      }
    }

    (request as any).auth = { sub: payload.sub, scopes: tokenScopes } satisfies AuthContext;
    return true;
  }
}

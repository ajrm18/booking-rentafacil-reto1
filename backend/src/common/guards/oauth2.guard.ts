import {
  CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

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
          title: 'OAuth2 access token is required',
          status: HttpStatus.UNAUTHORIZED,
          detail: 'Send an Authorization: Bearer <token> header.',
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
          title: 'Invalid or expired token',
          status: HttpStatus.UNAUTHORIZED,
          detail: 'The provided OAuth2 access token could not be verified.',
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
            title: 'Insufficient scope',
            status: HttpStatus.FORBIDDEN,
            detail: `Token missing required scope: ${s}`,
            code: 'VALIDATION_FAILED',
          },
          HttpStatus.FORBIDDEN,
        );
      }
    }

    (request as any).auth = { sub: payload.sub, scopes: tokenScopes };
    return true;
  }
}

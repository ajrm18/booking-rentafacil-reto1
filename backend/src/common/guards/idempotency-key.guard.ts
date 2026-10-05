import {
  CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable,
} from '@nestjs/common';
import { Request } from 'express';

/**
 * Guard que exige la cabecera `Idempotency-Key` en formato UUID.
 * Se aplica a los endpoints POST /orders/create, /orders/{id}/modify y /orders/{id}/cancel,
 * segun autos-openapi.yaml.
 *
 * Si el cliente no envia la cabecera o su valor no es un UUID valido, se responde con
 * 400 Bad Request en formato application/problem+json (RFC 7807).
 */
@Injectable()
export class IdempotencyKeyGuard implements CanActivate {
  private static readonly UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    if (!idempotencyKey || idempotencyKey.trim() === '') {
      throw new HttpException(
        {
          type: 'https://api.booking-hub.com/errors/missing-idempotency-key',
          title: 'Idempotency-Key header is required',
          status: HttpStatus.BAD_REQUEST,
          detail:
            'All transactional endpoints require an Idempotency-Key header (UUID v4) ' +
            'to prevent duplicate operations such as double charges.',
          code: 'VALIDATION_FAILED',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!IdempotencyKeyGuard.UUID_REGEX.test(idempotencyKey)) {
      throw new HttpException(
        {
          type: 'https://api.booking-hub.com/errors/invalid-idempotency-key',
          title: 'Invalid Idempotency-Key format',
          status: HttpStatus.BAD_REQUEST,
          detail: `The Idempotency-Key header must be a valid UUID v4. Received: "${idempotencyKey}".`,
          code: 'VALIDATION_FAILED',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return true;
  }
}

import {
  CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable,
} from '@nestjs/common';
import { Request } from 'express';

/**
 * Guard que exige la cabecera `X-Affiliate-Id` (integer positivo).
 * Se aplica a los endpoints publicos (/search, /depots, /details, /suppliers, /constants,
 * /depots/reviews/scores) segun autos-openapi.yaml.
 */
@Injectable()
export class AffiliateGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const raw = request.headers['x-affiliate-id'] as string | undefined;

    if (!raw || raw.trim() === '') {
      throw new HttpException(
        {
          type: 'https://api.booking-hub.com/errors/missing-affiliate-id',
          title: 'X-Affiliate-Id header is required',
          status: HttpStatus.BAD_REQUEST,
          detail: 'This endpoint requires an X-Affiliate-Id header with a positive integer value.',
          code: 'VALIDATION_FAILED',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new HttpException(
        {
          type: 'https://api.booking-hub.com/errors/invalid-affiliate-id',
          title: 'Invalid X-Affiliate-Id format',
          status: HttpStatus.BAD_REQUEST,
          detail: `X-Affiliate-Id must be a positive integer. Received: "${raw}".`,
          code: 'VALIDATION_FAILED',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    (request as any).affiliateId = parsed;
    return true;
  }
}

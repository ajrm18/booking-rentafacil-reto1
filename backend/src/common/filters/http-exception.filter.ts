import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { correlationIdDe } from '../correlation';

/** Valores permitidos de ProblemDetails.code (enum de autos-openapi.yaml). */
const PROBLEM_CODES = new Set([
  'VALIDATION_FAILED', 'CAR_NO_LONGER_AVAILABLE', 'PRICE_CHANGED', 'DEPOT_CLOSED',
  'DRIVER_AGE_RESTRICTION', 'BOOKING_NOT_CONFIRMED', 'CANCELLATION_NOT_ALLOWED',
  'RATE_LIMIT_EXCEEDED', 'PAYMENT_REFERENCE_INVALID', 'PAYMENT_NOT_AUTHORIZED',
]);

/** Segundos sugeridos en Retry-After para 409 (el contrato declara la cabecera en ProblemDetails409). */
const RETRY_AFTER_CONFLICT_S = 5;

/** Codigo por defecto de /api/v2 segun el estado HTTP (contrato v2: 400, 401, 403, 404, 409, 422, 500, 503). */
const CODIGO_V2: Record<number, string> = {
  400: 'VALIDATION_FAILED', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY', 429: 'RATE_LIMIT_EXCEEDED', 500: 'INTERNAL_ERROR', 503: 'SERVICE_UNAVAILABLE',
};

/**
 * Filtro global que serializa cualquier excepcion como application/problem+json (RFC 7807).
 * /api/v1: alineado con components.responses.ProblemDetails* de autos-openapi.yaml; ese schema
 * tiene additionalProperties: false, por eso solo se emiten type, title, status, detail, code e invalidParams.
 * /api/v2: components.schemas.ProblemDetails de autos-openapi-v2.yaml (detail obligatorio, instance,
 * code libre, correlation_id, timestamp e invalid_params).
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetailsFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const v2 = (req?.originalUrl ?? req?.url ?? '').startsWith('/api/v2');

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: any = {
      type: 'https://api.booking-hub.com/errors/internal',
      title: 'Error interno del servidor',
      status,
      code: 'VALIDATION_FAILED',
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse() as any;

      // Ya viene en formato ProblemDetails
      if (resp && typeof resp === 'object' && resp.code && resp.title) {
        body = { ...resp, status };
      } else {
        const message = typeof resp === 'string' ? resp : (resp?.message || 'Error');
        const invalidParams = Array.isArray(resp?.message)
          ? resp.message.map((m: string) => ({ name: 'body', reason: m }))
          : undefined;
        body = {
          type: `https://api.booking-hub.com/errors/${status}`,
          title: Array.isArray(message) ? 'Petición inválida' : String(message),
          status,
          code: this.pickCode(status),
          invalidParams,
        };
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
      body.detail = exception.message;
    }
    // En v2 solo se respeta el code que venga explicito en un Problem Details; el resto sale del estado HTTP
    if (v2 && !(exception instanceof HttpException && (exception.getResponse() as any)?.code)) body.code = undefined;

    if ((status === 409 || status === 429) && !res.getHeader('Retry-After')) {
      res.setHeader('Retry-After', String(status === 409 ? RETRY_AFTER_CONFLICT_S : 60));
    }

    res.status(status).type('application/problem+json').json(v2 ? this.sanitizeV2(body, status, req) : this.sanitize(body, status));
  }

  private sanitizeV2(b: any, status: number, req: Request) {
    const { type, title, status: _s, detail, code, invalidParams, invalid_params, message: _m, error: _e, statusCode: _c, ...extra } = b ?? {};
    const params = invalid_params ?? invalidParams;
    return {
      type: String(type ?? `https://booking.epn.edu.ec/errors/${status}`).replace('https://api.booking-hub.com/', 'https://booking.epn.edu.ec/'),
      title: String(title ?? 'Error'),
      status,
      detail: String(detail ?? title ?? 'Error'),
      instance: req.originalUrl ?? req.url,
      code: typeof code === 'string' && code ? code : CODIGO_V2[status] ?? 'INTERNAL_ERROR',
      correlation_id: correlationIdDe(req) || null,
      timestamp: new Date().toISOString(),
      ...(Array.isArray(params) && { invalid_params: params }),
      ...extra,
    };
  }

  private sanitize(b: any, status: number) {
    return {
      type: String(b.type),
      title: String(b.title),
      status,
      ...(b.detail !== undefined && { detail: String(b.detail) }),
      code: PROBLEM_CODES.has(b.code) ? b.code : this.pickCode(status),
      ...(Array.isArray(b.invalidParams) && { invalidParams: b.invalidParams }),
    };
  }

  private pickCode(status: number): string {
    if (status === 409) return 'CAR_NO_LONGER_AVAILABLE';
    if (status === 429) return 'RATE_LIMIT_EXCEEDED';
    return 'VALIDATION_FAILED';
  }
}

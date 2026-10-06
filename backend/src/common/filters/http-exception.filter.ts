import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Response } from 'express';

/** Valores permitidos de ProblemDetails.code (enum de autos-openapi.yaml). */
const PROBLEM_CODES = new Set([
  'VALIDATION_FAILED', 'CAR_NO_LONGER_AVAILABLE', 'PRICE_CHANGED', 'DEPOT_CLOSED',
  'DRIVER_AGE_RESTRICTION', 'BOOKING_NOT_CONFIRMED', 'CANCELLATION_NOT_ALLOWED',
  'RATE_LIMIT_EXCEEDED', 'PAYMENT_REFERENCE_INVALID', 'PAYMENT_NOT_AUTHORIZED',
]);

/** Segundos sugeridos en Retry-After para 409 (el contrato declara la cabecera en ProblemDetails409). */
const RETRY_AFTER_CONFLICT_S = 5;

/**
 * Filtro global que serializa cualquier excepcion como application/problem+json (RFC 7807),
 * alineado con components.responses.ProblemDetails* de autos-openapi.yaml.
 * El schema ProblemDetails tiene additionalProperties: false, por eso solo se emiten
 * type, title, status, detail, code e invalidParams.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetailsFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: any = {
      type: 'https://api.booking-hub.com/errors/internal',
      title: 'Internal server error',
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

    if ((status === 409 || status === 429) && !res.getHeader('Retry-After')) {
      res.setHeader('Retry-After', String(status === 409 ? RETRY_AFTER_CONFLICT_S : 60));
    }

    res.status(status).type('application/problem+json').json(this.sanitize(body, status));
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

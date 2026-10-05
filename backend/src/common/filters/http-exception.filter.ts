import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * Filtro global que serializa cualquier excepcion como application/problem+json (RFC 7807),
 * alineado con components.responses.ProblemDetails* de autos-openapi.yaml.
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

    res.status(status).type('application/problem+json').json(body);
  }

  private pickCode(status: number): string {
    if (status === 400) return 'VALIDATION_FAILED';
    if (status === 409) return 'CAR_NO_LONGER_AVAILABLE';
    if (status === 429) return 'RATE_LIMIT_EXCEEDED';
    return 'VALIDATION_FAILED';
  }
}

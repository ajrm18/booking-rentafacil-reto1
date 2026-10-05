import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type ProblemCode =
  | 'VALIDATION_FAILED'
  | 'CAR_NO_LONGER_AVAILABLE'
  | 'PRICE_CHANGED'
  | 'DEPOT_CLOSED'
  | 'DRIVER_AGE_RESTRICTION'
  | 'BOOKING_NOT_CONFIRMED'
  | 'CANCELLATION_NOT_ALLOWED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'PAYMENT_REFERENCE_INVALID'
  | 'PAYMENT_NOT_AUTHORIZED';

export class InvalidParamDto {
  @ApiProperty({ example: 'driver.age' })
  name: string;

  @ApiProperty({ example: 'must be >= 18' })
  reason: string;
}

/**
 * Contrato de respuesta de error segun RFC 7807 (application/problem+json).
 * Alineado con components.schemas.ProblemDetails en autos-openapi.yaml.
 */
export class ProblemDetailsDto {
  @ApiProperty({ example: 'https://api.booking-hub.com/errors/validation-failed' })
  type: string;

  @ApiProperty({ example: 'Petición inválida' })
  title: string;

  @ApiProperty({ example: 400 })
  status: number;

  @ApiPropertyOptional({ example: 'Uno o mas campos no son validos' })
  detail?: string;

  @ApiProperty({
    example: 'VALIDATION_FAILED',
    enum: [
      'VALIDATION_FAILED', 'CAR_NO_LONGER_AVAILABLE', 'PRICE_CHANGED',
      'DEPOT_CLOSED', 'DRIVER_AGE_RESTRICTION', 'BOOKING_NOT_CONFIRMED',
      'CANCELLATION_NOT_ALLOWED', 'RATE_LIMIT_EXCEEDED',
      'PAYMENT_REFERENCE_INVALID', 'PAYMENT_NOT_AUTHORIZED',
    ],
  })
  code: ProblemCode;

  @ApiPropertyOptional({ type: [InvalidParamDto] })
  invalidParams?: InvalidParamDto[];
}

export class BaseResponseDto {
  @ApiPropertyOptional({
    description: 'HATEOAS links (Richardson Maturity Model Level 3)',
    type: 'object',
    additionalProperties: { type: 'string', format: 'uri' },
  })
  _links?: Record<string, string>;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty, IsArray, IsEmail, IsIn, IsOptional, IsString, IsUrl, IsUUID, ValidateNested,
} from 'class-validator';
import { DriverDto, RouteDto } from './common-schemas.dto';

/** OrderHoldRequest */
export class OrderHoldRequestDto {
  @ApiProperty({ example: 'VEH-1001' })
  @IsString()
  vehicle_id: string;

  @ApiProperty({ example: 'tok-abc123' })
  @IsString()
  search_token: string;

  @ApiPropertyOptional({ type: DriverDto })
  @IsOptional() @ValidateNested() @Type(() => DriverDto)
  driver?: DriverDto;
}

export class OrderHoldResponseDto {
  @ApiProperty({ example: 'HLD-2f8b7a' })
  hold_id: string;

  @ApiProperty({ example: '2026-10-01T10:15:00Z', format: 'date-time' })
  expires_at: string;

  @ApiProperty({ enum: ['HELD', 'FAILED'], example: 'HELD' })
  status: 'HELD' | 'FAILED';
}

/** OrderPreviewRequest / Response */
export class OrderPreviewRequestDto {
  @ApiProperty({ example: 'VEH-1001' })
  @IsString()
  vehicle_id: string;

  @ApiProperty({ example: 'tok-abc123' })
  @IsString()
  search_token: string;

  @ApiPropertyOptional({ example: 'HLD-2f8b7a' })
  @IsOptional() @IsString()
  hold_id?: string;

  @ApiPropertyOptional({ type: [String], example: ['SILLA_BEBE', 'GPS'] })
  @IsOptional() @IsArray() @IsString({ each: true })
  extras?: string[];
}

export class OrderPreviewDataDto {
  @ApiProperty({ example: 'PRV-8f2a1b' })
  order_preview_id: string;

  @ApiProperty({ example: 232.00 })
  total_price: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ example: { base: 180, extras: 20, taxes: 32 } })
  breakdown: Record<string, any>;
}

export class OrderPreviewResponseDto {
  @ApiProperty({ example: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' })
  request_id: string;

  @ApiProperty({ type: OrderPreviewDataDto })
  data: OrderPreviewDataDto;
}

/** OrderCreateRequest */
export class DriverDetailsDto {
  @ApiPropertyOptional({ example: 'Anthony' })
  @IsOptional() @IsString()
  first_name?: string;

  @ApiPropertyOptional({ example: 'Rosero' })
  @IsOptional() @IsString()
  last_name?: string;

  @ApiPropertyOptional({ example: 'anthony@example.com' })
  @IsOptional() @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+593 99 000 0000' })
  @IsOptional() @IsString()
  phone_number?: string;
}

export class OrderCreateRequestDto {
  @ApiProperty({ example: 'PRV-8f2a1b' })
  @IsString()
  order_preview_id: string;

  @ApiProperty({ example: 'PAY-REF-123' })
  @IsString()
  payment_reference: string;

  @ApiProperty({ type: DriverDetailsDto })
  @ValidateNested() @Type(() => DriverDetailsDto)
  driver_details: DriverDetailsDto;
}

/** OrderDetail (respuesta) */
export class OrderDetailDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', format: 'uuid' })
  order_id: string;

  @ApiProperty({ example: 'RENTAFACIL-X789', description: 'Localizador (PNR)' })
  locator: string;

  @ApiProperty({ enum: ['CONFIRMED', 'CANCELLED', 'PENDING'], example: 'CONFIRMED' })
  status: 'CONFIRMED' | 'CANCELLED' | 'PENDING';

  @ApiProperty({ example: { vehicle_id: 'VEH-1001', make: 'Toyota', model: 'Corolla' } })
  vehicle_details: Record<string, any>;

  @ApiProperty({ example: { pickup: {}, dropoff: {} } })
  route_details: Record<string, any>;

  @ApiProperty({ example: 232.00 })
  total_price: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ example: '2026-09-28T14:22:11Z', format: 'date-time' })
  creation_date: string;

  @ApiProperty({
    description: 'HATEOAS – Acciones disponibles segun el estado de la orden',
    example: {
      self: '/orders/123e...',
      modify: '/orders/123e.../modify',
      cancel: '/orders/123e.../cancel',
    },
  })
  _links: Record<string, string>;
}

/** OrderModifyRequest */
export class OrderModifyRequestDto {
  @ApiPropertyOptional({ type: [String], example: ['GPS'] })
  @IsOptional() @IsArray() @IsString({ each: true })
  extras_to_add?: string[];

  @ApiPropertyOptional({ type: [String], example: ['SILLA_BEBE'] })
  @IsOptional() @IsArray() @IsString({ each: true })
  extras_to_remove?: string[];

  @ApiPropertyOptional({ type: RouteDto })
  @IsOptional() @ValidateNested() @Type(() => RouteDto)
  route?: RouteDto;
}

/** Webhook: eventos permitidos por WebhookSubscription.events */
export const WEBHOOK_EVENTS = ['CAR_ORDER_CONFIRMED', 'CAR_ORDER_CANCELLED', 'DEPOT_UPDATE'];

export class WebhookSubscriptionDto {
  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000', format: 'uuid' })
  @IsOptional() @IsUUID()
  id?: string;

  @ApiProperty({ example: 'https://mi-sistema.example.com/webhooks/autos', format: 'uri' })
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  url: string;

  @ApiProperty({
    type: [String],
    enum: ['CAR_ORDER_CONFIRMED', 'CAR_ORDER_CANCELLED', 'DEPOT_UPDATE'],
    example: ['CAR_ORDER_CONFIRMED'],
  })
  @IsArray() @ArrayNotEmpty() @IsIn(WEBHOOK_EVENTS, { each: true })
  events: string[];

  @ApiPropertyOptional({ example: 'secret-para-firma-hmac' })
  @IsOptional() @IsString()
  secret?: string;
}

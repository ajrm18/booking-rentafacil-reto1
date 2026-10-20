import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VEHICLE_STATUSES } from '../entities/vehicle.entity';

/**
 * Esquemas de Swagger de las APIs internas (BFF admin). Reflejan
 * components.schemas de contracts/rentafacil-ec-openapi.yaml; si cambia uno, cambie el otro.
 */

export class VehicleAdminDto {
  @ApiProperty({ example: 'VEH-1001' }) vehicle_id: string;
  @ApiProperty({ example: 'Toyota' }) make: string;
  @ApiProperty({ example: 'Corolla' }) model: string;
  @ApiProperty({ example: 2023 }) year: number;
  @ApiProperty({ example: 'PBA-1001' }) plate: string;
  @ApiPropertyOptional({ example: 'Blanco', nullable: true }) color?: string;
  @ApiProperty({ example: 5 }) seats: number;
  @ApiProperty({ example: 4 }) doors: number;
  @ApiProperty({ example: 3 }) bag_capacity: number;
  @ApiProperty({ example: 'automatica', enum: ['manual', 'automatica'] }) transmission: string;
  @ApiProperty({ example: 'gasolina', enum: ['gasolina', 'diesel', 'hibrido', 'electrico'] }) fuel_type: string;
  @ApiProperty({ example: 'Sedan', enum: ['Compacto', 'Sedan', 'SUV', 'Camioneta', 'Lujo'] }) car_type: string;
  @ApiProperty({ example: true }) air_conditioning: boolean;
  @ApiProperty({ example: 45 }) price_per_day: number;
  @ApiPropertyOptional({ nullable: true }) description?: string;
  @ApiPropertyOptional({ format: 'uri', nullable: true }) main_image_url?: string;
  @ApiProperty({ enum: VEHICLE_STATUSES, example: 'AVAILABLE' }) status: string;
  @ApiPropertyOptional({
    type: String, format: 'date-time', nullable: true,
    description: 'Fin del lavado post-devolucion (solo con status WASHING)',
  }) wash_until?: string | null;
  @ApiProperty({ example: 1 }) depot_id: number;
  @ApiProperty({ example: 1 }) supplier_id: number;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) created_at?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) updated_at?: string;
}

export class DepotAdminDto {
  @ApiProperty({ example: 1 }) depot_id: number;
  @ApiProperty({ example: 'RentaFacil Aeropuerto Quito' }) name: string;
  @ApiProperty({ example: 'Quito' }) city: string;
  @ApiPropertyOptional({ nullable: true }) address?: string;
  @ApiPropertyOptional({ example: 'UIO', nullable: true }) airport?: string;
  @ApiPropertyOptional({ example: 1, nullable: true }) city_id?: number;
  @ApiPropertyOptional({ example: -0.1225, nullable: true }) latitude?: number;
  @ApiPropertyOptional({ example: -78.3575, nullable: true }) longitude?: number;
  @ApiProperty({ example: 4.5 }) score: number;
  @ApiProperty({ example: true }) active: boolean;
}

export class SupplierAdminDto {
  @ApiProperty({ example: 1 }) supplier_id: number;
  @ApiProperty({ example: 'RentaFacil Prime' }) name: string;
  @ApiPropertyOptional({ nullable: true }) brand?: string;
  @ApiPropertyOptional({ nullable: true }) description?: string;
}

export class OrderAdminViewDto {
  @ApiProperty({ format: 'uuid' }) order_id: string;
  @ApiProperty({ example: 'RENTAFACIL-A1B2C3' }) locator: string;
  @ApiProperty({ enum: ['CONFIRMED', 'CANCELLED', 'PENDING'] }) status: string;
  @ApiProperty({ example: 'VEH-1001' }) vehicle_id: string;
  @ApiPropertyOptional({ example: 'maria@example.com', nullable: true }) owner_sub?: string;
  @ApiPropertyOptional({ nullable: true }) hold_id?: string;
  @ApiPropertyOptional({ nullable: true }) order_preview_id?: string;
  @ApiPropertyOptional({ nullable: true }) payment_reference?: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) vehicle_details: Record<string, any>;
  @ApiProperty({ type: 'object', additionalProperties: true }) route_details: Record<string, any>;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true }) driver_details?: Record<string, any>;
  @ApiPropertyOptional({ type: [String] }) extras?: string[];
  @ApiProperty({ example: 157.5 }) total_price: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'Fecha de devolucion del vehiculo' })
  returned_at?: string | null;
  @ApiPropertyOptional({ nullable: true, description: '`sub` del admin que registro la devolucion' })
  returned_by_sub?: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) creation_date: string;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) updated_at?: string;
}

export class UserAdminDto {
  @ApiProperty({ format: 'uuid' }) user_id: string;
  @ApiProperty({ example: 'María' }) first_name: string;
  @ApiProperty({ example: 'López' }) last_name: string;
  @ApiProperty({ example: 'maria@example.com' }) email: string;
  @ApiProperty({ enum: ['client', 'admin'] }) role: string;
  @ApiPropertyOptional({ nullable: true }) phone?: string;
  @ApiPropertyOptional({ nullable: true }) national_id?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) created_at?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) updated_at?: string;
}

export class ReturnedOrderDto {
  @ApiProperty({ format: 'uuid' }) order_id: string;
  @ApiProperty() locator: string;
  @ApiProperty({ enum: ['CONFIRMED'], description: 'La devolucion no cancela la orden' }) status: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) vehicle_details: Record<string, any>;
  @ApiProperty({ type: 'object', additionalProperties: true }) route_details: Record<string, any>;
  @ApiProperty() total_price: number;
  @ApiProperty() currency: string;
  @ApiProperty({ type: String, format: 'date-time' }) creation_date: string;
  @ApiPropertyOptional({ nullable: true }) owner_sub?: string;
  @ApiProperty({ type: String, format: 'date-time' }) returned_at: string;
  @ApiProperty({ example: 'admin@rentafacil.ec' }) returned_by_sub: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } }) _links?: Record<string, string>;
}

export class ReturnVehicleStateDto {
  @ApiProperty({ example: 'VEH-1001' }) vehicle_id: string;
  @ApiProperty({ enum: VEHICLE_STATUSES, example: 'WASHING' }) status: string;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) wash_until: string | null;
}

export class ReturnResponseDto {
  @ApiProperty({ type: ReturnedOrderDto }) order: ReturnedOrderDto;
  @ApiProperty({ type: ReturnVehicleStateDto, nullable: true }) vehicle: ReturnVehicleStateDto | null;
}

export class TokenResponseDto {
  @ApiProperty() access_token: string;
  @ApiProperty({ example: 'Bearer' }) token_type: string;
  @ApiProperty({ example: 86400 }) expires_in: number;
  @ApiProperty({ example: 'autos:read autos:book autos:cancel autos:webhooks' }) scope: string;
  @ApiProperty({
    type: 'object',
    properties: {
      email: { type: 'string' }, role: { type: 'string', enum: ['client', 'admin'] },
      first_name: { type: 'string' }, last_name: { type: 'string' },
    },
  }) user: { email: string; role: string; first_name: string; last_name: string };
}

export class UserAdminInputDto {
  @ApiProperty({ example: 'Ana' }) first_name: string;
  @ApiProperty({ example: 'Torres' }) last_name: string;
  @ApiProperty({ example: 'ana@example.com' }) email: string;
  @ApiPropertyOptional({ minLength: 8, maxLength: 72, description: 'Obligatoria al crear; opcional al editar' }) password?: string;
  @ApiPropertyOptional({ enum: ['client', 'admin'], default: 'client' }) role?: string;
  @ApiPropertyOptional({ example: '0983563584' }) phone?: string;
  @ApiPropertyOptional({ example: '1710034065', description: 'Cédula ecuatoriana (10 dígitos)' }) national_id?: string;
}

export class LoginRequestDto {
  @ApiProperty({ example: 'admin@rentafacil.ec' }) email: string;
  @ApiProperty({ example: 'Admin12345' }) password: string;
}

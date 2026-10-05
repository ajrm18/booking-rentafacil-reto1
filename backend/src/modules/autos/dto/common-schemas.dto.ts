import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString, IsInt, IsNumber, IsObject, IsOptional, IsString,
  Matches, Max, Min, ValidateNested,
} from 'class-validator';

/** Alineado con components.schemas.Booker */
export class BookerDto {
  @ApiProperty({ example: 'ec', pattern: '^[a-z]{2}$', description: 'Codigo ISO 3166-1 alpha-2 del pais del comprador' })
  @IsString() @Matches(/^[a-z]{2}$/)
  country: string;
}

/** Alineado con components.schemas.Driver */
export class DriverDto {
  @ApiProperty({ example: 25, minimum: 18, maximum: 99 })
  @IsInt() @Min(18) @Max(99)
  age: number;
}

/** Alineado con components.schemas.LocationPoint */
export class CoordinatesDto {
  @ApiPropertyOptional({ example: -0.1292 })
  @IsOptional() @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({ example: -78.3575 })
  @IsOptional() @IsNumber()
  longitude?: number;
}

export class LocationPointDto {
  @ApiPropertyOptional({ example: 'UIO', description: 'Codigo IATA de aeropuerto, si aplica' })
  @IsOptional() @IsString()
  airport?: string;

  @ApiPropertyOptional({ example: 1, description: 'ID interno de la ciudad' })
  @IsOptional() @IsInt()
  city_id?: number;

  @ApiPropertyOptional({ type: CoordinatesDto })
  @IsOptional() @ValidateNested() @Type(() => CoordinatesDto)
  coordinates?: CoordinatesDto;
}

/** Alineado con components.schemas.Route */
export class RouteEndpointDto {
  @ApiProperty({ example: '2026-10-01T10:00:00Z', format: 'date-time' })
  @IsDateString()
  datetime: string;

  @ApiProperty({ type: LocationPointDto })
  @ValidateNested() @Type(() => LocationPointDto)
  location: LocationPointDto;
}

export class RouteDto {
  @ApiProperty({ type: RouteEndpointDto })
  @ValidateNested() @Type(() => RouteEndpointDto)
  pickup: RouteEndpointDto;

  @ApiProperty({ type: RouteEndpointDto })
  @ValidateNested() @Type(() => RouteEndpointDto)
  dropoff: RouteEndpointDto;
}

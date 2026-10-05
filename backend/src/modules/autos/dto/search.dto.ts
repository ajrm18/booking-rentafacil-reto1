import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray, IsInt, IsOptional, IsString, Matches, Max, Min, ValidateNested,
} from 'class-validator';
import { BookerDto, DriverDto, RouteDto } from './common-schemas.dto';

export class CarSearchFiltersDto {
  @ApiPropertyOptional({ type: [String], example: ['SUV', 'Sedan'] })
  @IsOptional() @IsArray() @IsString({ each: true })
  car_types?: string[];

  @ApiPropertyOptional({ type: [String], example: ['automatica'] })
  @IsOptional() @IsArray() @IsString({ each: true })
  transmission?: string[];
}

/** Alineado con components.schemas.CarSearchRequest */
export class CarSearchRequestDto {
  @ApiProperty({ type: BookerDto })
  @ValidateNested() @Type(() => BookerDto)
  booker: BookerDto;

  @ApiProperty({ example: 'USD', pattern: '^[A-Z]{3}$' })
  @IsString() @Matches(/^[A-Z]{3}$/)
  currency: string;

  @ApiProperty({ type: DriverDto })
  @ValidateNested() @Type(() => DriverDto)
  driver: DriverDto;

  @ApiProperty({ type: RouteDto })
  @ValidateNested() @Type(() => RouteDto)
  route: RouteDto;

  @ApiPropertyOptional({ type: CarSearchFiltersDto })
  @IsOptional() @ValidateNested() @Type(() => CarSearchFiltersDto)
  filters?: CarSearchFiltersDto;

  @ApiPropertyOptional({ example: 100, minimum: 10, maximum: 500 })
  @IsOptional() @IsInt() @Min(10) @Max(500)
  maximum_results?: number;

  @ApiPropertyOptional({ example: 'es' })
  @IsOptional() @IsString()
  language?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsOptional() @IsString()
  page?: string;
}

export class CarSearchItemDto {
  @ApiProperty({ example: 'VEH-1001' })
  vehicle_id: string;

  @ApiProperty({ example: 45.50 })
  price: number;

  @ApiProperty({ example: 1 })
  supplier_id: number;
}

export class CarSearchMetadataDto {
  @ApiProperty({ example: 25 })
  total_results: number;

  @ApiPropertyOptional({ example: null, nullable: true })
  next_page: string | null;
}

/** Alineado con components.schemas.CarSearchResponse */
export class CarSearchResponseDto {
  @ApiProperty({ example: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' })
  request_id: string;

  @ApiProperty({ type: [CarSearchItemDto] })
  data: CarSearchItemDto[];

  @ApiProperty({ type: CarSearchMetadataDto })
  metadata: CarSearchMetadataDto;

  @ApiProperty({ example: 'tok-abc123' })
  search_token: string;
}

/** DepotsRequest / DepotsResponse */
export class DepotsRequestDto {
  @ApiPropertyOptional({ example: '2026-01-01T00:00:00Z' })
  @IsOptional() @IsString()
  last_modified?: string;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional() @IsInt()
  maximum_results?: number;

  @ApiPropertyOptional({ type: [String], example: ['es', 'en'] })
  @IsOptional() @IsArray() @IsString({ each: true })
  languages?: string[];

  @ApiPropertyOptional({ example: '1' })
  @IsOptional() @IsString()
  page?: string;
}

export class DepotScoresRequestDto {
  @ApiPropertyOptional({ example: 100 })
  @IsOptional() @IsInt()
  maximum_results?: number;

  @ApiPropertyOptional({ example: '1' })
  @IsOptional() @IsString()
  page?: string;
}

/** CarDetailsRequest */
export class CarDetailsRequestDto {
  @ApiPropertyOptional({ example: '2026-01-01T00:00:00Z' })
  @IsOptional() @IsString()
  last_modified?: string;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional() @IsInt()
  maximum_results?: number;

  @ApiPropertyOptional({ example: '1' })
  @IsOptional() @IsString()
  page?: string;

  @ApiPropertyOptional({ type: [String], example: ['VEH-1001', 'VEH-1002'] })
  @IsOptional() @IsArray() @IsString({ each: true })
  vehicle_ids?: string[];
}

/** SuppliersRequest */
export class SuppliersRequestDto {
  @ApiPropertyOptional({ type: [Number], example: [1, 2] })
  @IsOptional() @IsArray() @IsInt({ each: true })
  suppliers?: number[];

  @ApiPropertyOptional({ example: 100 })
  @IsOptional() @IsInt()
  maximum_results?: number;

  @ApiPropertyOptional({ example: '1' })
  @IsOptional() @IsString()
  page?: string;
}

/** CarConstantsRequest */
export class CarConstantsRequestDto {
  @ApiPropertyOptional({ type: [String], example: ['es'] })
  @IsOptional() @IsArray() @IsString({ each: true })
  languages?: string[];

  @ApiPropertyOptional({
    type: [String],
    enum: ['depot_services', 'fuel_policies', 'fuel_types', 'general', 'payment_timings', 'transmission'],
  })
  @IsOptional() @IsArray() @IsString({ each: true })
  constants?: string[];
}

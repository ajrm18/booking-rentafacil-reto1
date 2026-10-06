import {
  Body, Controller, Delete, Get, Header, Headers, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Post, Req, UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse,
  ApiSecurity, ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AutosService } from './autos.service';
import { IdempotencyKeyGuard } from '../../common/guards/idempotency-key.guard';
import { AffiliateGuard } from '../../common/guards/affiliate.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { AuthContext, OAuth2Guard, RequireScopes } from '../../common/guards/oauth2.guard';
import {
  CarConstantsRequestDto, CarDetailsRequestDto, CarSearchRequestDto,
  CarSearchResponseDto, DepotScoresRequestDto, DepotsRequestDto,
  SuppliersRequestDto,
} from './dto/search.dto';
import {
  OrderCreateRequestDto, OrderDetailDto, OrderHoldRequestDto,
  OrderHoldResponseDto, OrderModifyRequestDto, OrderPreviewRequestDto,
  OrderPreviewResponseDto, WebhookSubscriptionDto,
} from './dto/orders.dto';

/** Fecha prevista de baja de la v1 (cabecera X-API-Deprecation-Date del contrato). */
export const API_DEPRECATION_DATE = process.env.API_DEPRECATION_DATE || '2027-12-31';

const authOf = (request: Request): AuthContext => (request as any).auth;

/**
 * Controlador del microservicio Autos, alineado 1:1 con contracts/autos-openapi.yaml.
 * Todos los paths estan bajo el prefijo global /api/v1 configurado en main.ts,
 * cumpliendo con servers.url = https://.../autos/v1.
 */
@Controller()
export class AutosController {
  constructor(private readonly autosService: AutosService) {}

  // ══════════════════════════════════════════════════════════════════════════
  //  Busqueda y Catalogo
  // ══════════════════════════════════════════════════════════════════════════

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AffiliateGuard, RateLimitGuard)
  @ApiTags('Búsqueda y Catálogo')
  @ApiOperation({ summary: 'Búsqueda de renta de vehículos' })
  @ApiHeader({ name: 'X-Affiliate-Id', required: true })
  @ApiBody({ type: CarSearchRequestDto })
  @ApiResponse({ status: 200, description: 'Vehículos encontrados', type: CarSearchResponseDto })
  @ApiResponse({ status: 400, description: 'Petición inválida' })
  @ApiResponse({ status: 429, description: 'Demasiadas peticiones' })
  @Header('X-API-Deprecation-Date', API_DEPRECATION_DATE)
  @Header('Cache-Control', 'public, max-age=300')
  search(@Headers('x-affiliate-id') _affiliateId: string, @Body() req: CarSearchRequestDto) {
    return this.autosService.search(req);
  }

  @Post('details')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AffiliateGuard)
  @ApiTags('Búsqueda y Catálogo')
  @ApiOperation({ summary: 'Obtener especificaciones y características de los vehículos' })
  @ApiHeader({ name: 'X-Affiliate-Id', required: true })
  @ApiBody({ type: CarDetailsRequestDto })
  @ApiResponse({ status: 200, description: 'Detalles de los vehículos solicitados' })
  @Header('X-API-Deprecation-Date', API_DEPRECATION_DATE)
  @Header('Cache-Control', 'public, max-age=300')
  getDetails(@Headers('x-affiliate-id') _affiliateId: string, @Body() req: CarDetailsRequestDto) {
    return this.autosService.getDetails(req);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Informacion de Agencias y Proveedores
  // ══════════════════════════════════════════════════════════════════════════

  @Post('depots')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AffiliateGuard)
  @ApiTags('Información de Agencias y Proveedores')
  @ApiOperation({ summary: 'Consultar lista de agencias de renta (puntos de recogida y entrega)' })
  @ApiHeader({ name: 'X-Affiliate-Id', required: true })
  @ApiBody({ type: DepotsRequestDto, required: false })
  @ApiResponse({ status: 200, description: 'Lista de agencias (depots)' })
  @Header('X-API-Deprecation-Date', API_DEPRECATION_DATE)
  @Header('Cache-Control', 'public, max-age=3600')
  getDepots(@Headers('x-affiliate-id') _affiliateId: string, @Body() req: DepotsRequestDto) {
    return this.autosService.getDepots(req);
  }

  @Post('depots/reviews/scores')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AffiliateGuard)
  @ApiTags('Información de Agencias y Proveedores')
  @ApiOperation({ summary: 'Obtener puntuaciones y reseñas de las agencias' })
  @ApiHeader({ name: 'X-Affiliate-Id', required: true })
  @ApiBody({ type: DepotScoresRequestDto })
  @ApiResponse({ status: 200, description: 'Puntuaciones desglosadas por agencia' })
  @Header('X-API-Deprecation-Date', API_DEPRECATION_DATE)
  @Header('Cache-Control', 'public, max-age=600')
  getDepotScores(@Headers('x-affiliate-id') _affiliateId: string, @Body() req: DepotScoresRequestDto) {
    return this.autosService.getDepotScores(req);
  }

  @Post('suppliers')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AffiliateGuard)
  @ApiTags('Información de Agencias y Proveedores')
  @ApiOperation({ summary: 'Listar proveedores de renta de autos' })
  @ApiHeader({ name: 'X-Affiliate-Id', required: true })
  @ApiBody({ type: SuppliersRequestDto, required: false })
  @ApiResponse({ status: 200, description: 'Lista de proveedores de renta de autos' })
  @Header('X-API-Deprecation-Date', API_DEPRECATION_DATE)
  @Header('Cache-Control', 'public, max-age=3600')
  getSuppliers(@Headers('x-affiliate-id') _affiliateId: string, @Body() req: SuppliersRequestDto) {
    return this.autosService.getSuppliers(req);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Componentes Comunes
  // ══════════════════════════════════════════════════════════════════════════

  @Post('constants')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AffiliateGuard)
  @ApiTags('Componentes Comunes')
  @ApiOperation({ summary: 'Consultar constantes del sistema (políticas, seguros, servicios extra)' })
  @ApiHeader({ name: 'X-Affiliate-Id', required: true })
  @ApiBody({ type: CarConstantsRequestDto, required: false })
  @ApiResponse({ status: 200, description: 'Constantes del sistema' })
  @Header('X-API-Deprecation-Date', API_DEPRECATION_DATE)
  @Header('Cache-Control', 'public, max-age=86400')
  getConstants(@Headers('x-affiliate-id') _affiliateId: string, @Body() req: CarConstantsRequestDto) {
    return this.autosService.getConstants(req);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Gestion de Ordenes (Reservas)
  // ══════════════════════════════════════════════════════════════════════════

  @Post('orders/hold')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OAuth2Guard) @RequireScopes('autos:book')
  @ApiTags('Gestión de Órdenes (Reservas)')
  @ApiBearerAuth()
  @ApiSecurity('OAuth2Security', ['autos:book'])
  @ApiOperation({ summary: 'Bloquear temporalmente el vehículo y precio (Hold)' })
  @ApiBody({ type: OrderHoldRequestDto })
  @ApiResponse({ status: 200, description: 'Vehículo bloqueado exitosamente', type: OrderHoldResponseDto })
  @ApiResponse({ status: 400, description: 'Petición inválida' })
  @ApiResponse({ status: 409, description: 'Conflicto (auto no disponible)' })
  holdOrder(@Body() req: OrderHoldRequestDto) {
    return this.autosService.holdOrder(req);
  }

  @Post('orders/preview')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OAuth2Guard) @RequireScopes('autos:read')
  @ApiTags('Gestión de Órdenes (Reservas)')
  @ApiBearerAuth()
  @ApiSecurity('OAuth2Security', ['autos:read'])
  @ApiOperation({ summary: 'Previsualizar la orden de renta antes de confirmar' })
  @ApiBody({ type: OrderPreviewRequestDto })
  @ApiResponse({ status: 200, description: 'Detalles de la orden previsualizada y precios finales', type: OrderPreviewResponseDto })
  previewOrder(@Body() req: OrderPreviewRequestDto) {
    return this.autosService.previewOrder(req);
  }

  @Post('orders/create')
  @UseGuards(OAuth2Guard, IdempotencyKeyGuard) @RequireScopes('autos:book')
  @ApiTags('Gestión de Órdenes (Reservas)')
  @ApiBearerAuth()
  @ApiSecurity('OAuth2Security', ['autos:book'])
  @ApiOperation({ summary: 'Crear orden/reserva de renta de vehículo' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID v4 para evitar cobros duplicados' })
  @ApiBody({ type: OrderCreateRequestDto })
  @ApiResponse({ status: 201, description: 'Orden creada exitosamente', type: OrderDetailDto })
  @ApiResponse({ status: 400, description: 'Petición inválida' })
  @ApiResponse({ status: 409, description: 'Conflicto (auto no disponible)' })
  @HttpCode(HttpStatus.CREATED)
  createOrder(
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() req: OrderCreateRequestDto,
    @Req() request: Request,
  ) {
    const sub = authOf(request)?.sub || 'anonymous';
    return this.autosService.createOrder(req, sub, idempotencyKey);
  }

  @Get('orders/:orderId')
  @UseGuards(OAuth2Guard) @RequireScopes('autos:read')
  @ApiTags('Gestión de Órdenes (Reservas)')
  @ApiBearerAuth()
  @ApiSecurity('OAuth2Security', ['autos:read'])
  @ApiOperation({ summary: 'Obtener detalles de la orden' })
  @ApiParam({ name: 'orderId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Detalles completos de la orden', type: OrderDetailDto })
  @ApiResponse({ status: 404, description: 'Orden no encontrada' })
  getOrder(@Param('orderId', ParseUUIDPipe) orderId: string, @Req() request: Request) {
    return this.autosService.getOrder(orderId, authOf(request));
  }

  @Post('orders/:orderId/modify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OAuth2Guard, IdempotencyKeyGuard) @RequireScopes('autos:book')
  @ApiTags('Gestión de Órdenes (Reservas)')
  @ApiBearerAuth()
  @ApiSecurity('OAuth2Security', ['autos:book'])
  @ApiOperation({ summary: 'Modificar una orden existente' })
  @ApiParam({ name: 'orderId', type: 'string', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID v4 para evitar modificaciones duplicadas' })
  @ApiBody({ type: OrderModifyRequestDto })
  @ApiResponse({ status: 200, description: 'Orden modificada', type: OrderDetailDto })
  @ApiResponse({ status: 409, description: 'Conflicto' })
  modifyOrder(
    @Headers('idempotency-key') idempotencyKey: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() req: OrderModifyRequestDto,
    @Req() request: Request,
  ) {
    return this.autosService.modifyOrder(orderId, req, authOf(request), idempotencyKey);
  }

  @Post('orders/:orderId/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OAuth2Guard, IdempotencyKeyGuard) @RequireScopes('autos:cancel')
  @ApiTags('Gestión de Órdenes (Reservas)')
  @ApiBearerAuth()
  @ApiSecurity('OAuth2Security', ['autos:cancel'])
  @ApiOperation({ summary: 'Cancelar una orden de renta' })
  @ApiParam({ name: 'orderId', type: 'string', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID v4 para evitar cancelaciones duplicadas' })
  @ApiResponse({ status: 200, description: 'Cancelación procesada' })
  @ApiResponse({ status: 409, description: 'Conflicto' })
  cancelOrder(
    @Headers('idempotency-key') idempotencyKey: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Req() request: Request,
  ) {
    return this.autosService.cancelOrder(orderId, authOf(request), idempotencyKey);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Webhooks
  // ══════════════════════════════════════════════════════════════════════════

  @Get('webhooks')
  @UseGuards(OAuth2Guard) @RequireScopes('autos:webhooks')
  @ApiTags('Webhooks')
  @ApiBearerAuth()
  @ApiSecurity('OAuth2Security', ['autos:webhooks'])
  @ApiOperation({ summary: 'Listar suscripciones a eventos' })
  @ApiResponse({ status: 200, description: 'Suscripciones activas' })
  listWebhooks() {
    return this.autosService.listWebhooks();
  }

  @Post('webhooks')
  @UseGuards(OAuth2Guard) @RequireScopes('autos:webhooks')
  @ApiTags('Webhooks')
  @ApiBearerAuth()
  @ApiSecurity('OAuth2Security', ['autos:webhooks'])
  @ApiOperation({ summary: 'Registrar un nuevo webhook' })
  @ApiBody({ type: WebhookSubscriptionDto })
  @ApiResponse({ status: 201, description: 'Webhook registrado' })
  @HttpCode(HttpStatus.CREATED)
  createWebhook(@Body() sub: WebhookSubscriptionDto) {
    return this.autosService.createWebhook(sub);
  }

  @Delete('webhooks/:id')
  @UseGuards(OAuth2Guard) @RequireScopes('autos:webhooks')
  @ApiTags('Webhooks')
  @ApiBearerAuth()
  @ApiSecurity('OAuth2Security', ['autos:webhooks'])
  @ApiOperation({ summary: 'Eliminar suscripción de webhook' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Suscripción eliminada' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteWebhook(@Param('id', ParseUUIDPipe) id: string) {
    await this.autosService.deleteWebhook(id);
  }
}

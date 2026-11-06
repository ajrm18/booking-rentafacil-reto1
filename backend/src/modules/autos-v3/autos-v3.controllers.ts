import { Body, Controller, Get, Header, HttpCode, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { correlationIdDe } from '../../common/correlation';
import { ToleranteSinCredenciales, V3AuthGuard } from '../../common/guards/v3-auth.guard';
import { IdempotencyService } from '../integracion/idempotency.service';
import { OutboxService } from '../integracion/outbox.service';
import { CatalogoV2Service } from '../autos-v2/catalogo-v2.service';
import { FlotaV2Service } from '../autos-v2/flota-v2.service';
import { idempotencyKeyDe, IdempotencyV2Guard } from '../autos-v2/idempotency-v2.guard';
import { PromocionesV2Service } from '../autos-v2/promociones-v2.service';
import { authV2De, Roles } from '../autos-v2/v2-auth.guard';
import { origenDe } from '../clientes/clientes.controller';
import { HealthV3Service } from './health-v3.service';
import { CtxV3, ReservasV3Service } from './reservas-v3.service';
import { aV3, conStockV3 } from './v3';

/**
 * Controladores de backend/contracts/autos-openapi-v3.yaml (v3.0.0) bajo /api/v3, fuera del
 * prefijo global /api/v1. /api/v1 y /api/v2 siguen intactos. Las rutas fijas se registran antes
 * que /autos/:id. Documentados con el YAML oficial en /api/v3/docs.
 */
const BASE = 'api/v3/autos';

const ctx = (req: Request): CtxV3 => ({
  auth: authV2De(req), idempotencyKey: idempotencyKeyDe(req), correlationId: correlationIdDe(req), origen: origenDe(req),
});

@ApiExcludeController()
@Controller('api/v3')
export class TelemetriaV3Controller {
  constructor(private readonly health: HealthV3Service, private readonly outbox: OutboxService) {}

  /** Semaforo LED (security: []). DOWN responde 503 con la misma telemetria. */
  @Get(['health', 'autos/health'])
  @Header('Cache-Control', 'no-store')
  async getHealth(@Res({ passthrough: true }) res: Response) {
    const h = await this.health.estado();
    if (h.status === 'DOWN') res.status(503);
    return h;
  }

  @Get('autos/eventos')
  @UseGuards(V3AuthGuard)
  @Roles('ADMIN', 'MANTENIMIENTO', 'B2B')
  async eventos(@Query('limit') limit?: string, @Query('after') after?: string) {
    const { events, total } = await this.outbox.feed(Number(limit ?? 10), after || undefined);
    return { events, metadata: { total, returned: events.length, timestamp: new Date().toISOString(), exchange: 'booking.events' } };
  }
}

@ApiExcludeController()
@Controller(`${BASE}/promociones`)
@UseGuards(V3AuthGuard)
export class PromocionesV3Controller {
  constructor(private readonly promociones: PromocionesV2Service, private readonly idem: IdempotencyService) {}

  @Get('contrato')
  @ToleranteSinCredenciales()
  obtener() {
    return this.promociones.obtener();
  }

  @Put('contrato')
  @UseGuards(IdempotencyV2Guard)
  @Roles('ADMIN')
  actualizar(@Body() body: any, @Req() req: Request) {
    const c = ctx(req);
    return this.idem.ejecutar(c.idempotencyKey, 'promociones:contrato', () => this.promociones.actualizar(body, c.auth.sub));
  }
}

@ApiExcludeController()
@Controller(BASE)
export class FlotaV3Controller {
  constructor(private readonly flota: FlotaV2Service) {}

  @Get('flota')
  @Header('Cache-Control', 'no-store')
  async getFlota() {
    return this.flota.flota();
  }
}

@ApiExcludeController()
@Controller(BASE)
@UseGuards(V3AuthGuard)
export class ReservasV3Controller {
  constructor(private readonly reservas: ReservasV3Service) {}

  @Get('orders')
  listar(@Req() req: Request) {
    return this.reservas.listar(authV2De(req));
  }

  /** Buscador unificado del mostrador: ?q=<PNR | cedula | email>[&tipo=PNR|IDENTIFICACION|EMAIL]. */
  @Get('orders/buscar')
  @Roles('ADMIN', 'MANTENIMIENTO')
  buscar(@Query('q') q: string, @Query('tipo') tipo?: string, @Query('limit') limit?: string) {
    return this.reservas.buscar(q ?? '', tipo, Number(limit) || 25);
  }

  @Post('orders/create')
  @HttpCode(201)
  @ToleranteSinCredenciales()
  @UseGuards(IdempotencyV2Guard)
  crear(@Body() body: any, @Req() req: Request) {
    return this.reservas.crear(body, ctx(req));
  }

  /** Alias de compatibilidad (el Booking tambien usa POST /reservas y /orders). */
  @Post(['reservas', 'orders'])
  @HttpCode(201)
  @ToleranteSinCredenciales()
  @UseGuards(IdempotencyV2Guard)
  crearAlias(@Body() body: any, @Req() req: Request) {
    return this.reservas.crear(body, ctx(req));
  }

  @Get('orders/:orderId')
  obtener(@Param('orderId') orderId: string, @Req() req: Request) {
    return this.reservas.obtener(orderId, authV2De(req));
  }

  @Post('orders/:orderId/cancel')
  @HttpCode(200)
  @ToleranteSinCredenciales()
  @UseGuards(IdempotencyV2Guard)
  cancelar(@Param('orderId') orderId: string, @Body() body: any, @Req() req: Request) {
    return this.reservas.cancelar(orderId, body, ctx(req));
  }

  @Post('reservas/:id/checkin')
  @HttpCode(200)
  @UseGuards(IdempotencyV2Guard)
  checkinDigital(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    return this.reservas.checkinDigital(id, body, ctx(req));
  }

  /** Boton "Confirmar Entrega de Llaves / Check-in": CONFIRMADO_ASISTIDO + notificacion al Booking. */
  @Post('orders/:id/checkin-entrega')
  @HttpCode(200)
  @UseGuards(IdempotencyV2Guard)
  @Roles('ADMIN', 'MANTENIMIENTO')
  checkinEntrega(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    return this.reservas.checkinEntrega(id, body, ctx(req));
  }

  @Post('orders/:id/checkin-devolucion')
  @HttpCode(200)
  @UseGuards(IdempotencyV2Guard)
  @Roles('ADMIN', 'MANTENIMIENTO')
  checkinDevolucion(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    return this.reservas.checkinDevolucion(id, body, ctx(req));
  }
}

@ApiExcludeController()
@Controller(BASE)
export class CatalogoV3Controller {
  constructor(private readonly catalogo: CatalogoV2Service, private readonly flota: FlotaV2Service) {}

  @Get()
  async listar(@Query() q: any) {
    return conStockV3(await this.catalogo.listar(q ?? {}));
  }

  @Post('search')
  @HttpCode(200)
  async buscar(@Body() body: any) {
    return conStockV3(await this.catalogo.buscar(body));
  }

  @Get(':id/coberturas')
  async coberturas(@Param('id') id: string) {
    return aV3(await this.catalogo.coberturas(id));
  }

  @Get(':id/mantenimiento/bitacora')
  @UseGuards(V3AuthGuard)
  @Roles('ADMIN', 'MANTENIMIENTO')
  bitacora(@Param('id') id: string) {
    return this.flota.bitacora(id);
  }

  @Get(':id')
  async detalle(@Param('id') id: string) {
    return conStockV3(await this.catalogo.detalle(id));
  }

  @Post(':id/devolucion')
  @HttpCode(200)
  @UseGuards(V3AuthGuard, IdempotencyV2Guard)
  @Roles('ADMIN', 'MANTENIMIENTO')
  async devolucion(@Param('id') id: string, @Req() req: Request) {
    return aV3(await this.flota.devolucion(id, ctx(req)));
  }

  @Post(':id/mantenimiento/registro')
  @HttpCode(200)
  @UseGuards(V3AuthGuard, IdempotencyV2Guard)
  @Roles('MANTENIMIENTO', 'ADMIN')
  async mantenimiento(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    return aV3(await this.flota.registrarMantenimiento(id, body, ctx(req)));
  }
}

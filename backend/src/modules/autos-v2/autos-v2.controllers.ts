import {
  Body, Controller, Get, Header, HttpCode, Param, Post, Put, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request } from 'express';
import { correlationIdDe } from '../../common/correlation';
import { IdempotencyService } from '../integracion/idempotency.service';
import { OutboxService } from '../integracion/outbox.service';
import { CatalogoV2Service } from './catalogo-v2.service';
import { FlotaV2Service } from './flota-v2.service';
import { HealthV2Service } from './health-v2.service';
import { idempotencyKeyDe, IdempotencyV2Guard } from './idempotency-v2.guard';
import { problema } from './problema';
import { PromocionesV2Service } from './promociones-v2.service';
import { ReservasV2Service } from './reservas-v2.service';
import { authV2De, Roles, V2AuthGuard } from './v2-auth.guard';

/**
 * Controladores de backend/contracts/autos-openapi-v2.yaml bajo /api/v2/autos (fuera del prefijo
 * global /api/v1). Se documentan con el YAML oficial en /api/v2/docs, no con decoradores.
 * El orden de declaracion importa: las rutas fijas (/orders, /flota, /health...) se registran
 * antes que /autos/:id del catalogo.
 */
const BASE = 'api/v2/autos';

const ctx = (req: Request) => ({ auth: authV2De(req), idempotencyKey: idempotencyKeyDe(req), correlationId: correlationIdDe(req) });

@ApiExcludeController()
@Controller(BASE)
export class TelemetriaV2Controller {
  constructor(private readonly health: HealthV2Service, private readonly outbox: OutboxService) {}

  /** Semaforo LED del Booking (security: []). DOWN responde 503 Problem Details con la telemetria. */
  @Get('health')
  @Header('Cache-Control', 'no-store')
  async getHealth() {
    const h = await this.health.estado();
    if (h.status === 'DOWN') {
      throw problema(503, 'NODE_DOWN', h.total_vehiculos === 0 && h.dependencias.base_datos === 'UP'
        ? 'El nodo de autos no tiene vehículos cargados.'
        : `La base de datos del nodo de autos no responde${h.error ? `: ${h.error}` : ''}.`, { title: 'Nodo de autos no disponible', ...h });
    }
    return h;
  }

  @Get('eventos')
  @UseGuards(V2AuthGuard)
  @Roles('ADMIN', 'MANTENIMIENTO', 'B2B')
  async eventos(@Query('limit') limit?: string, @Query('after') after?: string) {
    const { events, total } = await this.outbox.feed(Number(limit ?? 10), after || undefined);
    return { events, metadata: { total, returned: events.length, timestamp: new Date().toISOString(), exchange: 'booking.events' } };
  }
}

@ApiExcludeController()
@Controller(`${BASE}/promociones`)
export class PromocionesV2Controller {
  constructor(private readonly promociones: PromocionesV2Service, private readonly idem: IdempotencyService) {}

  @Get('contrato')
  @UseGuards(V2AuthGuard)
  obtener() {
    return this.promociones.obtener();
  }

  @Put('contrato')
  @UseGuards(V2AuthGuard, IdempotencyV2Guard)
  @Roles('ADMIN')
  actualizar(@Body() body: any, @Req() req: Request) {
    const c = ctx(req);
    return this.idem.ejecutar(c.idempotencyKey, 'promociones:contrato', () => this.promociones.actualizar(body, c.auth.sub));
  }
}

@ApiExcludeController()
@Controller(BASE)
export class FlotaV2Controller {
  constructor(private readonly flota: FlotaV2Service) {}

  @Get('flota')
  @Header('Cache-Control', 'no-store')
  getFlota() {
    return this.flota.flota();
  }
}

@ApiExcludeController()
@Controller(BASE)
export class ReservasV2Controller {
  constructor(private readonly reservas: ReservasV2Service) {}

  @Get('orders')
  @UseGuards(V2AuthGuard)
  listar(@Req() req: Request) {
    return this.reservas.listar(authV2De(req));
  }

  @Post('orders/create')
  @HttpCode(201)
  @UseGuards(V2AuthGuard, IdempotencyV2Guard)
  crear(@Body() body: any, @Req() req: Request) {
    return this.reservas.crear(body, ctx(req));
  }

  /** Alias de compatibilidad de /autos/orders/create. */
  @Post('reservas')
  @HttpCode(201)
  @UseGuards(V2AuthGuard, IdempotencyV2Guard)
  crearAlias(@Body() body: any, @Req() req: Request) {
    return this.reservas.crear(body, ctx(req));
  }

  @Get('orders/:orderId')
  @UseGuards(V2AuthGuard)
  obtener(@Param('orderId') orderId: string, @Req() req: Request) {
    return this.reservas.obtener(orderId, authV2De(req));
  }

  @Post('orders/:orderId/cancel')
  @HttpCode(200)
  @UseGuards(V2AuthGuard, IdempotencyV2Guard)
  cancelar(@Param('orderId') orderId: string, @Body() body: any, @Req() req: Request) {
    return this.reservas.cancelar(orderId, body, ctx(req));
  }

  @Post('reservas/:id/checkin')
  @HttpCode(200)
  @UseGuards(V2AuthGuard, IdempotencyV2Guard)
  checkinDigital(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    return this.reservas.checkinDigital(id, body, ctx(req));
  }

  @Post('orders/:id/checkin-entrega')
  @HttpCode(200)
  @UseGuards(V2AuthGuard, IdempotencyV2Guard)
  @Roles('ADMIN', 'MANTENIMIENTO')
  checkinEntrega(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    return this.reservas.checkinEntrega(id, body, ctx(req));
  }

  @Post('orders/:id/checkin-devolucion')
  @HttpCode(200)
  @UseGuards(V2AuthGuard, IdempotencyV2Guard)
  @Roles('ADMIN', 'MANTENIMIENTO')
  checkinDevolucion(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    return this.reservas.checkinDevolucion(id, body, ctx(req));
  }
}

@ApiExcludeController()
@Controller(BASE)
export class CatalogoV2Controller {
  constructor(private readonly catalogo: CatalogoV2Service, private readonly flota: FlotaV2Service) {}

  @Get()
  listar(@Query() q: any) {
    return this.catalogo.listar(q ?? {});
  }

  @Post('search')
  @HttpCode(200)
  buscar(@Body() body: any) {
    return this.catalogo.buscar(body);
  }

  @Get(':id/coberturas')
  coberturas(@Param('id') id: string) {
    return this.catalogo.coberturas(id);
  }

  /** Extension propia (rentafacil-ec-openapi-v2.yaml): bitacora del panel de mantenimiento. */
  @Get(':id/mantenimiento/bitacora')
  @UseGuards(V2AuthGuard)
  @Roles('ADMIN', 'MANTENIMIENTO')
  bitacora(@Param('id') id: string) {
    return this.flota.bitacora(id);
  }

  @Get(':id')
  detalle(@Param('id') id: string) {
    return this.catalogo.detalle(id);
  }

  @Post(':id/devolucion')
  @HttpCode(200)
  @UseGuards(V2AuthGuard, IdempotencyV2Guard)
  @Roles('ADMIN', 'MANTENIMIENTO')
  devolucion(@Param('id') id: string, @Req() req: Request) {
    return this.flota.devolucion(id, ctx(req));
  }

  @Post(':id/mantenimiento/registro')
  @HttpCode(200)
  @UseGuards(V2AuthGuard, IdempotencyV2Guard)
  @Roles('MANTENIMIENTO', 'ADMIN')
  mantenimiento(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    return this.flota.registrarMantenimiento(id, body, ctx(req));
  }
}

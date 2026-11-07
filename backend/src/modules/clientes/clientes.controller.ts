import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { log } from '../../common/app-logger';
import { correlationIdDe } from '../../common/correlation';
import { V3AuthGuard } from '../../common/guards/v3-auth.guard';
import { problema } from '../autos-v2/problema';
import { authV2De, Roles } from '../autos-v2/v2-auth.guard';
import { OrigenCliente } from './cliente.entity';
import { aClientePublico, ClientesService, normEmail } from './clientes.service';

/** origen = BOOKING si el X-Correlation-Id empieza con "booking-", llega X-Source: BOOKING o entra por X-Api-Key. */
export function origenDe(req: Request): OrigenCliente {
  const corr = correlationIdDe(req).toLowerCase();
  const fuente = String(req.headers['x-source'] ?? '').trim().toUpperCase();
  if (corr.startsWith('booking-') || fuente === 'BOOKING') return 'BOOKING';
  if (req.headers['x-api-key'] && authV2De(req)?.rol === 'B2B') return 'BOOKING';
  return 'WEB';
}

/**
 * Clientes cross-platform v3.1 (requerimiento de la evaluacion): GET busca por email O
 * identificacion; POST crea o devuelve el existente (nunca 409). Exige X-API-Key (o el JWT del
 * panel web): apiKeyV3Middleware responde 401 MISSING_API_KEY antes de llegar aqui.
 */
@ApiExcludeController()
@Controller('api/v3/clientes')
@UseGuards(V3AuthGuard)
export class ClientesController {
  constructor(private readonly clientes: ClientesService) {}

  @Get()
  async buscar(
    @Query('email') email: string | undefined, @Query('identificacion') identificacion: string | undefined,
    @Headers('x-prefer-empty-array') vacio: string | undefined, @Req() req: Request,
  ) {
    const c = await this.clientes.buscar(email, identificacion);
    const criterio = email ? `email=${normEmail(email)}` : `identificacion=${identificacion}`;
    if (!c) {
      if (String(vacio ?? '').toLowerCase() === 'true') {
        log.info('CLIENTES', `GET ${criterio} -> NOT_FOUND | 200 OK []`);
        return [];
      }
      log.info('CLIENTES', `GET ${criterio} -> NOT_FOUND | 404`);
      throw problema(404, 'CLIENT_NOT_FOUND', `No existe un cliente con ${criterio}.`, { title: 'Cliente no encontrado' });
    }
    log.info('CLIENTES', `GET ${criterio} -> FOUND | 200 OK`, { client_id: c.client_id });
    return aClientePublico(c);
  }

  @Post()
  async crear(@Body() body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { cliente, creado } = await this.clientes.upsert(body ?? {}, origenDe(req));
    if (creado) {
      res.status(201);
      log.info('CLIENTES', `POST nombre=${cliente.nombre} -> CREATED | 201`, { client_id: cliente.client_id, origen: cliente.origen });
      return { client_id: cliente.client_id };
    }
    res.status(200);
    log.info('CLIENTES', `POST nombre=${cliente.nombre} -> EXISTS | 200`, { client_id: cliente.client_id });
    return aClientePublico(cliente);
  }
}

/** CRUD basico del panel /admin/clientes (listar, ver, buscar, editar). */
@ApiExcludeController()
@Controller('api/v3/admin/clientes')
@UseGuards(V3AuthGuard)
@Roles('ADMIN', 'MANTENIMIENTO')
export class ClientesAdminController {
  constructor(private readonly clientes: ClientesService) {}

  @Get()
  async listar(@Query('q') q?: string, @Query('limit') limit?: string) {
    return this.clientes.listar(q, Number(limit) || 50);
  }

  @Get(':id')
  obtener(@Param('id') id: string) {
    return this.clientes.obtener(id);
  }

  @Patch(':id')
  @HttpCode(200)
  @Roles('ADMIN')
  actualizar(@Param('id') id: string, @Body() body: any) {
    return this.clientes.actualizar(id, body ?? {});
  }
}

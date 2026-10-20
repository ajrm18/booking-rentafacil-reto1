import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req,
} from '@nestjs/common';
import {
  ApiBody, ApiNoContentResponse, ApiOkResponse, ApiCreatedResponse, ApiOperation, ApiParam, ApiQuery, ApiTags,
} from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { RequireScopes } from '../../../common/guards/oauth2.guard';
import { Order } from '../entities/order.entity';
import { AutosService } from '../autos.service';
import { AdminApi, ApiProblems, deleteOr404, findOr404, requireFields } from './admin-api.helpers';
import { OrderAdminViewDto, ReturnResponseDto } from './admin-schemas.dto';

const ORDER_ID = { name: 'id', description: 'order_id (UUID)', format: 'uuid' };

/**
 * API de la tabla `orders`. Las reservas de clientes nacen por el flujo del contrato
 * (/orders/hold -> /orders/preview -> /orders/create); aqui el admin las consulta, corrige
 * y registra la devolucion del vehiculo.
 */
@AdminApi('Admin - Orders')
@Controller('admin/orders')
export class OrdersAdminController {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly autos: AutosService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar todas las ordenes',
    description: 'Mas recientes primero. Incluye returned_at / returned_by_sub cuando el vehiculo ya se devolvio.',
  })
  @ApiQuery({ name: 'status', required: false, enum: ['CONFIRMED', 'CANCELLED', 'PENDING'] })
  @ApiOkResponse({ type: [OrderAdminViewDto] })
  list(@Query('status') status?: Order['status']) {
    return this.orders.find({ where: status ? { status } : {}, order: { creation_date: 'DESC' } });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una orden' })
  @ApiParam(ORDER_ID)
  @ApiOkResponse({ type: OrderAdminViewDto })
  @ApiProblems(400, 404)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return findOr404(this.orders, { order_id: id }, 'Orden', id);
  }

  @Post()
  @ApiOperation({ summary: 'Registrar una orden manual (ej. reserva hecha en mostrador)' })
  @ApiBody({ type: OrderAdminViewDto, description: 'Obligatorios: vehicle_id y total_price' })
  @ApiCreatedResponse({ type: OrderAdminViewDto })
  @ApiProblems(400)
  create(@Body() body: Partial<Order>) {
    requireFields(body, ['vehicle_id', 'total_price']);
    const { order_id: _id, creation_date: _c, updated_at: _u, ...campos } = body;
    return this.orders.save(this.orders.create({
      locator: `RENTAFACIL-${randomUUID().slice(0, 6).toUpperCase()}`,
      status: 'CONFIRMED',
      vehicle_details: { vehicle_id: campos.vehicle_id },
      route_details: {},
      ...campos,
    }));
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar una orden (estado, datos del conductor...)' })
  @ApiParam(ORDER_ID)
  @ApiBody({ type: OrderAdminViewDto, description: 'Campos a modificar (parcial)' })
  @ApiOkResponse({ type: OrderAdminViewDto })
  @ApiProblems(400, 404)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: Partial<Order>) {
    const o = await findOr404(this.orders, { order_id: id }, 'Orden', id);
    const { order_id: _id, creation_date: _c, updated_at: _u, ...campos } = body;
    Object.assign(o, campos);
    return this.orders.save(o);
  }

  @Post(':id/return')
  @HttpCode(200)
  // Scope de admin (autos:webhooks, igual que el resto del BFF admin) + autos:book: un cliente
  // con solo autos:book no puede registrar devoluciones.
  @RequireScopes('autos:webhooks', 'autos:book')
  @ApiTags('Admin - Returns')
  @ApiOperation({
    summary: 'Registrar la devolucion del vehiculo de una orden',
    description:
      'No cancela la orden: sigue CONFIRMED y se guardan returned_at = ahora y returned_by_sub = sub del JWT. ' +
      'El vehiculo pasa a WASHING con wash_until = ahora + 24 h; /search lo ofrece solo para recogidas ' +
      'desde wash_until y vuelve solo a AVAILABLE al vencer el lavado. Idempotente: si la orden ya se ' +
      'devolvio responde 200 con el estado actual sin modificar nada. Si otra orden activa ya reservo el ' +
      'vehiculo, solo se registra la devolucion (el vehiculo conserva su estado).',
  })
  @ApiParam(ORDER_ID)
  @ApiOkResponse({ type: ReturnResponseDto, description: 'Orden devuelta y estado del vehiculo' })
  @ApiProblems(400, 404, 409)
  returnOrder(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.autos.returnOrder(id, (req as any).auth);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Eliminar una orden' })
  @ApiParam(ORDER_ID)
  @ApiNoContentResponse({ description: 'Orden eliminada' })
  @ApiProblems(400, 404)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return deleteOr404(this.orders, { order_id: id }, 'Orden', id);
  }
}

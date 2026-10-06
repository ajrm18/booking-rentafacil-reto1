import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Order } from '../entities/order.entity';
import { AdminApi, deleteOr404, findOr404, requireFields } from './admin-api.helpers';

/**
 * API de la tabla `orders`. Las reservas de clientes nacen por el flujo del contrato
 * (/orders/hold -> /orders/preview -> /orders/create); aqui el admin las consulta y corrige.
 */
@AdminApi('Admin - Ordenes')
@Controller('admin/orders')
export class OrdersAdminController {
  constructor(@InjectRepository(Order) private readonly orders: Repository<Order>) {}

  @Get()
  @ApiOperation({ summary: 'Listar todas las ordenes' })
  @ApiQuery({ name: 'status', required: false, enum: ['CONFIRMED', 'CANCELLED', 'PENDING'] })
  list(@Query('status') status?: Order['status']) {
    return this.orders.find({ where: status ? { status } : {}, order: { creation_date: 'DESC' } });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una orden' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return findOr404(this.orders, { order_id: id }, 'Orden', id);
  }

  @Post()
  @ApiOperation({ summary: 'Registrar una orden manual (ej. reserva hecha en mostrador)' })
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
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: Partial<Order>) {
    const o = await findOr404(this.orders, { order_id: id }, 'Orden', id);
    const { order_id: _id, creation_date: _c, updated_at: _u, ...campos } = body;
    Object.assign(o, campos);
    return this.orders.save(o);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Eliminar una orden' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return deleteOr404(this.orders, { order_id: id }, 'Orden', id);
  }
}

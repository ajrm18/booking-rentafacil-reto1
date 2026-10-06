import {
  Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { OrderPreview } from '../entities/order-preview.entity';
import { AdminApi, deleteOr404, findOr404, requireFields } from './admin-api.helpers';

const PREVIEW_MINUTES = 30;

/** API de la tabla `order_previews` (cotizaciones creadas por POST /orders/preview). */
@AdminApi('Admin - Previsualizaciones de Orden')
@Controller('admin/order-previews')
export class OrderPreviewsAdminController {
  constructor(@InjectRepository(OrderPreview) private readonly previews: Repository<OrderPreview>) {}

  @Get()
  @ApiOperation({ summary: 'Listar previsualizaciones' })
  @ApiQuery({ name: 'vehicle_id', required: false })
  list(@Query('vehicle_id') vehicleId?: string) {
    return this.previews.find({
      where: vehicleId ? { vehicle_id: vehicleId } : {},
      order: { created_at: 'DESC' },
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una previsualizacion' })
  get(@Param('id') id: string) {
    return findOr404(this.previews, { order_preview_id: id }, 'Previsualizacion', id);
  }

  @Post()
  @ApiOperation({ summary: `Crear una previsualizacion manual (expira en ${PREVIEW_MINUTES} min si no se indica)` })
  create(@Body() body: Partial<OrderPreview>) {
    requireFields(body, ['vehicle_id', 'total_price']);
    return this.previews.save(this.previews.create({
      order_preview_id: `PRV-${randomUUID().slice(0, 8)}`,
      search_token: 'admin',
      currency: 'USD',
      breakdown: {},
      expires_at: new Date(Date.now() + PREVIEW_MINUTES * 60 * 1000),
      ...body,
    }));
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar una previsualizacion' })
  async update(@Param('id') id: string, @Body() body: Partial<OrderPreview>) {
    const p = await findOr404(this.previews, { order_preview_id: id }, 'Previsualizacion', id);
    const { order_preview_id: _id, created_at: _c, ...campos } = body;
    Object.assign(p, campos);
    return this.previews.save(p);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Eliminar una previsualizacion' })
  remove(@Param('id') id: string) {
    return deleteOr404(this.previews, { order_preview_id: id }, 'Previsualizacion', id);
  }
}

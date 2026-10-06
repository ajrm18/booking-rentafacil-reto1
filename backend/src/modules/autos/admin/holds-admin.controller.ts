import {
  Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Hold } from '../entities/hold.entity';
import { AdminApi, deleteOr404, findOr404, requireFields } from './admin-api.helpers';

const HOLD_MINUTES = 15;

/** API de la tabla `holds` (bloqueos temporales creados por POST /orders/hold). */
@AdminApi('Admin - Holds')
@Controller('admin/holds')
export class HoldsAdminController {
  constructor(@InjectRepository(Hold) private readonly holds: Repository<Hold>) {}

  @Get()
  @ApiOperation({ summary: 'Listar bloqueos' })
  @ApiQuery({ name: 'status', required: false, enum: ['HELD', 'FAILED'] })
  @ApiQuery({ name: 'vehicle_id', required: false })
  list(@Query('status') status?: Hold['status'], @Query('vehicle_id') vehicleId?: string) {
    return this.holds.find({
      where: { ...(status && { status }), ...(vehicleId && { vehicle_id: vehicleId }) },
      order: { created_at: 'DESC' },
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un bloqueo' })
  get(@Param('id') id: string) {
    return findOr404(this.holds, { hold_id: id }, 'Hold', id);
  }

  @Post()
  @ApiOperation({ summary: `Crear un bloqueo manual (expira en ${HOLD_MINUTES} min si no se indica)` })
  create(@Body() body: Partial<Hold>) {
    requireFields(body, ['vehicle_id']);
    return this.holds.save(this.holds.create({
      hold_id: `HLD-${randomUUID().slice(0, 8)}`,
      search_token: 'admin',
      status: 'HELD',
      expires_at: new Date(Date.now() + HOLD_MINUTES * 60 * 1000),
      ...body,
    }));
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar un bloqueo (estado, expiracion...)' })
  async update(@Param('id') id: string, @Body() body: Partial<Hold>) {
    const h = await findOr404(this.holds, { hold_id: id }, 'Hold', id);
    const { hold_id: _id, created_at: _c, ...campos } = body;
    Object.assign(h, campos);
    return this.holds.save(h);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Eliminar un bloqueo' })
  remove(@Param('id') id: string) {
    return deleteOr404(this.holds, { hold_id: id }, 'Hold', id);
  }
}

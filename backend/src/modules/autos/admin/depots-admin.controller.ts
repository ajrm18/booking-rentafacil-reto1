import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Depot } from '../entities/depot.entity';
import { WebhookDispatcher } from '../webhook-dispatcher.service';
import { AdminApi, deleteOr404, findOr404, requireFields } from './admin-api.helpers';

/** API de la tabla `depots`. Cada cambio emite el evento de webhook DEPOT_UPDATE. */
@AdminApi('Admin - Depots')
@Controller('admin/depots')
export class DepotsAdminController {
  constructor(
    @InjectRepository(Depot) private readonly depots: Repository<Depot>,
    private readonly dispatcher: WebhookDispatcher,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar agencias' })
  list() {
    return this.depots.find({ order: { city: 'ASC', name: 'ASC' } });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una agencia' })
  get(@Param('id', ParseIntPipe) id: number) {
    return findOr404(this.depots, { depot_id: id }, 'Agencia', id);
  }

  @Post()
  @ApiOperation({ summary: 'Crear una agencia' })
  async create(@Body() body: Partial<Depot>) {
    requireFields(body, ['name', 'city']);
    const { depot_id: _id, vehicles: _v, ...campos } = body;
    const saved = await this.depots.save(this.depots.create(campos));
    this.notify(saved, 'CREATED');
    return saved;
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar una agencia' })
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: Partial<Depot>) {
    const d = await findOr404(this.depots, { depot_id: id }, 'Agencia', id);
    const { depot_id: _id, vehicles: _v, ...campos } = body;
    Object.assign(d, campos);
    const saved = await this.depots.save(d);
    this.notify(saved, 'UPDATED');
    return saved;
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Eliminar una agencia (409 si tiene vehiculos)' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await deleteOr404(this.depots, { depot_id: id }, 'Agencia', id);
    this.dispatcher.dispatch('DEPOT_UPDATE', String(id), { change: 'DELETED', depot_id: id });
  }

  private notify(d: Depot, change: 'CREATED' | 'UPDATED') {
    this.dispatcher.dispatch('DEPOT_UPDATE', String(d.depot_id), {
      change, depot_id: d.depot_id, name: d.name, city: d.city, active: d.active,
    });
  }
}

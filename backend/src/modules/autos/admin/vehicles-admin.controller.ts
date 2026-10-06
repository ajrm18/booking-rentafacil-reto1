import {
  Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vehicle } from '../entities/vehicle.entity';
import { VehicleImage } from '../entities/vehicle-image.entity';
import { AdminApi, deleteOr404, findOr404, requireFields } from './admin-api.helpers';

/** API de la tabla `vehicles`. */
@AdminApi('Admin - Vehiculos')
@Controller('admin/vehicles')
export class VehiclesAdminController {
  constructor(
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(VehicleImage) private readonly images: Repository<VehicleImage>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar todos los vehiculos del inventario' })
  @ApiQuery({ name: 'status', required: false, example: 'AVAILABLE' })
  list(@Query('status') status?: string) {
    return this.vehicles.find({
      where: status ? { status } : {},
      relations: ['depot', 'supplier', 'images'],
      order: { created_at: 'DESC' },
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un vehiculo con su galeria' })
  get(@Param('id') id: string) {
    return findOr404(this.vehicles, { vehicle_id: id }, 'Vehiculo', id, ['depot', 'supplier', 'images']);
  }

  @Post()
  @ApiOperation({ summary: 'Crear un vehiculo' })
  create(@Body() body: Partial<Vehicle>) {
    requireFields(body, ['make', 'model', 'year', 'plate', 'price_per_day', 'depot_id', 'supplier_id']);
    if (!body.vehicle_id) body.vehicle_id = `VEH-${Date.now()}`;
    return this.vehicles.save(this.vehicles.create(body));
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar un vehiculo (acepta `gallery` para reemplazar sus fotos)' })
  async update(
    @Param('id') id: string,
    @Body() body: Partial<Vehicle> & { gallery?: string[] },
  ) {
    const v = await findOr404(this.vehicles, { vehicle_id: id }, 'Vehiculo', id);
    // La galeria se gestiona aparte: `gallery` reemplaza todas las fotos; si solo cambia
    // main_image_url se actualiza la foto principal (posicion 0) para mantenerlas en sincronia.
    const { gallery, images: _images, vehicle_id: _id, ...campos } = body;
    const mainAnterior = v.main_image_url;
    Object.assign(v, campos);
    const saved = await this.vehicles.save(v);

    if (Array.isArray(gallery) && gallery.length > 0) {
      await this.images.delete({ vehicle_id: id });
      await this.images.save(gallery.map((url, position) => this.images.create({ url, position, vehicle_id: id })));
      if (!campos.main_image_url) {
        saved.main_image_url = gallery[0];
        await this.vehicles.save(saved);
      }
    } else if (campos.main_image_url && campos.main_image_url !== mainAnterior) {
      const principal = await this.images.findOne({ where: { vehicle_id: id, position: 0 } });
      if (principal) await this.images.update(principal.id, { url: campos.main_image_url });
      else await this.images.save(this.images.create({ url: campos.main_image_url, position: 0, vehicle_id: id }));
    }
    return this.vehicles.findOne({ where: { vehicle_id: id }, relations: ['images'] });
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Eliminar un vehiculo (sus imagenes se borran en cascada)' })
  remove(@Param('id') id: string) {
    return deleteOr404(this.vehicles, { vehicle_id: id }, 'Vehiculo', id);
  }
}

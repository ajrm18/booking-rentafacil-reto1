import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vehicle } from '../entities/vehicle.entity';
import { VehicleImage } from '../entities/vehicle-image.entity';
import { AdminApi, deleteOr404, findOr404, requireFields } from './admin-api.helpers';

/**
 * API de la tabla `vehicle_images`. La imagen en posicion 0 es la foto principal,
 * por eso se mantiene sincronizada con vehicles.main_image_url.
 */
@AdminApi('Admin - Imagenes de Vehiculos')
@Controller('admin/vehicle-images')
export class VehicleImagesAdminController {
  constructor(
    @InjectRepository(VehicleImage) private readonly images: Repository<VehicleImage>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar imagenes (opcionalmente de un vehiculo)' })
  @ApiQuery({ name: 'vehicle_id', required: false, example: 'VEH-1001' })
  list(@Query('vehicle_id') vehicleId?: string) {
    return this.images.find({
      where: vehicleId ? { vehicle_id: vehicleId } : {},
      order: { vehicle_id: 'ASC', position: 'ASC' },
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una imagen' })
  get(@Param('id', ParseIntPipe) id: number) {
    return findOr404(this.images, { id }, 'Imagen', id);
  }

  @Post()
  @ApiOperation({ summary: 'Agregar una imagen a un vehiculo' })
  async create(@Body() body: Partial<VehicleImage>) {
    requireFields(body, ['url', 'vehicle_id']);
    await findOr404(this.vehicles, { vehicle_id: body.vehicle_id }, 'Vehiculo', body.vehicle_id);
    const { id: _id, vehicle: _v, ...campos } = body;
    const saved = await this.images.save(this.images.create(campos));
    await this.syncMainImage(saved);
    return saved;
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar una imagen (url o posicion)' })
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: Partial<VehicleImage>) {
    const img = await findOr404(this.images, { id }, 'Imagen', id);
    const { id: _id, vehicle: _v, vehicle_id: _vid, ...campos } = body;
    Object.assign(img, campos);
    const saved = await this.images.save(img);
    await this.syncMainImage(saved);
    return saved;
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Eliminar una imagen' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return deleteOr404(this.images, { id }, 'Imagen', id);
  }

  private async syncMainImage(img: VehicleImage): Promise<void> {
    if (img.position === 0) {
      await this.vehicles.update({ vehicle_id: img.vehicle_id }, { main_image_url: img.url });
    }
  }
}

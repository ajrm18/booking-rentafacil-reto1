import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { DataSource, Repository } from 'typeorm';
import { log } from '../../common/app-logger';
import { correlationIdDe } from '../../common/correlation';
import { V3AuthGuard } from '../../common/guards/v3-auth.guard';
import { Depot } from '../autos/entities/depot.entity';
import { Supplier } from '../autos/entities/supplier.entity';
import { Vehicle } from '../autos/entities/vehicle.entity';
import { VehicleImage } from '../autos/entities/vehicle-image.entity';
import { validarVehiculo } from '../autos/admin/admin-validaciones';
import { normalizarEstado } from '../autos/estado-vehiculo.mapper';
import { invalido, problema } from '../autos-v2/problema';
import { Roles } from '../autos-v2/v2-auth.guard';
import { aVehiculoCard } from '../autos-v2/v2.mapper';
import { InventarioService } from '../integracion/inventario.service';
import { conStockV3 } from './v3';

const CATEGORIA_INTERNA: Record<string, string> = { ECONOMICO: 'Compacto', COMPACTO: 'Sedan', SUV: 'SUV', PREMIUM: 'Lujo', VAN: 'Camioneta' };

/**
 * Alta de vehiculos con stock inicial para el FLUJO 1 de la evaluacion (/admin/vehiculos/nuevo):
 * crea el auto DISPONIBLE (1 unidad fisica por placa), registra stock.actualizado en el outbox y
 * envia PushStockUpdate (available_units=1) al Booking central, que lo ve en su catalogo.
 */
@ApiExcludeController()
@Controller('api/v3/admin/vehicles')
@UseGuards(V3AuthGuard)
@Roles('ADMIN')
export class VehiculosV3Controller {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(Depot) private readonly depots: Repository<Depot>,
    @InjectRepository(Supplier) private readonly suppliers: Repository<Supplier>,
    private readonly inventario: InventarioService,
  ) {}

  /** Agencias y proveedores para los selects del formulario. */
  @Get('opciones')
  async opciones() {
    const [depots, suppliers] = await Promise.all([this.depots.find({ order: { depot_id: 'ASC' } }), this.suppliers.find({ order: { supplier_id: 'ASC' } })]);
    return {
      depots: depots.map((d) => ({ depot_id: d.depot_id, name: d.name, city: d.city })),
      suppliers: suppliers.map((s) => ({ supplier_id: s.supplier_id, name: s.name })),
    };
  }

  @Post()
  @HttpCode(201)
  async crear(@Body() raw: any, @Req() req: Request) {
    const b = raw && typeof raw === 'object' ? raw : {};
    // Acepta los nombres internos (make, model...) o los del contrato (marca, modelo...)
    const categoria = String(b.car_type ?? b.categoria ?? 'Compacto');
    const body: Partial<Vehicle> = {
      vehicle_id: (b.vehicle_id ? String(b.vehicle_id).trim() : '') || `VEH-${Date.now().toString().slice(-7)}`,
      make: b.make ?? b.marca, model: b.model ?? b.modelo, year: Number(b.year ?? b.anio),
      plate: String(b.plate ?? b.placa ?? '').trim().toUpperCase(),
      color: b.color ?? null, seats: Number(b.seats ?? b.asientos ?? 5), doors: Number(b.doors ?? b.puertas ?? 4),
      bag_capacity: Number(b.bag_capacity ?? 3),
      transmission: String(b.transmission ?? b.transmision ?? 'manual').toLowerCase().startsWith('auto') ? 'automatica' : 'manual',
      fuel_type: b.fuel_type ?? b.combustible ?? 'gasolina',
      car_type: CATEGORIA_INTERNA[categoria.toUpperCase()] ?? categoria,
      air_conditioning: b.air_conditioning ?? true,
      price_per_day: Number(b.price_per_day ?? b.precio_diario),
      description: b.description ?? b.descripcion ?? null,
      main_image_url: b.main_image_url ?? b.foto_url ?? null,
      depot_id: Number(b.depot_id), supplier_id: Number(b.supplier_id),
      kilometraje_actual: Number(b.kilometraje_actual ?? 0),
      status: normalizarEstado(String(b.status ?? b.estado ?? 'AVAILABLE')) ?? 'AVAILABLE',
    } as any;
    const faltan = (['make', 'model', 'year', 'plate', 'price_per_day', 'depot_id', 'supplier_id'] as const)
      .filter((k) => body[k] === undefined || body[k] === null || body[k] === '' || (typeof body[k] === 'number' && isNaN(body[k] as number)));
    if (faltan.length) throw invalido(faltan.map((name) => ({ name, reason: 'Campo obligatorio' })));
    try { validarVehiculo(body); } catch (e: any) {
      const r = e?.getResponse?.() ?? {};
      throw invalido(r.invalidParams ?? [{ name: 'body', reason: r.detail ?? e?.message ?? 'Datos inválidos' }]);
    }
    if (!(await this.depots.exist({ where: { depot_id: body.depot_id } }))) throw invalido([{ name: 'depot_id', reason: 'La agencia no existe' }]);
    if (!(await this.suppliers.exist({ where: { supplier_id: body.supplier_id } }))) throw invalido([{ name: 'supplier_id', reason: 'El proveedor no existe' }]);
    if (await this.vehicles.exist({ where: { plate: body.plate } })) throw problema(409, 'VEHICLE_DUPLICATED', `Ya existe un vehículo con la placa ${body.plate}.`);
    if (await this.vehicles.exist({ where: { vehicle_id: body.vehicle_id } })) throw problema(409, 'VEHICLE_DUPLICATED', `Ya existe el vehículo ${body.vehicle_id}.`);

    const correlation = correlationIdDe(req);
    await this.ds.transaction(async (m) => {
      await m.save(m.create(Vehicle, body));
      if (body.main_image_url) await m.save(m.create(VehicleImage, { url: body.main_image_url, position: 0, vehicle_id: body.vehicle_id }));
      await this.inventario.registrarCambio(m, { vehicle_id: body.vehicle_id!, status: body.status! }, 'vehicle.created', correlation);
    });
    this.inventario.notificarStock({ vehicle_id: body.vehicle_id!, status: body.status! });
    const v = await this.vehicles.findOneOrFail({ where: { vehicle_id: body.vehicle_id }, relations: ['images'] });
    log.info('CATALOGO', `POST /admin/vehicles vehicle_id=${v.vehicle_id} placa=${v.plate} -> CREATED | stock=${v.status === 'AVAILABLE' ? 1 : 0}`);
    return conStockV3(aVehiculoCard(v));
  }
}

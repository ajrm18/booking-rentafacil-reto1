import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OAuth2Guard, RequireScopes } from '../../common/guards/oauth2.guard';
import { Depot } from './entities/depot.entity';
import { Supplier } from './entities/supplier.entity';
import { Vehicle } from './entities/vehicle.entity';
import { Order } from './entities/order.entity';

/**
 * Endpoints de administracion interna (BFF del panel admin de RentaFacil EC).
 * NO forman parte del contrato oficial autos-openapi.yaml (que es solo lectura publica
 * y ordenes para el consumidor). Aqui se implementa la gestion de inventario que exige
 * el Reto 1 (sistema de administracion funcional).
 */
@ApiTags('Administracion Interna')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(OAuth2Guard)
@RequireScopes('autos:webhooks')
export class AdminController {
  constructor(
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(Depot) private readonly depots: Repository<Depot>,
    @InjectRepository(Supplier) private readonly suppliers: Repository<Supplier>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
  ) {}

  // Vehiculos
  @Get('vehicles')
  @ApiOperation({ summary: 'Listar todos los vehiculos del inventario (admin)' })
  listVehicles() {
    return this.vehicles.find({ relations: ['depot', 'supplier', 'images'], order: { created_at: 'DESC' } });
  }

  @Post('vehicles')
  @ApiOperation({ summary: 'Crear un vehiculo (admin)' })
  createVehicle(@Body() body: Partial<Vehicle>) {
    if (!body.vehicle_id) body.vehicle_id = `VEH-${Date.now()}`;
    return this.vehicles.save(this.vehicles.create(body));
  }

  @Put('vehicles/:id')
  @ApiOperation({ summary: 'Actualizar un vehiculo (admin)' })
  async updateVehicle(@Param('id') id: string, @Body() body: Partial<Vehicle>) {
    const v = await this.vehicles.findOne({ where: { vehicle_id: id } });
    if (!v) return { error: 'not_found' };
    Object.assign(v, body);
    return this.vehicles.save(v);
  }

  @Delete('vehicles/:id')
  @ApiOperation({ summary: 'Eliminar un vehiculo (admin)' })
  deleteVehicle(@Param('id') id: string) {
    return this.vehicles.delete({ vehicle_id: id });
  }

  // Depots
  @Get('depots')
  listDepots() { return this.depots.find({ order: { city: 'ASC', name: 'ASC' } }); }

  @Post('depots')
  createDepot(@Body() body: Partial<Depot>) { return this.depots.save(this.depots.create(body)); }

  @Put('depots/:id')
  async updateDepot(@Param('id', ParseIntPipe) id: number, @Body() body: Partial<Depot>) {
    const d = await this.depots.findOne({ where: { depot_id: id } });
    if (!d) return { error: 'not_found' };
    Object.assign(d, body);
    return this.depots.save(d);
  }

  @Delete('depots/:id')
  deleteDepot(@Param('id', ParseIntPipe) id: number) { return this.depots.delete(id); }

  // Suppliers
  @Get('suppliers')
  listSuppliers() { return this.suppliers.find({ order: { name: 'ASC' } }); }

  @Post('suppliers')
  createSupplier(@Body() body: Partial<Supplier>) { return this.suppliers.save(this.suppliers.create(body)); }

  @Put('suppliers/:id')
  async updateSupplier(@Param('id', ParseIntPipe) id: number, @Body() body: Partial<Supplier>) {
    const s = await this.suppliers.findOne({ where: { supplier_id: id } });
    if (!s) return { error: 'not_found' };
    Object.assign(s, body);
    return this.suppliers.save(s);
  }

  @Delete('suppliers/:id')
  deleteSupplier(@Param('id', ParseIntPipe) id: number) { return this.suppliers.delete(id); }

  // Ordenes
  @Get('orders')
  @ApiOperation({ summary: 'Listar todas las ordenes (admin)' })
  listOrders(@Query('status') status?: string) {
    return this.orders.find({ where: status ? { status: status as any } : {}, order: { creation_date: 'DESC' } });
  }

  // Estadisticas para dashboard admin
  @Get('stats')
  @ApiOperation({ summary: 'Estadisticas agregadas para el dashboard admin' })
  async stats() {
    const [totalVehicles, totalDepots, totalSuppliers, totalOrders, confirmed] = await Promise.all([
      this.vehicles.count(),
      this.depots.count(),
      this.suppliers.count(),
      this.orders.count(),
      this.orders.count({ where: { status: 'CONFIRMED' } }),
    ]);
    const orders = await this.orders.find({ where: { status: 'CONFIRMED' } });
    const revenue = orders.reduce((s, o) => s + Number(o.total_price), 0);
    return {
      total_vehicles: totalVehicles,
      total_depots: totalDepots,
      total_suppliers: totalSuppliers,
      total_orders: totalOrders,
      confirmed_orders: confirmed,
      total_revenue: Number(revenue.toFixed(2)),
    };
  }
}

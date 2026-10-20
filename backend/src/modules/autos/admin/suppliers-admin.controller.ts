import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put,
} from '@nestjs/common';
import {
  ApiBody, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiParam,
} from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from '../entities/supplier.entity';
import { AdminApi, ApiProblems, deleteOr404, findOr404, requireFields } from './admin-api.helpers';
import { SupplierAdminDto } from './admin-schemas.dto';
import { validarProveedor } from './admin-validaciones';

/** API de la tabla `suppliers`. */
@AdminApi('Admin - Suppliers')
@Controller('admin/suppliers')
export class SuppliersAdminController {
  constructor(@InjectRepository(Supplier) private readonly suppliers: Repository<Supplier>) {}

  @Get()
  @ApiOperation({ summary: 'Listar proveedores' })
  @ApiOkResponse({ type: [SupplierAdminDto] })
  list() {
    return this.suppliers.find({ order: { name: 'ASC' } });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un proveedor' })
  @ApiParam({ name: 'id', description: 'supplier_id', type: Number })
  @ApiOkResponse({ type: SupplierAdminDto })
  @ApiProblems(404)
  get(@Param('id', ParseIntPipe) id: number) {
    return findOr404(this.suppliers, { supplier_id: id }, 'Proveedor', id);
  }

  @Post()
  @ApiOperation({ summary: 'Crear un proveedor' })
  @ApiBody({ type: SupplierAdminDto })
  @ApiCreatedResponse({ type: SupplierAdminDto })
  @ApiProblems(400)
  create(@Body() body: Partial<Supplier>) {
    requireFields(body, ['name']);
    const { supplier_id: _id, vehicles: _v, ...campos } = body;
    validarProveedor(campos);
    return this.suppliers.save(this.suppliers.create(campos));
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar un proveedor' })
  @ApiParam({ name: 'id', description: 'supplier_id', type: Number })
  @ApiBody({ type: SupplierAdminDto, description: 'Campos a modificar (parcial)' })
  @ApiOkResponse({ type: SupplierAdminDto })
  @ApiProblems(400, 404)
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: Partial<Supplier>) {
    const s = await findOr404(this.suppliers, { supplier_id: id }, 'Proveedor', id);
    const { supplier_id: _id, vehicles: _v, ...campos } = body;
    validarProveedor(campos);
    Object.assign(s, campos);
    return this.suppliers.save(s);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Eliminar un proveedor (409 si tiene vehiculos)' })
  @ApiParam({ name: 'id', description: 'supplier_id', type: Number })
  @ApiNoContentResponse({ description: 'Eliminado' })
  @ApiProblems(404, 409)
  remove(@Param('id', ParseIntPipe) id: number) {
    return deleteOr404(this.suppliers, { supplier_id: id }, 'Proveedor', id);
  }
}

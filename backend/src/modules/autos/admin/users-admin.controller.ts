import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Param,
  ParseUUIDPipe, Post, Put, Query, Req,
} from '@nestjs/common';
import { ApiOperation, ApiQuery } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { hashPassword } from '../../../common/password';
import { User, UserRole } from '../entities/user.entity';
import { AdminApi, deleteOr404, findOr404, requireFields } from './admin-api.helpers';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ROLES: UserRole[] = ['client', 'admin'];
const MIN_PASSWORD = 8;

type UserBody = Partial<Omit<User, 'password_hash'>> & { password?: string };

function invalid(name: string, reason: string): BadRequestException {
  return new BadRequestException({
    type: 'https://api.booking-hub.com/errors/validation-failed',
    title: 'Petición inválida',
    status: 400,
    code: 'VALIDATION_FAILED',
    detail: reason,
    invalidParams: [{ name, reason }],
  });
}

/**
 * API de la tabla `users`: el admin crea clientes (o admins), los edita y los elimina.
 * Nunca devuelve password_hash (columna con select: false).
 */
@AdminApi('Admin - Usuarios')
@Controller('admin/users')
export class UsersAdminController {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  @Get()
  @ApiOperation({ summary: 'Listar usuarios' })
  @ApiQuery({ name: 'role', required: false, enum: ROLES })
  list(@Query('role') role?: UserRole) {
    return this.users.find({ where: role ? { role } : {}, order: { created_at: 'DESC' } });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un usuario' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return findOr404(this.users, { user_id: id }, 'Usuario', id);
  }

  @Post()
  @ApiOperation({ summary: 'Crear un usuario (cliente por defecto)' })
  async create(@Body() body: UserBody) {
    requireFields(body, ['first_name', 'last_name', 'email', 'password']);
    const datos = await this.validar(body);
    const user = this.users.create({ ...datos, role: datos.role ?? 'client', password_hash: hashPassword(body.password!) });
    const { user_id } = await this.users.save(user);
    return this.users.findOneByOrFail({ user_id });
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar un usuario (nombre, email, rol, teléfono y, opcionalmente, contraseña)' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UserBody, @Req() req: Request) {
    const user = await findOr404(this.users, { user_id: id }, 'Usuario', id);
    const datos = await this.validar(body, id);
    // Un admin no puede quitarse a sí mismo el rol (evita quedarse fuera del panel)
    if (datos.role === 'client' && user.role === 'admin' && user.email === (req as any).auth?.sub) {
      throw invalid('role', 'No puedes quitarte el rol de administrador a ti mismo');
    }
    Object.assign(user, datos);
    if (body.password) (user as any).password_hash = hashPassword(body.password);
    await this.users.save(user);
    return this.users.findOneByOrFail({ user_id: id });
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Eliminar un usuario' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const user = await findOr404(this.users, { user_id: id }, 'Usuario', id);
    if (user.email === (req as any).auth?.sub) {
      throw new ConflictException({
        type: 'https://api.booking-hub.com/errors/conflict',
        title: 'No puedes eliminar tu propia cuenta',
        status: 409,
        code: 'VALIDATION_FAILED',
      });
    }
    await deleteOr404(this.users, { user_id: id }, 'Usuario', id);
  }

  /** Normaliza y valida los campos editables; `id` excluye al propio usuario del chequeo de email único. */
  private async validar(body: UserBody, id?: string) {
    const out: Partial<User> = {};
    for (const k of ['first_name', 'last_name'] as const) {
      if (body[k] !== undefined) {
        const v = String(body[k]).trim();
        if (v.length < 2) throw invalid(k, 'Debe tener al menos 2 caracteres');
        out[k] = v;
      }
    }
    if (body.email !== undefined) {
      const email = String(body.email).trim().toLowerCase();
      if (!EMAIL_RE.test(email)) throw invalid('email', 'Correo electrónico inválido');
      const dup = await this.users.findOne({ where: { email } });
      if (dup && dup.user_id !== id) throw invalid('email', 'Ya existe un usuario con ese correo');
      out.email = email;
    }
    if (body.role !== undefined) {
      if (!ROLES.includes(body.role)) throw invalid('role', 'El rol debe ser client o admin');
      out.role = body.role;
    }
    if (body.password !== undefined && body.password !== '' && String(body.password).length < MIN_PASSWORD) {
      throw invalid('password', `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`);
    }
    if (body.phone !== undefined) out.phone = body.phone ? String(body.phone).trim() : null;
    if (body.national_id !== undefined) {
      const ced = body.national_id ? String(body.national_id).trim() : null;
      if (ced && !/^\d{10}$/.test(ced)) throw invalid('national_id', 'La cédula debe tener 10 dígitos');
      out.national_id = ced;
    }
    return out;
  }
}

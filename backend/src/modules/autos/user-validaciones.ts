import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { cedulaValida, EMAIL_RE, NOMBRE_RE, telefonoValido } from '../../common/validaciones';
import { User, UserRole } from './entities/user.entity';

/**
 * Validación de los datos de un usuario, compartida por el CRUD del admin (/admin/users)
 * y el registro público de clientes (/auth/register), para que ambos apliquen las mismas reglas.
 */
export const ROLES: UserRole[] = ['client', 'admin'];
export const MIN_PASSWORD = 8;

export type UserBody = Partial<Omit<User, 'password_hash'>> & { password?: string };

export function invalid(name: string, reason: string): BadRequestException {
  return new BadRequestException({
    type: 'https://api.booking-hub.com/errors/validation-failed',
    title: 'Petición inválida',
    status: 400,
    code: 'VALIDATION_FAILED',
    detail: reason,
    invalidParams: [{ name, reason }],
  });
}

/** Normaliza y valida los campos presentes; `id` excluye al propio usuario del chequeo de email/cédula únicos. */
export async function validarUsuario(users: Repository<User>, body: UserBody, id?: string): Promise<Partial<User>> {
  const out: Partial<User> = {};
  for (const k of ['first_name', 'last_name'] as const) {
    if (body[k] !== undefined) {
      const v = String(body[k]).trim().replace(/\s+/g, ' ');
      if (v.length < 2) throw invalid(k, 'Debe tener al menos 2 letras');
      if (v.length > 60) throw invalid(k, 'No puede superar los 60 caracteres');
      if (!NOMBRE_RE.test(v)) throw invalid(k, 'Solo puede contener letras');
      out[k] = v;
    }
  }
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw invalid('email', 'Correo electrónico inválido (debe tener una sola @ y un dominio)');
    const dup = await users.findOne({ where: { email } });
    if (dup && dup.user_id !== id) throw invalid('email', 'Ya existe un usuario con ese correo');
    out.email = email;
  }
  if (body.role !== undefined) {
    if (!ROLES.includes(body.role)) throw invalid('role', 'El rol debe ser client o admin');
    out.role = body.role;
  }
  if (body.password !== undefined && body.password !== '') {
    const len = String(body.password).length;
    if (len < MIN_PASSWORD) throw invalid('password', `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`);
    if (len > 72) throw invalid('password', 'La contraseña no puede superar los 72 caracteres');
  }
  if (body.phone !== undefined) {
    const tel = body.phone ? String(body.phone).trim() : null;
    if (tel && !telefonoValido(tel)) throw invalid('phone', 'El teléfono solo admite números (9 a 15 dígitos, "+" opcional al inicio)');
    out.phone = tel;
  }
  if (body.national_id !== undefined) {
    const ced = body.national_id ? String(body.national_id).trim() : null;
    if (ced && !/^\d{10}$/.test(ced)) throw invalid('national_id', 'La cédula debe tener 10 dígitos');
    if (ced && !cedulaValida(ced)) throw invalid('national_id', 'La cédula no es válida');
    if (ced) {
      const dupCed = await users.findOne({ where: { national_id: ced } });
      if (dupCed && dupCed.user_id !== id) throw invalid('national_id', 'Ya existe un usuario con esa cédula');
    }
    out.national_id = ced;
  }
  return out;
}

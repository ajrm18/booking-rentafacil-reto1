import {
  applyDecorators, BadRequestException, ConflictException, NotFoundException, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FindOptionsWhere, ObjectLiteral, QueryFailedError, Repository } from 'typeorm';
import { OAuth2Guard, RequireScopes } from '../../../common/guards/oauth2.guard';

/**
 * Decorador comun de las APIs de administracion (una por tabla): tag de Swagger,
 * JWT obligatorio y scope de administrador.
 */
export const AdminApi = (tag: string) => applyDecorators(
  ApiTags(tag),
  ApiBearerAuth(),
  UseGuards(OAuth2Guard),
  RequireScopes('autos:webhooks'),
);

export function notFound(recurso: string, id: string | number): NotFoundException {
  return new NotFoundException({
    type: 'https://api.booking-hub.com/errors/not-found',
    title: `${recurso} no encontrado`,
    status: 404,
    code: 'VALIDATION_FAILED',
    detail: `No existe ${recurso} con id ${id}`,
  });
}

/** Lanza 400 (Problem Details) si falta alguno de los campos obligatorios del body. */
export function requireFields(body: Record<string, any>, campos: string[]): void {
  const faltantes = campos.filter((c) => body?.[c] === undefined || body?.[c] === null || body?.[c] === '');
  if (faltantes.length > 0) {
    throw new BadRequestException({
      type: 'https://api.booking-hub.com/errors/validation-failed',
      title: 'Petición inválida',
      status: 400,
      code: 'VALIDATION_FAILED',
      invalidParams: faltantes.map((name) => ({ name, reason: 'Campo obligatorio' })),
    });
  }
}

export async function findOr404<T extends ObjectLiteral>(
  repo: Repository<T>, where: FindOptionsWhere<T>, recurso: string, id: string | number, relations?: string[],
): Promise<T> {
  const row = await repo.findOne({ where, relations });
  if (!row) throw notFound(recurso, id);
  return row;
}

/**
 * Borra un registro: 404 si no existe y 409 si otros registros dependen de el
 * (violacion de llave foranea en PostgreSQL, codigo 23503).
 */
export async function deleteOr404<T extends ObjectLiteral>(
  repo: Repository<T>, where: FindOptionsWhere<T>, recurso: string, id: string | number,
): Promise<void> {
  try {
    const r = await repo.delete(where);
    if (r.affected === 0) throw notFound(recurso, id);
  } catch (e) {
    if (e instanceof QueryFailedError && (e as any).driverError?.code === '23503') {
      throw new ConflictException({
        type: 'https://api.booking-hub.com/errors/conflict',
        title: `No se puede eliminar ${recurso}`,
        status: 409,
        code: 'VALIDATION_FAILED',
        detail: `${recurso} ${id} tiene registros asociados; eliminelos o reasignelos primero.`,
      });
    }
    throw e;
  }
}

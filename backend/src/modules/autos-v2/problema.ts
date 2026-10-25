import { HttpException } from '@nestjs/common';

export interface ParametroInvalido { name: string; reason: string }

const TITULOS: Record<number, string> = {
  400: 'Solicitud inválida',
  401: 'No autenticado',
  403: 'Acceso restringido',
  404: 'Recurso no encontrado',
  409: 'Conflicto con el estado actual',
  422: 'Entidad no procesable',
  500: 'Error interno del servidor',
  503: 'Servicio no disponible',
};

/**
 * Excepcion RFC 7807 de /api/v2 (components.schemas.ProblemDetails del contrato v2). El filtro
 * global completa instance, correlation_id y timestamp.
 */
export function problema(
  status: number, code: string, detail: string,
  extra: { title?: string; invalid_params?: ParametroInvalido[]; [k: string]: any } = {},
): HttpException {
  const { title, ...resto } = extra;
  return new HttpException({
    type: `https://booking.epn.edu.ec/errors/${code.toLowerCase().replace(/_/g, '-')}`,
    title: title ?? TITULOS[status] ?? 'Error',
    status,
    detail,
    code,
    ...resto,
  }, status);
}

/** 400 VALIDATION_FAILED con la lista de campos invalidos. */
export function invalido(params: ParametroInvalido[], detail?: string): HttpException {
  return problema(400, 'VALIDATION_FAILED', detail ?? params.map((p) => `${p.name}: ${p.reason}`).join('; '), {
    title: 'Parámetros inválidos',
    invalid_params: params,
  });
}

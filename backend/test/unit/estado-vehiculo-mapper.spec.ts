import { EstadoVehiculoEnum, VEHICLE_STATUSES } from '../../src/modules/autos/entities/vehicle.entity';
import {
  aEstadoV1, aEstadoV2, desdeEstadoV2, normalizarEstado, unidadesDisponibles,
} from '../../src/modules/autos/estado-vehiculo.mapper';

describe('Mapper de estados ingles (vehicles.status) <-> espanol (EstadoVehiculoEnum v2)', () => {
  const pares: Array<[string, EstadoVehiculoEnum]> = [
    ['AVAILABLE', EstadoVehiculoEnum.DISPONIBLE],
    ['RESERVED', EstadoVehiculoEnum.RESERVADO],
    ['READY_FOR_PICKUP', EstadoVehiculoEnum.LISTO_PARA_ENTREGAR],
    ['DELIVERED', EstadoVehiculoEnum.ENTREGADO],
    ['WASHING', EstadoVehiculoEnum.EN_LIMPIEZA],
    ['MAINTENANCE', EstadoVehiculoEnum.EN_MANTENIMIENTO],
  ];

  it('el enum v2 tiene exactamente las 6 fases del contrato', () => {
    expect(Object.values(EstadoVehiculoEnum)).toEqual([
      'DISPONIBLE', 'RESERVADO', 'LISTO_PARA_ENTREGAR', 'ENTREGADO', 'EN_LIMPIEZA', 'EN_MANTENIMIENTO',
    ]);
  });

  it.each(pares)('%s <-> %s (ida y vuelta)', (interno, v2) => {
    expect(aEstadoV2(interno)).toBe(v2);
    expect(desdeEstadoV2(v2)).toBe(interno);
    expect(desdeEstadoV2(aEstadoV2(interno))).toBe(interno);
  });

  it('todo estado interno tiene fase v2 (INACTIVE se publica como EN_MANTENIMIENTO)', () => {
    for (const s of VEHICLE_STATUSES) expect(Object.values(EstadoVehiculoEnum)).toContain(aEstadoV2(s));
    expect(aEstadoV2('INACTIVE')).toBe('EN_MANTENIMIENTO');
  });

  it('/api/v1 sigue viendo AVAILABLE/RESERVED/WASHING/MAINTENANCE: las fases nuevas cuentan como RESERVED', () => {
    expect(aEstadoV1('AVAILABLE')).toBe('AVAILABLE');
    expect(aEstadoV1('RESERVED')).toBe('RESERVED');
    expect(aEstadoV1('READY_FOR_PICKUP')).toBe('RESERVED');
    expect(aEstadoV1('DELIVERED')).toBe('RESERVED');
    expect(aEstadoV1('WASHING')).toBe('WASHING');
    expect(aEstadoV1('MAINTENANCE')).toBe('MAINTENANCE');
  });

  it('normalizarEstado acepta ambos idiomas y rechaza valores desconocidos', () => {
    expect(normalizarEstado('en_limpieza')).toBe('WASHING');
    expect(normalizarEstado('WASHING')).toBe('WASHING');
    expect(normalizarEstado('LISTO_PARA_ENTREGAR')).toBe('READY_FOR_PICKUP');
    expect(normalizarEstado('RENTED')).toBeUndefined();
  });

  it('valores desconocidos lanzan error en vez de publicar un estado fuera del contrato', () => {
    expect(() => aEstadoV2('RENTED')).toThrow();
    expect(() => desdeEstadoV2('ALQUILADO')).toThrow();
  });

  it('available_units del canal gRPC: 1 solo en DISPONIBLE', () => {
    expect(unidadesDisponibles('AVAILABLE')).toBe(1);
    for (const s of ['RESERVED', 'READY_FOR_PICKUP', 'DELIVERED', 'WASHING', 'MAINTENANCE']) expect(unidadesDisponibles(s)).toBe(0);
  });
});

import { HttpException } from '@nestjs/common';
import {
  calcularDisponibleDesde, COOLDOWN_MINUTES, WASH_HOURS,
} from '../../src/modules/autos/entities/vehicle.entity';
import {
  assertReservable, calcularPrecio, enCooldown, evaluarEdad, FRANJAS, normalizarCobertura,
  parsearPeriodo, resolverCiudad, segundosRestantesCooldown,
} from '../../src/modules/autos-v2/reglas';

const HORA = 60 * 60 * 1000;
const errorDe = (fn: () => unknown): { status: number; body: any } => {
  try { fn(); } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() };
    throw e;
  }
  throw new Error('No lanzo excepcion');
};

describe('Cooldown de limpieza: 2 horas exactas (CE01), no 24 h', () => {
  it('COOLDOWN_MINUTES = 120 y WASH_HOURS = 2', () => {
    expect(COOLDOWN_MINUTES).toBe(120);
    expect(WASH_HOURS).toBe(2);
  });

  it('disponible_desde = devolucion + 7 200 000 ms', () => {
    const devolucion = new Date('2026-10-22T12:00:00Z');
    const fin = calcularDisponibleDesde(devolucion);
    expect(fin.toISOString()).toBe('2026-10-22T14:00:00.000Z');
    expect(fin.getTime() - devolucion.getTime()).toBe(2 * HORA);
  });

  it('enCooldown / segundos restantes del cronometro', () => {
    const ahora = new Date('2026-10-22T12:30:00Z');
    const v = { status: 'WASHING', wash_until: new Date('2026-10-22T14:00:00Z') };
    expect(enCooldown(v, ahora)).toBe(true);
    expect(segundosRestantesCooldown(v, ahora)).toBe(90 * 60);
    expect(enCooldown(v, new Date('2026-10-22T14:00:00Z'))).toBe(false);
    expect(segundosRestantesCooldown({ status: 'AVAILABLE', wash_until: null }, ahora)).toBe(0);
  });
});

describe('assertReservable: 409 al reservar un vehiculo EN_LIMPIEZA', () => {
  const ahora = new Date('2026-10-22T12:30:00Z');

  it('DISPONIBLE se puede reservar', () => {
    expect(() => assertReservable({ vehicle_id: 'VEH-1', status: 'AVAILABLE', wash_until: null }, ahora)).not.toThrow();
  });

  it('EN_LIMPIEZA durante el cooldown -> 409 VEHICLE_IN_CLEANING_COOLDOWN con la hora de disponibilidad', () => {
    const { status, body } = errorDe(() => assertReservable(
      { vehicle_id: 'VEH-1', status: 'WASHING', wash_until: new Date('2026-10-22T14:30:00Z') }, ahora));
    expect(status).toBe(409);
    expect(body.code).toBe('VEHICLE_IN_CLEANING_COOLDOWN');
    expect(body.detail).toContain('14:30 UTC');
    expect(body.disponible_desde).toBe('2026-10-22T14:30:00.000Z');
  });

  it.each(['RESERVED', 'READY_FOR_PICKUP', 'DELIVERED', 'MAINTENANCE'])('%s -> 409 VEHICLE_NOT_AVAILABLE', (s) => {
    const { status, body } = errorDe(() => assertReservable({ vehicle_id: 'VEH-1', status: s, wash_until: null }, ahora));
    expect(status).toBe(409);
    expect(body.code).toBe('VEHICLE_NOT_AVAILABLE');
  });
});

describe('Control etario (HU-AUT-01)', () => {
  it.each([0, 16, 17])('%i anios -> HTTP 422 DRIVER_AGE_RESTRICTION', (edad) => {
    const { status, body } = errorDe(() => evaluarEdad(edad));
    expect(status).toBe(422);
    expect(body.code).toBe('DRIVER_AGE_RESTRICTION');
  });

  it.each([[18, 'JOVEN'], [24, 'JOVEN'], [71, 'SENIOR'], [85, 'SENIOR']])('%i anios -> recargo %s (no es error)', (edad, motivo) => {
    expect(evaluarEdad(edad)).toEqual({ recargo: true, motivo });
  });

  it.each([25, 32, 70])('%i anios -> sin recargo', (edad) => {
    expect(evaluarEdad(edad)).toEqual({ recargo: false, motivo: null });
  });

  it('sin edad declarada no hay recargo; edad no numerica -> 400', () => {
    expect(evaluarEdad(undefined)).toEqual({ recargo: false, motivo: null });
    expect(errorDe(() => evaluarEdad('veinte')).status).toBe(400);
  });

  it('el recargo se suma al total: 10 USD por dia', () => {
    const p = calcularPrecio(35.5, 3, 'BASICA', evaluarEdad(22));
    expect(p.recargo_edad).toBe(30);
    expect(p.total).toBe(136.5);
  });
});

describe('Coberturas y precio v2', () => {
  it('ejemplo del contrato: 3 dias x 35.50 + Cobertura TOTAL 18/dia = 160.50, deposito 0', () => {
    const p = calcularPrecio(35.5, 3, 'TOTAL', { recargo: false, motivo: null });
    expect(p).toMatchObject({ base: 106.5, costo_cobertura: 54, total: 160.5, deposito_garantia: 0 });
  });

  it('BASICA cuesta 0 adicional y retiene deposito', () => {
    const p = calcularPrecio(35.5, 3, 'BASICA', { recargo: false, motivo: null });
    expect(p.total).toBe(106.5);
    expect(p.deposito_garantia).toBeGreaterThan(0);
  });

  it('normalizarCobertura: BASICA por defecto, PREMIUM = TOTAL, otro valor -> 400', () => {
    expect(normalizarCobertura(undefined)).toBe('BASICA');
    expect(normalizarCobertura('premium')).toBe('TOTAL');
    expect(errorDe(() => normalizarCobertura('ORO')).status).toBe(400);
  });
});

describe('Franjas horarias estrictas de 30 minutos', () => {
  const base = { pickup_date: '2030-01-10', dropoff_date: '2030-01-13' };

  it('hay 48 franjas: 00:00, 00:30 ... 23:30', () => {
    expect(FRANJAS).toHaveLength(48);
    expect(FRANJAS.slice(0, 3)).toEqual(['00:00', '00:30', '01:00']);
    expect(FRANJAS[47]).toBe('23:30');
  });

  it('acepta HH:00 y HH:30 y calcula los dias', () => {
    const p = parsearPeriodo({ ...base, pickup_time: '10:30', dropoff_time: '10:00' });
    expect(p.dias).toBe(3);
    expect(p.pickup.toISOString()).toBe('2030-01-10T15:30:00.000Z'); // 10:30 en Ecuador (UTC-5)
  });

  it.each(['10:15', '9:00', '24:00', '10:45', 'diez'])('rechaza %s con 400 e invalid_params', (hora) => {
    const { status, body } = errorDe(() => parsearPeriodo({ ...base, pickup_time: hora, dropoff_time: '10:00' }));
    expect(status).toBe(400);
    expect(body.invalid_params[0].name).toBe('pickup_time');
  });

  it('rechaza recogida en el pasado y devolucion anterior a la recogida', () => {
    expect(errorDe(() => parsearPeriodo({ pickup_date: '2020-01-01', pickup_time: '10:00', dropoff_date: '2020-01-03', dropoff_time: '10:00' })).status).toBe(400);
    expect(errorDe(() => parsearPeriodo({ ...base, pickup_time: '10:00', dropoff_date: '2030-01-09', dropoff_time: '10:00' })).status).toBe(400);
  });
});

describe('resolverCiudad (pickup_location: IATA o ciudad)', () => {
  const ciudades = ['Quito', 'Guayaquil', 'Cuenca'];
  it.each([
    ['UIO', 'Quito'], ['GYE', 'Guayaquil'],
    ['Aeropuerto Mariscal Sucre (UIO), Quito', 'Quito'], ['cuenca', 'Cuenca'],
  ])('%s -> %s', (entrada, ciudad) => expect(resolverCiudad(entrada, ciudades)).toBe(ciudad));
  it('ubicacion sin agencias -> null; vacia -> sin filtro', () => {
    expect(resolverCiudad('Loja', ciudades)).toBeNull();
    expect(resolverCiudad('', ciudades)).toBeUndefined();
  });
});

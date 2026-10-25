import { ConflictException, NotFoundException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { AutosService, vehicleAvailableFor } from '../../src/modules/autos/autos.service';
import { Order } from '../../src/modules/autos/entities/order.entity';
import { Vehicle } from '../../src/modules/autos/entities/vehicle.entity';

const HORA = 60 * 60 * 1000;
const ADMIN = { sub: 'admin@rentafacil.ec', scopes: ['autos:book', 'autos:webhooks'] };

/**
 * AutosService con repositorios en memoria: solo lo que usa returnOrder
 * (findOne por id y update dentro de una transaccion).
 */
function buildService(order: Partial<Order> | null, vehicle: Partial<Vehicle> | null, otrasOrdenes: Partial<Order>[] = []) {
  const db = { order: order ? { ...order } : null, vehicle: vehicle ? { ...vehicle } : null };
  const matches = (row: any, where: Record<string, any>) => row && Object.entries(where).every(([k, v]) =>
    v instanceof FindOperator ? (v.type === 'isNull' ? row[k] == null : false) : row[k] === v);

  const manager = {
    update: jest.fn(async (entity: any, where: Record<string, any>, values: Record<string, any>) => {
      const row = entity === Order ? db.order : db.vehicle;
      if (!matches(row, where)) return { affected: 0 };
      Object.assign(row, values);
      return { affected: 1 };
    }),
  };
  const transaction = jest.fn(async (fn: (m: typeof manager) => Promise<void>) => fn(manager));
  const orders = {
    findOne: jest.fn(async () => (db.order ? { ...db.order } : null)),
    // busyVehicleIds: ordenes CONFIRMED sin devolver (la propia + otrasOrdenes)
    find: jest.fn(async () => [...(db.order && !db.order.returned_at ? [db.order] : []), ...otrasOrdenes]),
    manager: { transaction },
  };
  const vehicles = { findOne: jest.fn(async () => (db.vehicle ? { ...db.vehicle } : null)) };
  const none = {} as any;
  const service = new AutosService(
    { dispatch: jest.fn() } as any, vehicles as any, none, none, none, none, none, orders as any, none,
  );
  return { service, db, manager, transaction };
}

const confirmed = (): Partial<Order> => ({
  order_id: '11111111-1111-4111-8111-111111111111', locator: 'RENTAFACIL-TEST01', status: 'CONFIRMED',
  vehicle_id: 'VEH-1001', owner_sub: 'maria@example.com', vehicle_details: {}, route_details: {},
  total_price: 100, currency: 'USD', creation_date: new Date(), returned_at: null, returned_by_sub: null,
});
const reserved = (): Partial<Vehicle> => ({ vehicle_id: 'VEH-1001', status: 'RESERVED', wash_until: null });

describe('AutosService.returnOrder', () => {
  it('mantiene la orden CONFIRMED, guarda returned_at/returned_by_sub y deja el vehiculo en WASHING 2 h (cooldown Reto 2)', async () => {
    const { service, db } = buildService(confirmed(), reserved());
    const antes = Date.now();
    const r = await service.returnOrder(confirmed().order_id!, ADMIN);

    expect(db.order!.status).toBe('CONFIRMED');
    expect(db.order!.returned_by_sub).toBe(ADMIN.sub);
    expect(db.order!.returned_at!.getTime()).toBeGreaterThanOrEqual(antes);
    expect(db.vehicle!.status).toBe('WASHING');
    const lavado = db.vehicle!.wash_until!.getTime() - db.order!.returned_at!.getTime();
    expect(lavado).toBe(2 * HORA);

    expect(r.order).toMatchObject({ status: 'CONFIRMED', returned_by_sub: ADMIN.sub, locator: 'RENTAFACIL-TEST01' });
    expect(r.order.returned_at).toBe(db.order!.returned_at!.toISOString());
    expect(r.vehicle).toEqual({ vehicle_id: 'VEH-1001', status: 'WASHING', wash_until: db.vehicle!.wash_until!.toISOString() });
  });

  it('es idempotente: si ya tiene returned_at responde el estado actual sin escribir', async () => {
    const devuelta = { ...confirmed(), returned_at: new Date(Date.now() - HORA), returned_by_sub: 'otro-admin' };
    const washUntil = new Date(Date.now() + HORA);
    const { service, db, transaction } = buildService(devuelta, { vehicle_id: 'VEH-1001', status: 'WASHING', wash_until: washUntil });

    const r = await service.returnOrder(devuelta.order_id!, ADMIN);
    expect(transaction).not.toHaveBeenCalled();
    expect(db.order!.returned_by_sub).toBe('otro-admin');
    expect(r.order.returned_at).toBe(devuelta.returned_at.toISOString());
    expect(r.vehicle).toEqual({ vehicle_id: 'VEH-1001', status: 'WASHING', wash_until: washUntil.toISOString() });
  });

  it('dos llamadas seguidas devuelven lo mismo', async () => {
    const { service } = buildService(confirmed(), reserved());
    const a = await service.returnOrder(confirmed().order_id!, ADMIN);
    const b = await service.returnOrder(confirmed().order_id!, { sub: 'otro-admin', scopes: ADMIN.scopes });
    expect(b).toEqual(a);
  });

  it('si otra orden activa ya reservo el vehiculo, registra la devolucion sin pasarlo a WASHING', async () => {
    const otra = { order_id: '22222222-2222-4222-8222-222222222222', vehicle_id: 'VEH-1001',
      route_details: { dropoff: { datetime: new Date(Date.now() + 72 * HORA).toISOString() } } };
    const { service, db } = buildService(confirmed(), reserved(), [otra]);
    const r = await service.returnOrder(confirmed().order_id!, ADMIN);
    expect(db.order!.returned_at).toBeInstanceOf(Date);
    expect(db.vehicle).toMatchObject({ status: 'RESERVED', wash_until: null });
    expect(r.vehicle.status).toBe('RESERVED');
  });

  it('404 si la orden no existe', async () => {
    const { service } = buildService(null, reserved());
    await expect(service.returnOrder('x', ADMIN)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('409 si la orden no esta CONFIRMED', async () => {
    const { service, transaction } = buildService({ ...confirmed(), status: 'CANCELLED' }, reserved());
    const err = await service.returnOrder('x', ADMIN).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ status: 409, code: 'BOOKING_NOT_CONFIRMED' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('404 si el vehiculo de la orden no existe', async () => {
    const { service, transaction } = buildService(confirmed(), null);
    await expect(service.returnOrder('x', ADMIN)).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('vehicleAvailableFor (regla de disponibilidad de /search, /orders/hold y /orders/create)', () => {
  const ahora = Date.now();
  const washing = { status: 'WASHING', wash_until: new Date(ahora + 24 * HORA) };

  it('AVAILABLE siempre esta disponible', () => {
    expect(vehicleAvailableFor({ status: 'AVAILABLE', wash_until: null }, new Date(ahora))).toBe(true);
  });
  it('WASHING excluido si pickup < wash_until', () => {
    expect(vehicleAvailableFor(washing, new Date(ahora + 12 * HORA))).toBe(false);
  });
  it('WASHING incluido si pickup >= wash_until', () => {
    expect(vehicleAvailableFor(washing, washing.wash_until)).toBe(true);
    expect(vehicleAvailableFor(washing, new Date(ahora + 48 * HORA))).toBe(true);
  });
  it('RESERVED (rentado), MAINTENANCE e INACTIVE nunca', () => {
    for (const status of ['RESERVED', 'MAINTENANCE', 'INACTIVE']) {
      expect(vehicleAvailableFor({ status, wash_until: null }, new Date(ahora + 48 * HORA))).toBe(false);
    }
  });
});

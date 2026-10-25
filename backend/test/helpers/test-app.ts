import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { Depot } from '../../src/modules/autos/entities/depot.entity';
import { Supplier } from '../../src/modules/autos/entities/supplier.entity';
import { Vehicle } from '../../src/modules/autos/entities/vehicle.entity';

/**
 * Las pruebas que tocan la base de datos usan TEST_DATABASE_URL (una BD desechable:
 * TypeORM synchronize crea las tablas; ver test/setup-env.ts). Sin esa variable se omiten.
 */
export const TEST_DB = process.env.TEST_DATABASE_URL;
export const describeDb = TEST_DB ? describe : describe.skip;

export const HORA = 60 * 60 * 1000;

export interface TestApp {
  app: INestApplication;
  ds: DataSource;
  adminToken: string;
  clientToken: string;
  /** Rol MANTENIMIENTO del contrato v2 (role mechanic en la tabla users). */
  mechanicToken: string;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  configureApp(app);
  await app.init();

  const jwt = app.get(JwtService);
  const adminToken = jwt.sign({
    sub: 'admin-e2e@rentafacil.ec', role: 'admin',
    scopes: ['autos:read', 'autos:book', 'autos:cancel', 'autos:webhooks'],
  });
  const clientToken = jwt.sign({
    sub: 'cliente-e2e@rentafacil.ec', role: 'client',
    scopes: ['autos:read', 'autos:book', 'autos:cancel'],
  });
  const mechanicToken = jwt.sign({ sub: 'tecnico-e2e@rentafacil.ec', role: 'mechanic', scopes: ['autos:read'] });
  return { app, ds: app.get(DataSource), adminToken, clientToken, mechanicToken, close: () => app.close() };
}

/**
 * Agencia con un codigo de aeropuerto unico por ejecucion: las busquedas filtradas por ese
 * aeropuerto solo ven los vehiculos de la prueba, aunque la BD tenga otros datos.
 */
export async function createFixtures(ds: DataSource, overrides: Partial<Vehicle> = {}, city = 'Quito') {
  const tag = randomUUID().slice(0, 5).toUpperCase();
  const airport = `T${tag}`;
  const supplier = await ds.getRepository(Supplier).save({ name: `Proveedor test ${tag}` });
  const depot = await ds.getRepository(Depot).save({ name: `Agencia test ${tag}`, city, airport });
  const vehicle = await ds.getRepository(Vehicle).save(ds.getRepository(Vehicle).create({
    vehicle_id: `VEH-T${tag}`, make: 'Toyota', model: 'Yaris', year: 2024, plate: `T${tag}`.slice(0, 8),
    price_per_day: 40, status: 'AVAILABLE', depot_id: depot.depot_id, supplier_id: supplier.supplier_id,
    ...overrides,
  }));
  return { airport, supplier, depot, vehicle };
}

export async function dropFixtures(ds: DataSource, f: Awaited<ReturnType<typeof createFixtures>>) {
  await ds.query('DELETE FROM orders WHERE vehicle_id = $1', [f.vehicle.vehicle_id]);
  await ds.query('DELETE FROM order_previews WHERE vehicle_id = $1', [f.vehicle.vehicle_id]);
  await ds.query('DELETE FROM holds WHERE vehicle_id = $1', [f.vehicle.vehicle_id]);
  await ds.query("DELETE FROM outbox_events WHERE subject = $1 OR data->>'auto_id' = $1", [f.vehicle.vehicle_id]);
  await ds.query('DELETE FROM mantenimiento_log WHERE vehicle_id = $1', [f.vehicle.vehicle_id]);
  await ds.getRepository(Vehicle).delete({ vehicle_id: f.vehicle.vehicle_id });
  await ds.getRepository(Depot).delete({ depot_id: f.depot.depot_id });
  await ds.getRepository(Supplier).delete({ supplier_id: f.supplier.supplier_id });
}

/** Cuerpo de POST /search: alquiler de `dias` dias que empieza en `pickup`, en el aeropuerto dado. */
export function searchBody(airport: string, pickup: Date, dias = 3) {
  const dropoff = new Date(pickup.getTime() + dias * 24 * HORA);
  return {
    booker: { country: 'ec' }, currency: 'USD', driver: { age: 30 },
    route: {
      pickup: { datetime: pickup.toISOString(), location: { airport } },
      dropoff: { datetime: dropoff.toISOString(), location: { airport } },
    },
  };
}

/** Ciudad unica por ejecucion: POST /api/v2/autos/search con pickup_location = esa ciudad solo ve la fixture. */
export const ciudadUnica = () => `Ciudadtest${randomUUID().replace(/[^a-z]/g, '').slice(0, 6)}`;

/** YYYY-MM-DD en hora de Ecuador (UTC-5), dias desde hoy. */
export function fechaEc(dias: number): string {
  return new Date(Date.now() - 5 * HORA + dias * 24 * HORA).toISOString().slice(0, 10);
}

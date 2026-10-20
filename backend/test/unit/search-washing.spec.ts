import { AutosService } from '../../src/modules/autos/autos.service';
import { Vehicle } from '../../src/modules/autos/entities/vehicle.entity';
import {
  createFixtures, createTestApp, describeDb, dropFixtures, HORA, searchBody, TestApp,
} from '../helpers/test-app';

/**
 * AutosService.search sin HTTP. La regla de WASHING vive en el SQL de la busqueda,
 * asi que estas pruebas usan la BD de pruebas (TEST_DATABASE_URL).
 */
describeDb('AutosService.search con vehiculos en lavado (WASHING)', () => {
  let t: TestApp;
  let service: AutosService;
  let f: Awaited<ReturnType<typeof createFixtures>>;
  const washUntil = new Date(Date.now() + 24 * HORA);

  beforeAll(async () => {
    t = await createTestApp();
    service = t.app.get(AutosService);
    f = await createFixtures(t.ds, { status: 'WASHING', wash_until: washUntil });
  });
  afterAll(async () => {
    await dropFixtures(t.ds, f);
    await t.close();
  });

  const ids = async (pickup: Date) =>
    (await service.search(searchBody(f.airport, pickup) as any)).data.map((d) => d.vehicle_id);

  it('excluye el vehiculo WASHING cuando pickup < wash_until', async () => {
    expect(await ids(new Date(washUntil.getTime() - HORA))).not.toContain(f.vehicle.vehicle_id);
  });

  it('incluye el vehiculo WASHING cuando pickup >= wash_until', async () => {
    expect(await ids(washUntil)).toContain(f.vehicle.vehicle_id);
    expect(await ids(new Date(washUntil.getTime() + 24 * HORA))).toContain(f.vehicle.vehicle_id);
  });

  it('auto-sana: con wash_until vencido el vehiculo vuelve a AVAILABLE en la siguiente busqueda', async () => {
    const repo = t.ds.getRepository(Vehicle);
    await repo.update({ vehicle_id: f.vehicle.vehicle_id }, { wash_until: new Date(Date.now() - 1000) });

    expect(await ids(new Date(Date.now() + HORA))).toContain(f.vehicle.vehicle_id);
    const v = await repo.findOneByOrFail({ vehicle_id: f.vehicle.vehicle_id });
    expect(v.status).toBe('AVAILABLE');
    expect(v.wash_until).toBeNull();
  });
});

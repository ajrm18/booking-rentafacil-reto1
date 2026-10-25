import request from 'supertest';
import { randomUUID } from 'crypto';
import { Order } from '../../src/modules/autos/entities/order.entity';
import { Vehicle } from '../../src/modules/autos/entities/vehicle.entity';
import {
  createFixtures, createTestApp, describeDb, dropFixtures, HORA, searchBody, TestApp,
} from '../helpers/test-app';

/**
 * Flujo completo por HTTP: hold -> preview -> create -> devolucion (admin) -> lavado -> disponible.
 */
describeDb('POST /api/v1/admin/orders/:id/return (e2e)', () => {
  let t: TestApp;
  let f: Awaited<ReturnType<typeof createFixtures>>;
  let http: ReturnType<typeof request>;
  let orderId: string;
  let primerRetorno: any;

  const admin = () => ({ Authorization: `Bearer ${t.adminToken}` });
  const cliente = () => ({ Authorization: `Bearer ${t.clientToken}` });
  const buscar = async (pickup: Date) => {
    const r = await http.post('/api/v1/search').set('X-Affiliate-Id', '1').send(searchBody(f.airport, pickup));
    expect(r.status).toBe(200);
    return r.body as { data: { vehicle_id: string }[]; search_token: string };
  };
  const ids = async (pickup: Date) => (await buscar(pickup)).data.map((d) => d.vehicle_id);
  const vehiculo = () => t.ds.getRepository(Vehicle).findOneByOrFail({ vehicle_id: f.vehicle.vehicle_id });

  beforeAll(async () => {
    t = await createTestApp();
    http = request(t.app.getHttpServer());
    f = await createFixtures(t.ds);
  });
  afterAll(async () => {
    await dropFixtures(t.ds, f);
    await t.close();
  });

  it('hold -> preview -> create deja el vehiculo RESERVED', async () => {
    const pickup = new Date(Date.now() + 2 * 24 * HORA);
    const s = await buscar(pickup);
    expect(s.data.map((d) => d.vehicle_id)).toContain(f.vehicle.vehicle_id);

    const hold = await http.post('/api/v1/orders/hold').set(cliente())
      .send({ vehicle_id: f.vehicle.vehicle_id, search_token: s.search_token, driver: { age: 30 } });
    expect([200, 201]).toContain(hold.status);

    const preview = await http.post('/api/v1/orders/preview').set(cliente())
      .send({ vehicle_id: f.vehicle.vehicle_id, search_token: s.search_token, hold_id: hold.body.hold_id });
    expect([200, 201]).toContain(preview.status);

    const create = await http.post('/api/v1/orders/create').set(cliente()).set('Idempotency-Key', randomUUID())
      .send({
        order_preview_id: preview.body.data.order_preview_id,
        payment_reference: `PAY-TEST-${Date.now()}`,
        driver_details: { first_name: 'Ana', last_name: 'Torres', email: 'ana@example.com', phone_number: '+593 99 000 0000' },
      });
    expect([200, 201]).toContain(create.status);
    orderId = (create.body.data ?? create.body).order_id;
    expect((await vehiculo()).status).toBe('RESERVED');
    expect(await ids(pickup)).not.toContain(f.vehicle.vehicle_id);
  });

  it('un cliente (sin scope de admin) recibe 403', async () => {
    const r = await http.post(`/api/v1/admin/orders/${orderId}/return`).set(cliente());
    expect(r.status).toBe(403);
    expect(r.headers['content-type']).toContain('application/problem+json');
  });

  it('el admin registra la devolucion: orden CONFIRMED con returned_at y vehiculo WASHING 2 h', async () => {
    const antes = Date.now();
    const r = await http.post(`/api/v1/admin/orders/${orderId}/return`).set(admin());
    expect(r.status).toBe(200);
    expect(r.body.order).toMatchObject({ order_id: orderId, status: 'CONFIRMED', returned_by_sub: 'admin-e2e@rentafacil.ec' });
    const returnedAt = Date.parse(r.body.order.returned_at);
    expect(returnedAt).toBeGreaterThanOrEqual(antes - 1000);
    expect(r.body.vehicle).toMatchObject({ vehicle_id: f.vehicle.vehicle_id, status: 'WASHING' });
    expect(Date.parse(r.body.vehicle.wash_until) - returnedAt).toBe(2 * HORA);
    primerRetorno = r.body;

    const enBd = await t.ds.getRepository(Order).findOneByOrFail({ order_id: orderId });
    expect(enBd.status).toBe('CONFIRMED');
    expect(enBd.returned_at).not.toBeNull();
  });

  it('idempotencia: un segundo POST devuelve lo mismo sin tocar nada', async () => {
    const r = await http.post(`/api/v1/admin/orders/${orderId}/return`).set(admin());
    expect(r.status).toBe(200);
    expect(r.body).toEqual(primerRetorno);
  });

  it('/search antes de wash_until no lo muestra; despues si', async () => {
    const washUntil = Date.parse(primerRetorno.vehicle.wash_until);
    expect(await ids(new Date(washUntil - 2 * HORA))).not.toContain(f.vehicle.vehicle_id);
    expect(await ids(new Date(washUntil + HORA))).toContain(f.vehicle.vehicle_id);
  });

  it('se puede reservar (hold) para despues del lavado, pero no durante', async () => {
    const washUntil = Date.parse(primerRetorno.vehicle.wash_until);
    const durante = await buscar(new Date(washUntil - 2 * HORA));
    const holdDurante = await http.post('/api/v1/orders/hold').set(cliente())
      .send({ vehicle_id: f.vehicle.vehicle_id, search_token: durante.search_token, driver: { age: 30 } });
    expect(holdDurante.status).toBe(409);

    const despues = await buscar(new Date(washUntil + HORA));
    const holdDespues = await http.post('/api/v1/orders/hold').set(cliente())
      .send({ vehicle_id: f.vehicle.vehicle_id, search_token: despues.search_token, driver: { age: 30 } });
    expect([200, 201]).toContain(holdDespues.status);
  });

  it('al vencer wash_until, /details auto-sana el vehiculo a AVAILABLE', async () => {
    await t.ds.getRepository(Vehicle).update({ vehicle_id: f.vehicle.vehicle_id }, { wash_until: new Date(Date.now() - 1000) });
    const r = await http.post('/api/v1/details').set('X-Affiliate-Id', '1').send({ vehicle_ids: [f.vehicle.vehicle_id] });
    expect(r.status).toBe(200);
    const v = await vehiculo();
    expect(v.status).toBe('AVAILABLE');
    expect(v.wash_until).toBeNull();
  });

  it('404 Problem Details si la orden no existe', async () => {
    const r = await http.post(`/api/v1/admin/orders/${randomUUID()}/return`).set(admin());
    expect(r.status).toBe(404);
    expect(r.headers['content-type']).toContain('application/problem+json');
  });

  it('409 Problem Details si la orden no esta CONFIRMED', async () => {
    const o = await http.post('/api/v1/admin/orders').set(admin())
      .send({ vehicle_id: f.vehicle.vehicle_id, total_price: 10, status: 'CANCELLED' });
    expect(o.status).toBe(201);
    const r = await http.post(`/api/v1/admin/orders/${o.body.order_id}/return`).set(admin());
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ status: 409, code: 'BOOKING_NOT_CONFIRMED' });
  });

  it('404 si el vehiculo de la orden no existe', async () => {
    const o = await http.post('/api/v1/admin/orders').set(admin())
      .send({ vehicle_id: f.vehicle.vehicle_id, total_price: 10 });
    await t.ds.getRepository(Order).update({ order_id: o.body.order_id }, { vehicle_id: 'VEH-NO-EXISTE' });
    const r = await http.post(`/api/v1/admin/orders/${o.body.order_id}/return`).set(admin());
    expect(r.status).toBe(404);
    await t.ds.getRepository(Order).delete({ order_id: o.body.order_id });
  });
});

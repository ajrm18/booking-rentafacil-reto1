import request from 'supertest';
import { randomUUID } from 'crypto';
import { Vehicle } from '../../src/modules/autos/entities/vehicle.entity';
import { Order } from '../../src/modules/autos/entities/order.entity';
import { OutboxEvent } from '../../src/modules/integracion/entities/outbox-event.entity';
import { OutboxService } from '../../src/modules/integracion/outbox.service';
import {
  ciudadUnica, createFixtures, createTestApp, describeDb, dropFixtures, fechaEc, HORA, searchBody, TestApp,
} from '../helpers/test-app';

/**
 * Flujo completo del contrato v2 por HTTP:
 * search -> hold -> preview (v1, coexistencia) -> create con Idempotency-Key -> check-in digital
 * -> check-in entrega -> check-in devolucion -> cooldown 2 h -> fin del cooldown.
 */
describeDb('Flujo completo /api/v2 (e2e)', () => {
  let t: TestApp;
  let http: ReturnType<typeof request>;
  let f: Awaited<ReturnType<typeof createFixtures>>;
  const ciudad = ciudadUnica();
  const id = () => f.vehicle.vehicle_id;
  let pnr: string;
  let orderId: string;
  let devolucion: any;
  const claveDevolucion = randomUUID();

  const as = (token: string) => ({ Authorization: `Bearer ${token}`, 'X-Correlation-Id': 'corr-e2e-v2' });
  const cliente = () => as(t.clientToken);
  const tecnico = () => as(t.mechanicToken);
  const admin = () => as(t.adminToken);
  const busqueda = (extra: Record<string, any> = {}) => ({
    pickup_location: ciudad, pickup_date: fechaEc(3), pickup_time: '10:00', dropoff_date: fechaEc(6), dropoff_time: '10:00',
    driver_age: 32, ...extra,
  });
  const idsBusqueda = async () => {
    const r = await http.post('/api/v2/autos/search').send(busqueda());
    expect(r.status).toBe(200);
    return r.body.data.map((d: any) => d.vehicle_id);
  };
  const vehiculo = () => t.ds.getRepository(Vehicle).findOneByOrFail({ vehicle_id: id() });
  const eventos = (rk: string) => t.ds.getRepository(OutboxEvent).find({ where: { routing_key: rk, subject: id() } });
  const pedido = () => ({
    vehicle_id: id(), pickup_date: fechaEc(3), dropoff_date: fechaEc(6), hora_recogida: '10:00', hora_devolucion: '10:00',
    tipo_cobertura: 'TOTAL', pickup_location: ciudad,
    conductor: { nombre: 'Carlos Zambrano', email: 'carlos.zambrano@example.com', telefono: '+593987654321', licencia_conducir: '1723456789', edad: 32 },
  });

  beforeAll(async () => {
    t = await createTestApp();
    http = request(t.app.getHttpServer());
    f = await createFixtures(t.ds, { price_per_day: 35.5, kilometraje_actual: 12000, proximo_mantenimiento_km: 12900 }, ciudad);
  });
  afterAll(async () => {
    await dropFixtures(t.ds, f);
    await t.close();
  });

  it('GET /health responde HEALTHY con la identidad exacta del proveedor', async () => {
    const t0 = Date.now();
    const r = await http.get('/api/v2/autos/health');
    expect(Date.now() - t0).toBeLessThan(500);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      status: 'HEALTHY', nodo_id: 'NODE_AUT_RENTAFACIL', nombre_proveedor: 'RentaFacil EC', vertical: 'AUTOS', version: '2.0.0',
    });
    expect(r.headers['x-correlation-id']).toBeTruthy();
  });

  it('/api/v1 sigue vivo junto al v2', async () => {
    const r = await http.post('/api/v1/search').set('X-Affiliate-Id', '1').send(searchBody(f.airport, new Date(Date.now() + 3 * 24 * HORA)));
    expect(r.status).toBe(200);
    expect(r.body.data.map((d: any) => d.vehicle_id)).toContain(id());
  });

  it('POST /search: franjas de 30 min estrictas, 422 menor de 18, recargo joven', async () => {
    expect(await idsBusqueda()).toContain(id());

    const franja = await http.post('/api/v2/autos/search').send(busqueda({ pickup_time: '10:15' }));
    expect(franja.status).toBe(400);
    expect(franja.headers['content-type']).toContain('application/problem+json');
    expect(franja.body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', instance: '/api/v2/autos/search' });
    expect(franja.body.invalid_params[0].name).toBe('pickup_time');

    const menor = await http.post('/api/v2/autos/search').set('X-Correlation-Id', 'corr-menor').send(busqueda({ driver_age: 17 }));
    expect(menor.status).toBe(422);
    expect(menor.body).toMatchObject({ code: 'DRIVER_AGE_RESTRICTION', correlation_id: 'corr-menor' });
    expect(Date.parse(menor.body.timestamp)).not.toBeNaN();

    const joven = await http.post('/api/v2/autos/search').send(busqueda({ driver_age: 22 }));
    expect(joven.status).toBe(200);
    expect(joven.body.metadata).toMatchObject({ surcharge_applied: true, surcharge_amount: 30 });
    const card = joven.body.data.find((d: any) => d.vehicle_id === id());
    expect(card).toMatchObject({ estado: 'DISPONIBLE', precio_diario: 35.5, precio_total: 136.5, moneda: 'USD' });
  });

  it('hold -> preview del v1 sobre el mismo inventario (coexistencia v1/v2)', async () => {
    const s = await http.post('/api/v1/search').set('X-Affiliate-Id', '1').send(searchBody(f.airport, new Date(Date.now() + 3 * 24 * HORA)));
    const hold = await http.post('/api/v1/orders/hold').set(cliente()).send({ vehicle_id: id(), search_token: s.body.search_token, driver: { age: 32 } });
    expect(hold.status).toBe(200);
    const preview = await http.post('/api/v1/orders/preview').set(cliente()).send({ vehicle_id: id(), search_token: s.body.search_token, hold_id: hold.body.hold_id });
    expect(preview.status).toBe(200);
  });

  it('GET /{id}/coberturas: BASICA $0 vs TOTAL $18/dia', async () => {
    const r = await http.get(`/api/v2/autos/${id()}/coberturas`);
    expect(r.status).toBe(200);
    const [basica, total] = r.body.opciones;
    expect(basica).toMatchObject({ tipo: 'BASICA', costo_adicional_diario: 0 });
    expect(total).toMatchObject({ tipo: 'TOTAL', costo_adicional_diario: 18, franquicia: 0, deposito_garantia: 0 });
  });

  it('POST /orders/create exige JWT e Idempotency-Key UUID v4', async () => {
    expect((await http.post('/api/v2/autos/orders/create').send(pedido())).status).toBe(401);
    const sinClave = await http.post('/api/v2/autos/orders/create').set(cliente()).send(pedido());
    expect(sinClave.status).toBe(400);
    expect(sinClave.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const v1 = await http.post('/api/v2/autos/orders/create').set(cliente()).set('Idempotency-Key', '9b1deb4d-3b7d-1bad-9bdd-2b0d7b3dcb6d').send(pedido());
    expect(v1.status).toBe(400);
  });

  it('POST /orders/create -> 201 CONFIRMED, PNR de 8, TOTAL = 3 x 35.50 + 3 x 18; idempotente', async () => {
    const clave = randomUUID();
    const r = await http.post('/api/v2/autos/orders/create').set(cliente()).set('Idempotency-Key', clave).send(pedido());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'CONFIRMED', auto_id: id(), tipo_cobertura: 'TOTAL', deposito_garantia: 0, moneda: 'USD' });
    expect(r.body.total_price.total).toBe(160.5);
    expect(r.body.pnr).toMatch(/^[A-Z0-9]{8}$/);
    expect(r.body.voucher_qr_data).toContain(r.body.pnr);
    pnr = r.body.pnr; orderId = r.body.order_id;

    const otra = await http.post('/api/v2/autos/orders/create').set(cliente()).set('Idempotency-Key', clave).send(pedido());
    expect(otra.status).toBe(201);
    expect(otra.body.order_id).toBe(orderId);
    expect(await t.ds.getRepository(Order).count({ where: { vehicle_id: id() } })).toBe(1);

    expect((await vehiculo()).status).toBe('RESERVED');
    expect(await idsBusqueda()).not.toContain(id());
    expect(await t.ds.getRepository(OutboxEvent).count({ where: { routing_key: 'auto.order.confirmed', subject: orderId } })).toBe(1);
  });

  it('GET /orders/{PNR} y /orders (cliente ve solo las suyas); /api/v1/orders/{uuid} sigue respondiendo', async () => {
    const r = await http.get(`/api/v2/autos/orders/${pnr}`).set(cliente());
    expect(r.status).toBe(200);
    expect(r.body.order_id).toBe(orderId);
    const lista = await http.get('/api/v2/autos/orders').set(cliente());
    expect(lista.body.every((o: any) => o.propietario === 'cliente-e2e@rentafacil.ec')).toBe(true);
    const v1 = await http.get(`/api/v1/orders/${orderId}`).set(cliente());
    expect(v1.status).toBe(200);
    expect(v1.body.status).toBe('CONFIRMED');
  });

  it('check-in digital -> LISTO_PARA_ENTREGAR con voucher QR fast-track', async () => {
    const r = await http.post(`/api/v2/autos/reservas/${pnr}/checkin`).set(cliente()).set('Idempotency-Key', randomUUID())
      .send({ numero_licencia: '1723456789', documento_identidad: '1723456789', fecha_vencimiento_licencia: '2030-12-31' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ checkin_status: 'CHECKIN_COMPLETED', fast_track_pickup: true, estado_vehiculo: 'LISTO_PARA_ENTREGAR' });
    expect(r.body.voucher_qr_data).toBe(`AUTOS-CHECKIN-${pnr}-VERIFIED-1723456789`);
    expect((await vehiculo()).status).toBe('READY_FOR_PICKUP');
  });

  it('check-in entrega: CLIENTE 403, licencia distinta 400, agente -> ENTREGADO con km_salida', async () => {
    const body = { licencia_conducir: '1723456789', km_salida: 12500, tecnico_entrega: 'Roberto Paredes (Agente Mostrador UIO)' };
    const r403 = await http.post(`/api/v2/autos/orders/${pnr}/checkin-entrega`).set(cliente()).set('Idempotency-Key', randomUUID()).send(body);
    expect(r403.status).toBe(403);
    const r400 = await http.post(`/api/v2/autos/orders/${pnr}/checkin-entrega`).set(tecnico()).set('Idempotency-Key', randomUUID())
      .send({ ...body, licencia_conducir: '0000000000' });
    expect(r400.status).toBe(400);
    expect(r400.body.code).toBe('LICENSE_MISMATCH');

    const r = await http.post(`/api/v2/autos/orders/${pnr}/checkin-entrega`).set(tecnico()).set('Idempotency-Key', randomUUID()).send(body);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, estado_orden: 'ENTREGADO', km_salida: 12500, licencia_verificada: '1723456789' });
    const v = await vehiculo();
    expect(v.status).toBe('DELIVERED');
    expect(v.kilometraje_actual).toBe(12500);
  });

  it('un auto ENTREGADO no se puede cancelar', async () => {
    const r = await http.post(`/api/v2/autos/orders/${pnr}/cancel`).set(cliente()).set('Idempotency-Key', randomUUID()).send({});
    expect(r.status).toBe(409);
  });

  it('check-in devolucion: km_retorno < km_salida -> 400', async () => {
    const r = await http.post(`/api/v2/autos/orders/${pnr}/checkin-devolucion`).set(tecnico()).set('Idempotency-Key', randomUUID())
      .send({ km_retorno: 12000 });
    expect(r.status).toBe(400);
    expect(r.body.invalid_params[0].name).toBe('km_retorno');
  });

  it('check-in devolucion -> COMPLETADA, km_recorridos, EN_LIMPIEZA 2 h exactas y alerta de mantenimiento', async () => {
    const r = await http.post(`/api/v2/autos/orders/${pnr}/checkin-devolucion`).set(tecnico()).set('Idempotency-Key', claveDevolucion)
      .send({ km_retorno: 12950, nivel_combustible: 100, observaciones: 'Inspección conforme.' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, estado_orden: 'COMPLETADA', km_retorno: 12950, km_recorridos: 450, mantenimiento_requerido: true });
    expect(r.body.cooldown).toMatchObject({ estado: 'EN_LIMPIEZA', cooldown_horas: 2, cooldown_minutos: 120 });
    expect(Date.parse(r.body.cooldown.disponible_desde) - Date.parse(r.body.checkin_devolucion_at)).toBe(2 * HORA);
    expect(r.body.alerta_mantenimiento).toContain('ALERTA PREVENTIVA');
    devolucion = r.body;

    const v = await vehiculo();
    expect(v.status).toBe('WASHING');
    expect(v.kilometraje_actual).toBe(12950);
    expect(await eventos('auto.cooldown.started')).toHaveLength(1);
    expect(await eventos('auto.mantenimiento.alerta')).toHaveLength(1);
  });

  it('IDEMPOTENTE: el mismo Idempotency-Key devuelve lo mismo; otra clave -> 409', async () => {
    const r = await http.post(`/api/v2/autos/orders/${pnr}/checkin-devolucion`).set(tecnico()).set('Idempotency-Key', claveDevolucion)
      .send({ km_retorno: 12950, nivel_combustible: 100 });
    expect(r.status).toBe(200);
    expect(r.body).toEqual(devolucion);
    expect(await eventos('auto.cooldown.started')).toHaveLength(1);

    const otra = await http.post(`/api/v2/autos/orders/${pnr}/checkin-devolucion`).set(tecnico()).set('Idempotency-Key', randomUUID())
      .send({ km_retorno: 13000 });
    expect(otra.status).toBe(409);
    expect(otra.body.code).toBe('ORDER_ALREADY_RETURNED');
  });

  it('EN_LIMPIEZA: invisible en /search y /{id}, y reservarlo -> 409 VEHICLE_IN_CLEANING_COOLDOWN', async () => {
    expect(await idsBusqueda()).not.toContain(id());
    expect((await http.get(`/api/v2/autos/${id()}`)).status).toBe(404);
    const r = await http.post('/api/v2/autos/orders/create').set(cliente()).set('Idempotency-Key', randomUUID()).send(pedido());
    expect(r.status).toBe(409);
    expect(r.headers['content-type']).toContain('application/problem+json');
    expect(r.body).toMatchObject({
      status: 409, code: 'VEHICLE_IN_CLEANING_COOLDOWN', instance: '/api/v2/autos/orders/create', correlation_id: 'corr-e2e-v2',
    });
    expect(r.body.detail).toContain('UTC');
  });

  it('GET /flota muestra el cronometro y /health cuenta el cooldown activo', async () => {
    const flota = await http.get('/api/v2/autos/flota');
    const item = flota.body.find((x: any) => x.id === id());
    expect(item).toMatchObject({ estado_operativo: 'EN_LIMPIEZA', cooldown_activo: true, alerta_mantenimiento: true, kilometraje_actual: 12950 });
    expect(item.segundos_restantes_cooldown).toBeGreaterThan(7100);
    expect(item.segundos_restantes_cooldown).toBeLessThanOrEqual(7200);
    const h = await http.get('/api/v2/autos/health');
    expect(h.body.cooldown_activo_count).toBeGreaterThanOrEqual(1);
  });

  it('outbox: el worker publica (modo log sin RABBITMQ_URL) y GET /eventos sirve CloudEvents v1.0', async () => {
    await t.app.get(OutboxService).tick();
    const pendientes = await t.ds.getRepository(OutboxEvent).count({ where: { subject: id(), publish_status: 'PENDING' } });
    expect(pendientes).toBe(0);

    expect((await http.get('/api/v2/autos/eventos')).status).toBe(401);
    expect((await http.get('/api/v2/autos/eventos').set(cliente())).status).toBe(403);
    const r = await http.get('/api/v2/autos/eventos?limit=50').set(admin());
    expect(r.status).toBe(200);
    const ev = r.body.events.find((e: any) => e.type === 'ec.edu.epn.booking.autos.cooldown.started' && e.data.auto_id === id());
    expect(ev).toMatchObject({ specversion: '1.0', source: '/microservices/ms-autos', correlation_id: 'corr-e2e-v2', datacontenttype: 'application/json' });
    expect(ev.data).toMatchObject({ estado: 'EN_LIMPIEZA', cooldown_minutos: 120 });

    const despues = await http.get(`/api/v2/autos/eventos?after=${r.body.events[0].id}&limit=5`).set(admin());
    expect(despues.body.events.length).toBeGreaterThan(0);
  });

  it('al vencer las 2 h el worker emite auto.cooldown.ended; con mantenimiento pendiente pasa a EN_MANTENIMIENTO', async () => {
    await t.ds.getRepository(Vehicle).update({ vehicle_id: id() }, { wash_until: new Date(Date.now() - 1000) });
    await t.app.get(OutboxService).tick();
    const v = await vehiculo();
    expect(v.status).toBe('MAINTENANCE');
    expect(v.wash_until).toBeNull();
    expect(await eventos('auto.cooldown.ended')).toHaveLength(1);
  });

  it('mantenimiento: CLIENTE 403; tecnico registra el mantenimiento realizado -> DISPONIBLE', async () => {
    const body = { tecnico_id: 'tec-rosero-01', kilometraje_registrado: 12960, nivel_combustible: 100, mantenimiento_realizado: true };
    const r403 = await http.post(`/api/v2/autos/${id()}/mantenimiento/registro`).set(cliente()).set('Idempotency-Key', randomUUID()).send(body);
    expect(r403.status).toBe(403);
    const r = await http.post(`/api/v2/autos/${id()}/mantenimiento/registro`).set(tecnico()).set('Idempotency-Key', randomUUID())
      .set('X-Role', 'MANTENIMIENTO').send(body);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mantenimiento_requerido: false, proximo_mantenimiento_km: 22960, estado_operativo: 'DISPONIBLE' });
    expect(r.body.bitacora_id).toMatch(/^BIT-AUTO-/);
    expect(await idsBusqueda()).toContain(id());
  });
});

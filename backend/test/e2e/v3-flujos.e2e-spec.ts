import request from 'supertest';
import { randomUUID } from 'crypto';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { createServer } from 'net';
import { Vehicle } from '../../src/modules/autos/entities/vehicle.entity';
import { inventoryProtoPath, PROTO_LOADER_OPTIONS } from '../../src/modules/integracion/grpc/proto-path';
import { usarFetch } from '../../src/common/http-saliente';
import { captura, lineasCapturadas } from '../../src/common/app-logger';
import { createFixtures, createTestApp, describeDb, dropFixtures, fechaEc, TestApp } from '../helpers/test-app';

const puertoLibre = () => new Promise<number>((resolve, reject) => {
  const srv = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
    const { port } = srv.address() as { port: number };
    srv.close(() => resolve(port));
  });
});
const letras = () => Array.from({ length: 3 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
const LINEA_LOG = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[(INFO|WARN|ERROR)\] \[[A-Z-]+\] /;

/**
 * Los dos flujos que califica el ingeniero (contrato v3.0.0 + requerimiento v3.1):
 *  FLUJO 1: crear auto en el admin -> reserva desde el Booking -> el stock baja (BD + gRPC al Booking).
 *  FLUJO 2: cliente del Booking sin duplicarse -> reserva vinculada -> buscador -> check-in asistido
 *           -> notificacion HTTP al Booking central.
 */
describeDb('Reto 2 final /api/v3 (e2e)', () => {
  let t: TestApp;
  let f: Awaited<ReturnType<typeof createFixtures>>;
  let http: ReturnType<typeof request>;
  let grpcServer: grpc.Server;
  const pushes: any[] = [];
  const notificaciones: { url: string; headers: any; body: any }[] = [];
  let bookingStatus = 200;

  const placa = `${letras()}-${Math.floor(1000 + Math.random() * 8999)}`;
  const cedula = String(Math.floor(1e9 + Math.random() * 8e9));
  const email = `cliente.${cedula}@example.com`;
  const correlation = `booking-${randomUUID()}`;
  let vehicleId: string;
  let clientId: string;
  let pnr: string;
  let orderId: string;

  const admin = () => ({ Authorization: `Bearer ${t.adminToken}` });
  const pedido = (vid: string, extra: Record<string, any> = {}) => ({
    vehicle_id: vid, pickup_date: fechaEc(2), dropoff_date: fechaEc(5), pickup_time: '10:00', dropoff_time: '10:00',
    pickup_location: 'Aeropuerto Mariscal Sucre (UIO), Quito', coverage_type: 'BASIC',
    driver: { full_name: 'Juan Perez', email, phone: '+593987654321', license_number: cedula, country_license: 'Ecuador', age: 28 },
    ...extra,
  });

  beforeAll(async () => {
    // Mock del InventoryStockService del Booking central (gRPC :50051)
    const puerto = await puertoLibre();
    const pkg: any = grpc.loadPackageDefinition(protoLoader.loadSync(inventoryProtoPath(), PROTO_LOADER_OPTIONS)).inventory;
    grpcServer = new grpc.Server();
    grpcServer.addService(pkg.InventoryStockService.service, {
      PushStockUpdate: (call: any, cb: any) => { pushes.push(call.request); cb(null, { success: true, message: 'OK', processed_at: Date.now() }); },
      StreamInventoryChanges: (_c: any, cb: any) => cb(null, {}),
    });
    await new Promise<void>((res, rej) => grpcServer.bindAsync(`127.0.0.1:${puerto}`, grpc.ServerCredentials.createInsecure(), (e) => (e ? rej(e) : res())));
    process.env.BOOKING_GRPC_HOST = `127.0.0.1:${puerto}`;
    process.env.BOOKING_CHECKIN_URL = 'https://booking-core-api.test/api/v3/reservas';
    process.env.BOOKING_API_KEY = 'PENDIENTE_ME_LA_DARA_EL_PROFESOR';

    // Mock HTTP del Booking central para la notificacion de check-in
    usarFetch(async (url: any, init: any) => {
      notificaciones.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
      return new Response(JSON.stringify(bookingStatus === 200 ? { acknowledged: true, status: 'CONFIRMADO_ASISTIDO' } : { error: 'x' }), { status: bookingStatus });
    });
    captura(true);
    t = await createTestApp();
    http = request(t.app.getHttpServer());
    // Agencia y proveedor propios (la BD de pruebas puede estar vacia)
    f = await createFixtures(t.ds);
  });

  afterAll(async () => {
    captura(false);
    usarFetch((i, o) => fetch(i, o));
    if (orderId) {
      await t.ds.query('DELETE FROM db_outbox.outbox_booking_notifications WHERE order_id = $1', [orderId]);
      await t.ds.query('DELETE FROM db_counter.checkins WHERE order_id = $1', [orderId]);
    }
    if (vehicleId) {
      await t.ds.query('DELETE FROM db_orders.orders WHERE vehicle_id = $1', [vehicleId]);
      await t.ds.query("DELETE FROM db_outbox.outbox_events WHERE subject = $1 OR data->>'auto_id' = $1 OR subject = $2", [vehicleId, orderId ?? '']);
      await t.ds.query('DELETE FROM db_inventory.grpc_log WHERE item_id = $1', [vehicleId]);
      await t.ds.query('DELETE FROM db_catalog.vehicle_images WHERE vehicle_id = $1', [vehicleId]);
      await t.ds.query('DELETE FROM db_catalog.vehicles WHERE vehicle_id = $1', [vehicleId]);
    }
    await t.ds.query('DELETE FROM db_identity.clientes WHERE email = $1 OR identificacion = $2', [email, cedula]);
    await dropFixtures(t.ds, f);
    await t.close();
    grpcServer.forceShutdown();
    delete process.env.BOOKING_GRPC_HOST; delete process.env.BOOKING_CHECKIN_URL; delete process.env.BOOKING_API_KEY;
  });

  const esperar = async (cond: () => boolean | Promise<boolean>, ms = 3000) => {
    for (let i = 0; i < ms / 25; i++) { if (await cond()) return; await new Promise((r) => setTimeout(r, 25)); }
  };

  // ── Telemetria ──────────────────────────────────────────────────────────────

  it('GET /api/v3/autos/health y /api/v3/health: HEALTHY, nodo NODE_AUT_RENTAFACIL, version 3.0.0, < 500 ms', async () => {
    for (const ruta of ['/api/v3/autos/health', '/api/v3/health']) {
      const t0 = Date.now();
      const r = await http.get(ruta);
      expect(Date.now() - t0).toBeLessThan(500);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        status: 'HEALTHY', nodo_id: 'NODE_AUT_RENTAFACIL', nombre_proveedor: 'RentaFacil EC', vertical: 'AUTOS', version: '3.0.0',
        circuit_breaker_estado: 'CLOSED', dependencias: { base_datos: 'UP', booking_central: 'UP' },
      });
      for (const k of ['uptime_seconds', 'latencia_ms', 'total_vehiculos', 'cooldown_activo_count', 'outbox_pendientes']) expect(typeof r.body[k]).toBe('number');
      expect(r.headers['x-correlation-id']).toBeTruthy();
    }
  });

  // ── FLUJO 1: catalogo y stock en vivo ───────────────────────────────────────

  describe('FLUJO 1: crear auto -> reservar desde Booking -> stock baja en ambas plataformas', () => {
    it('POST /api/v3/admin/vehicles crea el auto con stock 1 y hace PushStockUpdate available=1 al Booking', async () => {
      const op = await http.get('/api/v3/admin/vehicles/opciones').set(admin());
      expect(op.status).toBe(200);
      expect(op.body.depots.some((d: any) => d.depot_id === f.depot.depot_id)).toBe(true);
      const r = await http.post('/api/v3/admin/vehicles').set(admin()).send({
        marca: 'Chevrolet', modelo: 'Onix', anio: 2025, placa, categoria: 'ECONOMICO', precio_diario: 40,
        depot_id: f.depot.depot_id, supplier_id: f.supplier.supplier_id,
      });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ marca: 'Chevrolet', modelo: 'Onix', estado: 'DISPONIBLE', stock: 1, available_units: 1 });
      vehicleId = r.body.vehicle_id;
      await esperar(() => pushes.some((p) => p.item_id === vehicleId && p.available_units === 1));
      expect(pushes.find((p) => p.item_id === vehicleId)).toMatchObject({ service_id: 'NODE_AUT_RENTAFACIL', available_units: 1 });
      expect((await http.get(`/api/v3/autos/${vehicleId}`)).body).toMatchObject({ stock: 1 });
    });

    it('solo ADMIN crea vehiculos (un cliente recibe 403)', async () => {
      const r = await http.post('/api/v3/admin/vehicles').set({ Authorization: `Bearer ${t.clientToken}` }).send({});
      expect(r.status).toBe(403);
    });
  });

  // ── FLUJO 2: cliente cross-platform + entrega fisica ────────────────────────

  describe('FLUJO 2: cliente del Booking sin duplicados -> reserva -> buscador -> check-in -> notificacion', () => {
    it('POST /api/v3/clientes crea -> 201 { client_id } con origen BOOKING', async () => {
      const r = await http.post('/api/v3/clientes').set('X-Correlation-Id', correlation)
        .send({ nombre: 'Juan Perez', email, identificacion: cedula, telefono: '+593987654321', licencia: cedula });
      expect(r.status).toBe(201);
      expect(Object.keys(r.body)).toEqual(['client_id']);
      clientId = r.body.client_id;
      const [fila] = await t.ds.query('SELECT origen FROM db_identity.clientes WHERE client_id = $1', [clientId]);
      expect(fila.origen).toBe('BOOKING');
    });

    it('POST con el mismo email (o la misma cedula) devuelve el EXISTENTE con 200, sin duplicar', async () => {
      const mismoEmail = await http.post('/api/v3/clientes').send({ nombre: 'Juan P.', email: email.toUpperCase(), identificacion: '0999999999' });
      expect(mismoEmail.status).toBe(200);
      expect(mismoEmail.body).toEqual({ client_id: clientId, nombre: 'Juan Perez', email, identificacion: cedula });
      const mismaCedula = await http.post('/api/v3/clientes').send({ nombre: 'Otro', email: `otro.${cedula}@example.com`, identificacion: cedula });
      expect(mismaCedula.status).toBe(200);
      expect(mismaCedula.body.client_id).toBe(clientId);
      const [{ n }] = await t.ds.query('SELECT COUNT(*)::int AS n FROM db_identity.clientes WHERE email = $1 OR identificacion = $2', [email, cedula]);
      expect(n).toBe(1);
    });

    it('GET /api/v3/clientes?email|identificacion -> 200; inexistente -> 404 o [] con X-Prefer-Empty-Array', async () => {
      const porEmail = await http.get('/api/v3/clientes').query({ email });
      expect(porEmail.status).toBe(200);
      expect(porEmail.body).toEqual({ client_id: clientId, nombre: 'Juan Perez', email, identificacion: cedula });
      expect((await http.get('/api/v3/clientes').query({ identificacion: cedula })).body.client_id).toBe(clientId);
      const no = await http.get('/api/v3/clientes').query({ email: 'nadie.nunca@example.com' });
      expect(no.status).toBe(404);
      expect(no.body.code).toBe('CLIENT_NOT_FOUND');
      const vacio = await http.get('/api/v3/clientes').query({ email: 'nadie.nunca@example.com' }).set('X-Prefer-Empty-Array', 'true');
      expect(vacio.status).toBe(200);
      expect(vacio.body).toEqual([]);
      const sinParametros = await http.get('/api/v3/clientes');
      expect(sinParametros.status).toBe(422);
    });

    it('POST /api/v3/clientes con email invalido -> 422 INVALID_PAYLOAD', async () => {
      const r = await http.post('/api/v3/clientes').send({ nombre: 'X Y', email: 'malo', identificacion: '' });
      expect(r.status).toBe(422);
      expect(r.body.code).toBe('INVALID_PAYLOAD');
    });

    it('el Booking reserva con driver en ingles -> 201, la orden queda vinculada al client_id (sin duplicar el cliente)', async () => {
      const r = await http.post('/api/v3/autos/orders/create')
        .set({ 'Idempotency-Key': randomUUID(), 'X-Correlation-Id': correlation, 'X-API-Key': 'clave-que-envia-el-booking' })
        .send(pedido(vehicleId));
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ status: 'CONFIRMED', auto_id: vehicleId, vehicle_id: vehicleId, client_id: clientId, tipo_cobertura: 'BASICA' });
      expect(r.body.voucher_qr_payload).toBe(r.body.voucher_qr_data);
      expect(r.body._links.self).toMatch(/^\/api\/v3\//);
      expect(r.headers['x-correlation-id']).toBe(correlation);
      pnr = r.body.pnr; orderId = r.body.order_id;
      const [o] = await t.ds.query('SELECT fk_cliente FROM db_orders.orders WHERE order_id = $1', [orderId]);
      expect(o.fk_cliente).toBe(clientId);
    });

    it('FLUJO 1 (cont.): el auto pasa a RESERVADO, stock 0 en v3 y v2, y salio PushStockUpdate available=0', async () => {
      const v = await t.ds.getRepository(Vehicle).findOneByOrFail({ vehicle_id: vehicleId });
      expect(v.status).toBe('RESERVED');
      expect((await http.get(`/api/v3/autos/${vehicleId}`)).body).toMatchObject({ estado: 'RESERVADO', stock: 0, available_units: 0 });
      expect((await http.get(`/api/v2/autos/${vehicleId}`)).body.estado).toBe('RESERVADO');
      await esperar(() => pushes.some((p) => p.item_id === vehicleId && p.available_units === 0));
      expect(pushes.filter((p) => p.item_id === vehicleId).map((p) => p.available_units)).toEqual([1, 0]);
      const logs = await t.ds.query("SELECT canal, resultado FROM db_inventory.grpc_log WHERE item_id = $1 AND available_units = 0", [vehicleId]);
      expect(logs).toEqual(expect.arrayContaining([expect.objectContaining({ canal: 'GRPC', resultado: 'ACK' })]));
    });

    it('una segunda reserva del mismo auto -> 409 VEHICLE_UNAVAILABLE (activa la Saga del Booking)', async () => {
      const r = await http.post('/api/v3/autos/orders/create').set('Idempotency-Key', randomUUID())
        .send(pedido(vehicleId, { driver: { full_name: 'Ana Ruiz', email: 'ana@example.com', phone: '0991234567', license_number: '0102030405', age: 30 } }));
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ code: 'VEHICLE_UNAVAILABLE', type: 'https://booking.epn.edu.ec/errors/vehicle-unavailable' });
    });

    it('errores canonicos v3: 422 DRIVER_UNDERAGE, 422 INVALID_DATES, 400 MALFORMED_REQUEST, 400 sin Idempotency-Key', async () => {
      const menor = await http.post('/api/v3/autos/orders/create').set('Idempotency-Key', randomUUID())
        .send(pedido('VEH-1001', { driver: { full_name: 'Nino Ruiz', email: 'n@example.com', phone: '0991234567', license_number: '0102030405', age: 16 } }));
      expect(menor.status).toBe(422);
      expect(menor.body.code).toBe('DRIVER_UNDERAGE');
      const fechas = await http.post('/api/v3/autos/orders/create').set('Idempotency-Key', randomUUID()).send(pedido(vehicleId, { pickup_date: '2020-01-01' }));
      expect(fechas.status).toBe(422);
      expect(fechas.body.code).toBe('INVALID_DATES');
      const malformado = await http.post('/api/v3/autos/orders/create').set({ 'Idempotency-Key': randomUUID(), 'Content-Type': 'application/json' }).send('{"vehicle_id": ');
      expect(malformado.status).toBe(400);
      expect(malformado.body.code).toBe('MALFORMED_REQUEST');
      const sinClave = await http.post('/api/v3/autos/orders/create').send(pedido(vehicleId));
      expect(sinClave.status).toBe(400);
    });

    it('Ley de Postel: acepta conductor/cobertura en espanol', async () => {
      const r = await http.post('/api/v3/autos/orders/create').set('Idempotency-Key', randomUUID()).send({
        vehicle_id: vehicleId, fecha_recogida: fechaEc(2), fecha_devolucion: fechaEc(4), cobertura: 'TOTAL',
        conductor: { nombre: 'Juan Perez', email, telefono: '+593987654321', licencia_conducir: cedula, edad: 28 },
      });
      // El auto ya esta reservado: llega a la regla de stock (409), es decir, el payload en espanol fue aceptado
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('VEHICLE_UNAVAILABLE');
    });

    it('el buscador del mostrador encuentra la reserva por PNR, cedula y email', async () => {
      for (const [q, tipo] of [[pnr, 'PNR'], [cedula, 'IDENTIFICACION'], [email, 'EMAIL']] as const) {
        const r = await http.get('/api/v3/autos/orders/buscar').query({ q }).set(admin());
        expect(r.status).toBe(200);
        expect(r.body.tipo_detectado).toBe(tipo);
        const tarjeta = r.body.resultados.find((x: any) => x.pnr === pnr);
        expect(tarjeta).toMatchObject({
          estado_mostrador: 'RESERVADO', puede_entregar: true,
          vehiculo: { vehicle_id: vehicleId, marca: 'Chevrolet', modelo: 'Onix', placa },
          cliente: { client_id: clientId, nombre: 'Juan Perez', identificacion: cedula, email },
        });
      }
      expect((await http.get('/api/v3/autos/orders/buscar').query({ q: pnr })).status).toBe(401);
    });

    it('check-in de entrega -> CONFIRMADO_ASISTIDO, vehiculo ENTREGADO y notificacion HTTP al Booking central', async () => {
      const clave = randomUUID();
      const r = await http.post(`/api/v3/autos/orders/${pnr}/checkin-entrega`)
        .set({ ...admin(), 'Idempotency-Key': clave, 'X-Correlation-Id': correlation })
        .send({ licencia_conducir: cedula, km_salida: 150, acepta_contrato: true });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        estado_orden: 'CONFIRMADO_ASISTIDO', estado_vehiculo: 'ENTREGADO', km_salida: 150, client_id: clientId,
        admin_id: 'admin-e2e@rentafacil.ec', notificacion_booking: { status: 'PENDING', modo: 'fire-and-forget' },
        mensaje: 'Entrega confirmada. Vehículo entregado al cliente.',
      });

      await esperar(() => notificaciones.some((n) => n.url.includes(pnr)));
      const n = notificaciones.find((x) => x.url.includes(pnr))!;
      expect(n.url).toBe(`https://booking-core-api.test/api/v3/reservas/${pnr}/checkin`);
      expect(n.headers['X-Correlation-Id']).toBe(correlation);
      expect(n.headers['Content-Type']).toBe('application/json');
      expect(n.body).toEqual({
        external_order_id: pnr, client_id: clientId, estado: 'CONFIRMADO_ASISTIDO', admin_id: 'admin-e2e@rentafacil.ec',
        fecha_checkin: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        observaciones: 'Vehiculo entregado fisicamente con contrato y licencia validada',
      });
      await esperar(async () => (await t.ds.query('SELECT status FROM db_outbox.outbox_booking_notifications WHERE order_id = $1', [orderId]))[0]?.status === 'SENT');
      const [notif] = await t.ds.query('SELECT status, attempts, last_status_code FROM db_outbox.outbox_booking_notifications WHERE order_id = $1', [orderId]);
      expect(notif).toEqual({ status: 'SENT', attempts: 1, last_status_code: 200 });
      const [ck] = await t.ds.query("SELECT tipo, km, estado_resultante, client_id FROM db_counter.checkins WHERE order_id = $1", [orderId]);
      expect(ck).toEqual({ tipo: 'ENTREGA', km: 150, estado_resultante: 'CONFIRMADO_ASISTIDO', client_id: clientId });
      const evento = await t.ds.query("SELECT data FROM db_outbox.outbox_events WHERE routing_key = 'auto.checkin.notified' AND subject = $1", [orderId]);
      await esperar(async () => (await t.ds.query("SELECT 1 FROM db_outbox.outbox_events WHERE routing_key = 'auto.checkin.notified' AND subject = $1", [orderId])).length > 0);
      expect((await t.ds.query("SELECT data->>'resultado' AS r FROM db_outbox.outbox_events WHERE routing_key = 'auto.checkin.notified' AND subject = $1", [orderId]))[0].r).toBe('success');
      expect(evento).toBeDefined();

      // Reintento con la misma Idempotency-Key: misma respuesta y NO se notifica dos veces
      const total = notificaciones.length;
      const otra = await http.post(`/api/v3/autos/orders/${pnr}/checkin-entrega`)
        .set({ ...admin(), 'Idempotency-Key': clave }).send({ licencia_conducir: cedula, km_salida: 150, acepta_contrato: true });
      expect(otra.status).toBe(200);
      await new Promise((res) => setTimeout(res, 100));
      expect(notificaciones.length).toBe(total);
    });

    it('tras el check-in la tarjeta queda verde (CONFIRMADO_ASISTIDO) con el acuse del Booking', async () => {
      const r = await http.get('/api/v3/autos/orders/buscar').query({ q: pnr }).set(admin());
      expect(r.body.resultados[0]).toMatchObject({
        estado_mostrador: 'CONFIRMADO_ASISTIDO', puede_entregar: false, puede_devolver: true,
        notificacion_booking: { status: 'SENT', last_status_code: 200 },
      });
    });

    it('compatibilidad: la misma orden se lee por /api/v2 (ENTREGADO) y /api/v1 sigue respondiendo', async () => {
      const v2 = await http.get(`/api/v2/autos/orders/${pnr}`).set(admin());
      expect(v2.status).toBe(200);
      expect(v2.body.status).toBe('ENTREGADO');
      expect(v2.body._links.self).toMatch(/^\/api\/v2\//);
      const v1 = await http.get('/api/v1/admin/orders').set(admin());
      expect(v1.status).toBe(200);
      expect(v1.body.some((o: any) => o.order_id === orderId)).toBe(true);
    });

    it('si el Booking falla, el check-in local NO falla y la notificacion queda para reintento', async () => {
      // Otra reserva sobre un auto del seed propio para no depender de datos externos
      const placa2 = `${letras()}-${Math.floor(1000 + Math.random() * 8999)}`;
      const v = await http.post('/api/v3/admin/vehicles').set(admin()).send({ marca: 'Kia', modelo: 'Picanto', anio: 2024, placa: placa2, precio_diario: 30, depot_id: f.depot.depot_id, supplier_id: f.supplier.supplier_id });
      const o = await http.post('/api/v3/autos/orders/create').set('Idempotency-Key', randomUUID()).send(pedido(v.body.vehicle_id));
      bookingStatus = 504;
      try {
        const r = await http.post(`/api/v3/autos/orders/${o.body.pnr}/checkin-entrega`).set({ ...admin(), 'Idempotency-Key': randomUUID() })
          .send({ licencia_conducir: cedula, km_salida: 10, acepta_contrato: true });
        expect(r.status).toBe(200);
        expect(r.body.estado_orden).toBe('CONFIRMADO_ASISTIDO');
        await esperar(async () => (await t.ds.query('SELECT attempts FROM db_outbox.outbox_booking_notifications WHERE order_id = $1', [o.body.order_id]))[0]?.attempts === 1);
        const [n] = await t.ds.query('SELECT status, attempts, last_status_code FROM db_outbox.outbox_booking_notifications WHERE order_id = $1', [o.body.order_id]);
        expect(n).toEqual({ status: 'PENDING', attempts: 1, last_status_code: 504 });
        expect((await http.get('/api/v3/autos/health')).body.outbox_pendientes).toBeGreaterThanOrEqual(0);
      } finally {
        bookingStatus = 200;
        await t.ds.query('DELETE FROM db_outbox.outbox_booking_notifications WHERE order_id = $1', [o.body.order_id]);
        await t.ds.query('DELETE FROM db_counter.checkins WHERE order_id = $1', [o.body.order_id]);
        await t.ds.query('DELETE FROM db_orders.orders WHERE order_id = $1', [o.body.order_id]);
        await t.ds.query("DELETE FROM db_outbox.outbox_events WHERE subject = $1 OR data->>'auto_id' = $1 OR subject = $2", [v.body.vehicle_id, o.body.order_id]);
        await t.ds.query('DELETE FROM db_inventory.grpc_log WHERE item_id = $1', [v.body.vehicle_id]);
        await t.ds.query('DELETE FROM db_catalog.vehicles WHERE vehicle_id = $1', [v.body.vehicle_id]);
      }
    });

    it('logs visibles con timestamp y correlation id para cada modulo clave', () => {
      const lineas = lineasCapturadas();
      const de = (re: RegExp) => lineas.find((l) => re.test(l));
      for (const re of [
        /\[CLIENTES\] POST nombre=Juan Perez -> CREATED \| 201/,
        /\[CLIENTES\] GET email=.+ -> FOUND \| 200 OK/,
        /\[CLIENTES\] upsert email=.+ result=EXISTS/,
        /\[RESERVAS\] POST \/orders\/create vehicle_id=.+ -> PNR=RF\w+ \| 201/,
        /\[CHECKIN\] \/orders\/RF\w+\/checkin-entrega -> ENTREGADO \| km_salida=150/,
        /\[BOOKING-NOTIFY\] POST \/reservas\/RF\w+\/checkin -> 200 OK/,
        /\[BOOKING-NOTIFY\] POST \/reservas\/RF\w+\/checkin -> ERROR 504 \| retry_in=1s/,
        /\[GRPC\] PushStockUpdate item=VEH-\w+ available=0 -> ACK/,
        /\[DB\] conexion .+ -> UP/,
      ]) {
        const l = de(re);
        expect(l).toBeDefined();
        expect(l).toMatch(LINEA_LOG);
      }
      expect(de(/\[RESERVAS\] POST \/orders\/create/)).toContain(`correlation=${correlation}`);
      expect(de(/\[BOOKING-NOTIFY\] .* 200 OK/)).toContain(`correlation=${correlation}`);
    });
  });
});

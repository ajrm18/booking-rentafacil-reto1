import request from 'supertest';
import { randomUUID } from 'crypto';
import { Vehicle } from '../../src/modules/autos/entities/vehicle.entity';
import { OutboxEvent } from '../../src/modules/integracion/entities/outbox-event.entity';
import { ContratoPromociones } from '../../src/modules/autos-v2/entities/contrato-promociones.entity';
import { CONTRATO_INICIAL, PROVEEDOR_PROMOCIONES } from '../../src/modules/autos-v2/promociones-v2.service';
import { ciudadUnica, createFixtures, createTestApp, describeDb, dropFixtures, fechaEc, TestApp } from '../helpers/test-app';

describeDb('Saga de cancelacion y promociones B2B /api/v2 (e2e)', () => {
  let t: TestApp;
  let http: ReturnType<typeof request>;
  let f: Awaited<ReturnType<typeof createFixtures>>;
  const ciudad = ciudadUnica();
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    t = await createTestApp();
    http = request(t.app.getHttpServer());
    f = await createFixtures(t.ds, { price_per_day: 50 }, ciudad);
  });
  afterAll(async () => {
    // Deja el contrato B2B como lo siembra el seed
    await t.ds.getRepository(ContratoPromociones).update({ proveedor_codigo: PROVEEDOR_PROMOCIONES }, { ...CONTRATO_INICIAL });
    await dropFixtures(t.ds, f);
    await t.close();
  });

  describe('Cancelacion Saga con reembolso 100 %', () => {
    let pnr: string;
    let total: number;
    let primera: any;
    const clave = randomUUID();

    it('crea una reserva BASICA', async () => {
      const r = await http.post('/api/v2/autos/reservas').set(as(t.clientToken)).set('Idempotency-Key', randomUUID()).send({
        auto_id: f.vehicle.vehicle_id, fecha_recogida: fechaEc(5), fecha_devolucion: fechaEc(7), hora_recogida: '09:30', hora_devolucion: '18:00',
        conductor: { nombre_completo: 'Dilan Flores', correo: 'dilan.flores@epn.edu.ec', phone: '+593987654321', licencia_conducir: '1723456789', edad_conductor: 28 },
      });
      expect(r.status).toBe(201);
      expect(r.body.tipo_cobertura).toBe('BASICA');
      pnr = r.body.pnr; total = r.body.total_price.total;
      expect(total).toBe(150); // 3 dias (09:30 -> 18:00 del tercer dia) x 50
    });

    it('otro cliente no la ve (404)', async () => {
      const otro = t.app.get(require('@nestjs/jwt').JwtService).sign({ sub: 'otro@example.com', role: 'client', scopes: [] });
      expect((await http.get(`/api/v2/autos/orders/${pnr}`).set(as(otro))).status).toBe(404);
    });

    it('POST /cancel: CANCELLED, reembolso 100 %, vehiculo DISPONIBLE y evento auto.order.cancelled', async () => {
      const r = await http.post(`/api/v2/autos/orders/${pnr}/cancel`).set(as(t.clientToken)).set('Idempotency-Key', clave)
        .send({ motivo: 'Cambio de itinerario de vuelo', solicitante: 'SAGA_ORCHESTRATOR' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        pnr, status: 'CANCELLED', auto_id: f.vehicle.vehicle_id, solicitante: 'SAGA_ORCHESTRATOR',
        refund: { amount: total, currency: 'USD', percentage: 100, status: 'PROCESSED' },
        inventory_restoration: { status: 'RESTORED', vehicle_id: f.vehicle.vehicle_id, new_state: 'DISPONIBLE' },
      });
      expect(r.body.refund.refund_id).toMatch(/^REF-AUTO-/);
      primera = r.body;
      expect((await t.ds.getRepository(Vehicle).findOneByOrFail({ vehicle_id: f.vehicle.vehicle_id })).status).toBe('AVAILABLE');
      const ev = await t.ds.getRepository(OutboxEvent).find({ where: { routing_key: 'auto.order.cancelled', subject: r.body.order_id } });
      expect(ev).toHaveLength(1);
      expect(ev[0].data).toMatchObject({ refund_amount: total, estado_restituido: 'DISPONIBLE' });
    });

    it('reintento con la misma clave -> misma respuesta; con otra clave -> 409', async () => {
      const r = await http.post(`/api/v2/autos/orders/${pnr}/cancel`).set(as(t.clientToken)).set('Idempotency-Key', clave).send({});
      expect(r.status).toBe(200);
      expect(r.body).toEqual(primera);
      const otra = await http.post(`/api/v2/autos/orders/${pnr}/cancel`).set(as(t.clientToken)).set('Idempotency-Key', randomUUID()).send({});
      expect(otra.status).toBe(409);
      expect(otra.body.code).toBe('ORDER_ALREADY_CANCELLED');
    });

    it('GET /orders/{PNR} refleja el reembolso', async () => {
      const r = await http.get(`/api/v2/autos/orders/${pnr}`).set(as(t.adminToken));
      expect(r.body).toMatchObject({ status: 'CANCELLED', reembolso_id: primera.refund.refund_id, monto_reembolsado: total });
    });
  });

  describe('Promociones B2B (Catedra RDA2 §9)', () => {
    const url = '/api/v2/autos/promociones/contrato';

    it('GET requiere JWT y devuelve el contrato sembrado', async () => {
      expect((await http.get(url)).status).toBe(401);
      const r = await http.get(url).set(as(t.clientToken));
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ proveedor_codigo: 'NODE_AUT_LOCAL', vertical: 'AUTOS' });
      expect(typeof r.body.permite_promociones).toBe('boolean');
    });

    it('PUT: CLIENTE 403, sin Idempotency-Key 400, porcentaje fuera de 0-100 -> 400', async () => {
      const body = { permite_promociones: true, porcentaje_descuento_maximo: 20 };
      expect((await http.put(url).set(as(t.clientToken)).set('Idempotency-Key', randomUUID()).send(body)).status).toBe(403);
      expect((await http.put(url).set(as(t.adminToken)).send(body)).status).toBe(400);
      const r = await http.put(url).set(as(t.adminToken)).set('Idempotency-Key', randomUUID()).send({ ...body, porcentaje_descuento_maximo: 150 });
      expect(r.status).toBe(400);
      expect(r.body.invalid_params[0].name).toBe('porcentaje_descuento_maximo');
    });

    it('PUT con JWT ADMIN formaliza el acuerdo', async () => {
      const r = await http.put(url).set(as(t.adminToken)).set('Idempotency-Key', randomUUID()).send({
        permite_promociones: true, porcentaje_descuento_maximo: 12.5, destinos_habilitados: ['Quito', 'Cuenca'],
        vigencia_hasta: '2027-06-30', condiciones_combo: 'Combo auto + hotel',
      });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        success: true,
        contrato: { permite_promociones: true, porcentaje_descuento_maximo: 12.5, destinos_habilitados: ['Quito', 'Cuenca'], vigencia_hasta: '2027-06-30' },
      });
      const g = await http.get(url).set(as(t.adminToken));
      expect(g.body.porcentaje_descuento_maximo).toBe(12.5);
      expect(g.body.actualizado_por).toBe('admin-e2e@rentafacil.ec');
    });
  });
});

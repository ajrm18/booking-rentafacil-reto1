import * as amqp from 'amqplib';
import request from 'supertest';
import { OutboxService } from '../../src/modules/integracion/outbox.service';
import { EventBusService } from '../../src/modules/integracion/event-bus.service';
import { EVENTOS } from '../../src/modules/integracion/nodo';
import { createTestApp, TEST_DB, TestApp } from '../helpers/test-app';

/**
 * Publicacion real al exchange topic booking.events. Necesita un RabbitMQ desechable en
 * TEST_RABBITMQ_URL (ademas de TEST_DATABASE_URL); sin ellos se omite.
 */
const RMQ = process.env.TEST_RABBITMQ_URL;
(RMQ && TEST_DB ? describe : describe.skip)('Outbox -> RabbitMQ booking.events (e2e)', () => {
  let t: TestApp;
  let conexion: amqp.ChannelModel;
  let canal: amqp.Channel;

  beforeAll(async () => {
    process.env.RABBITMQ_URL = RMQ;
    t = await createTestApp();
    conexion = await amqp.connect(RMQ!);
    conexion.on('error', () => undefined);
    canal = await conexion.createChannel();
    canal.on('error', () => undefined);
  });
  afterAll(async () => {
    delete process.env.RABBITMQ_URL;
    await canal?.close();
    await conexion?.close();
    await t?.close();
  });

  it('el worker publica el CloudEvent con routing key y /health reporta rabbitmq UP', async () => {
    const outbox = t.app.get(OutboxService);
    await t.app.get(EventBusService).asegurarConexion(); // declara exchange y colas q.<routing key>
    expect(t.app.get(EventBusService).estado).toBe('CONNECTED');
    await outbox.tick(); // vacia pendientes previos de la BD de pruebas
    await canal.purgeQueue(`q.${EVENTOS.STOCK_ACTUALIZADO}`);

    const e = await outbox.registrar(null, EVENTOS.STOCK_ACTUALIZADO, { auto_id: 'VEH-RMQ', estado: 'DISPONIBLE', available_units: 1 }, { correlationId: 'corr-rmq' });
    expect(await outbox.tick()).toBeGreaterThanOrEqual(1);

    const msg = await canal.get(`q.${EVENTOS.STOCK_ACTUALIZADO}`, { noAck: true });
    expect(msg).toBeTruthy();
    const ce = JSON.parse((msg as amqp.GetMessage).content.toString());
    expect((msg as amqp.GetMessage).fields.exchange).toBe('booking.events');
    expect((msg as amqp.GetMessage).fields.routingKey).toBe('stock.actualizado');
    expect(ce).toMatchObject({
      specversion: '1.0', id: e.event_id, type: 'ec.edu.epn.booking.autos.stock.actualizado',
      source: '/microservices/ms-autos', correlation_id: 'corr-rmq', data: { auto_id: 'VEH-RMQ', available_units: 1 },
    });

    const h = await request(t.app.getHttpServer()).get('/api/v2/autos/health');
    expect(h.body.dependencias.rabbitmq).toBe('UP');
    await t.ds.query('DELETE FROM outbox_events WHERE event_id = $1', [e.event_id]);
  });
});

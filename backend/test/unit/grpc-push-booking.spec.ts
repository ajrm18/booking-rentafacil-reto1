import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { createServer } from 'net';
import { inventoryProtoPath, PROTO_LOADER_OPTIONS } from '../../src/modules/integracion/grpc/proto-path';
import { slotIdDe, StockPushClient } from '../../src/modules/integracion/grpc/stock-push.client';
import { usarFetch } from '../../src/common/http-saliente';
import { captura, lineasCapturadas } from '../../src/common/app-logger';

const puertoLibre = () => new Promise<number>((resolve, reject) => {
  const srv = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
    const { port } = srv.address() as { port: number };
    srv.close(() => resolve(port));
  });
});

const msg = { service_id: 'NODE_AUT_RENTAFACIL', item_id: 'VEH-1001', date: '2026-11-15', time_slot: '10:00', available_units: 0, timestamp: Date.now() };

/** Servidor gRPC que simula al Booking central (mock del InventoryStockService). */
describe('Cliente gRPC PushStockUpdate hacia el Booking central', () => {
  let server: grpc.Server;
  let puerto: number;
  const recibidos: any[] = [];

  beforeAll(async () => {
    puerto = await puertoLibre();
    const pkg: any = grpc.loadPackageDefinition(protoLoader.loadSync(inventoryProtoPath(), PROTO_LOADER_OPTIONS)).inventory;
    server = new grpc.Server();
    server.addService(pkg.InventoryStockService.service, {
      PushStockUpdate: (call: any, cb: any) => { recibidos.push(call.request); cb(null, { success: true, message: 'OK', processed_at: Date.now() }); },
      StreamInventoryChanges: (_c: any, cb: any) => cb(null, {}),
    });
    await new Promise<void>((res, rej) => server.bindAsync(`127.0.0.1:${puerto}`, grpc.ServerCredentials.createInsecure(), (e) => (e ? rej(e) : res())));
  });
  afterAll(() => server.forceShutdown());
  afterEach(() => { delete process.env.BOOKING_GRPC_HOST; delete process.env.BOOKING_REST_STOCK_URL; usarFetch((i, o) => fetch(i, o)); captura(false); });

  it('slot_id canonico slot-YYYYMMDD-HHMM', () => {
    expect(slotIdDe('2026-11-15', '10:30')).toBe('slot-20261115-1030');
  });

  it('envia el StockUpdateMessage por gRPC y registra ACK en el log', async () => {
    process.env.BOOKING_GRPC_HOST = `127.0.0.1:${puerto}`;
    const c = new StockPushClient();
    captura(true);
    const r = await c.enviar(msg);
    c.onModuleDestroy();
    expect(r).toMatchObject({ ok: true, canal: 'GRPC' });
    expect(recibidos.at(-1)).toMatchObject({ service_id: 'NODE_AUT_RENTAFACIL', item_id: 'VEH-1001', date: '2026-11-15', time_slot: '10:00', available_units: 0 });
    expect(lineasCapturadas().some((l) => l.includes('[GRPC] PushStockUpdate item=VEH-1001 available=0 -> ACK'))).toBe(true);
  });

  it('si gRPC falla hace fallback REST a BOOKING_REST_STOCK_URL con { item_id, available_units, date, reason }', async () => {
    process.env.BOOKING_GRPC_HOST = `127.0.0.1:${await puertoLibre()}`; // nadie escucha
    process.env.BOOKING_REST_STOCK_URL = 'https://booking.test/api/v3/inventory/stock';
    let cuerpo: any;
    usarFetch(async (_u: any, init: any) => { cuerpo = JSON.parse(init.body); return new Response('{"acknowledged":true}', { status: 200 }); });
    const c = new StockPushClient();
    const r = await c.enviar(msg);
    c.onModuleDestroy();
    expect(r).toMatchObject({ ok: true, canal: 'REST_FALLBACK' });
    expect(cuerpo).toMatchObject({ item_id: 'VEH-1001', available_units: 0, date: '2026-11-15', reason: 'ORDER_CREATED', slot_id: 'slot-20261115-1000' });
  }, 20000);

  it('sin destino configurado no intenta y no lanza', async () => {
    const c = new StockPushClient();
    expect(c.configurado).toBe(false);
    await expect(c.push(msg)).resolves.toBe(false);
  });
});

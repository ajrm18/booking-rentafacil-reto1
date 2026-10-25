import { INestMicroservice } from '@nestjs/common';
import { Transport } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { createServer } from 'net';
import { StockGrpcController } from '../../src/modules/integracion/grpc/stock-grpc.controller';
import { STOCK_TTL_MS, StockCacheService } from '../../src/modules/integracion/grpc/stock-cache.service';
import { GRPC_PACKAGE, inventoryProtoPath, PROTO_LOADER_OPTIONS } from '../../src/modules/integracion/grpc/proto-path';

/** Puerto libre que asigna el SO (en Windows, Hyper-V reserva rangos de puertos dinamicamente). */
const puertoLibre = () => new Promise<number>((resolve, reject) => {
  const srv = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
    const { port } = srv.address() as { port: number };
    srv.close(() => resolve(port));
  });
});

/**
 * Servidor gRPC real (Nest microservice con src/proto/inventory.proto) y un cliente @grpc/grpc-js,
 * como lo haria el Booking Prototipo central.
 */
describe('gRPC inventory.InventoryStockService', () => {
  let micro: INestMicroservice;
  let cache: StockCacheService;
  let cliente: any;
  let PUERTO: number;

  beforeAll(async () => {
    PUERTO = Number(process.env.GRPC_TEST_PORT) || await puertoLibre();
    const mod = await Test.createTestingModule({ controllers: [StockGrpcController], providers: [StockCacheService] }).compile();
    micro = mod.createNestMicroservice({
      transport: Transport.GRPC,
      options: { package: GRPC_PACKAGE, protoPath: inventoryProtoPath(), url: `127.0.0.1:${PUERTO}`, loader: PROTO_LOADER_OPTIONS },
      logger: false,
    });
    await micro.listen();
    cache = micro.get(StockCacheService);
    const pkg: any = grpc.loadPackageDefinition(protoLoader.loadSync(inventoryProtoPath(), PROTO_LOADER_OPTIONS)).inventory;
    cliente = new pkg.InventoryStockService(`127.0.0.1:${PUERTO}`, grpc.credentials.createInsecure());
  });

  afterAll(async () => {
    cliente?.close();
    await micro?.close();
  });

  const push = (msg: any) => new Promise<any>((resolve, reject) =>
    cliente.PushStockUpdate(msg, (err: Error | null, ack: any) => (err ? reject(err) : resolve(ack))));

  const msg = { service_id: 'NODE_AUT_RENTAFACIL', item_id: 'VEH-1001', date: '2026-11-01', time_slot: '10:00', available_units: 0, timestamp: Date.now() };

  it('PushStockUpdate devuelve StockUpdateAck y actualiza la cache en RAM', async () => {
    const ack = await push(msg);
    expect(ack.success).toBe(true);
    expect(typeof ack.processed_at).toBe('number');
    expect(cache.get(msg)).toMatchObject({ item_id: 'VEH-1001', available_units: 0 });

    await push({ ...msg, available_units: 1 });
    expect(cache.get(msg)!.available_units).toBe(1);
  });

  it('PushStockUpdate rechaza franjas que no son de 30 minutos (success=false, sin tocar la cache)', async () => {
    const ack = await push({ ...msg, item_id: 'VEH-1002', time_slot: '10:15' });
    expect(ack.success).toBe(false);
    expect(ack.message).toContain('30 minutos');
    expect(cache.get({ ...msg, item_id: 'VEH-1002' })).toBeUndefined();
  });

  it('StreamInventoryChanges (client streaming) aplica los deltas y devuelve StreamSummary', async () => {
    const resumen = await new Promise<any>((resolve, reject) => {
      const call = cliente.StreamInventoryChanges((err: Error | null, r: any) => (err ? reject(err) : resolve(r)));
      const base = { service_id: 'NODE_AUT_RENTAFACIL', item_id: 'VEH-2001', date: '2026-11-02', time_slot: '09:30', timestamp: Date.now() };
      call.write({ ...base, event_id: 'e1', delta: 1 });
      call.write({ ...base, event_id: 'e2', delta: 1 });
      call.write({ ...base, event_id: 'e3', delta: -1 });
      call.end();
    });
    expect(resumen).toMatchObject({ total_events_processed: 3, is_synchronized: true });
    expect(resumen.last_sync_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(cache.get({ service_id: 'NODE_AUT_RENTAFACIL', item_id: 'VEH-2001', date: '2026-11-02', time_slot: '09:30' })!.available_units).toBe(1);
  });

  it('la cache en RAM expira a la hora (TTL 1 h)', () => {
    const c = new StockCacheService();
    const t = 1_000_000;
    c.upsert({ ...msg, item_id: 'VEH-TTL' }, t);
    expect(c.get({ ...msg, item_id: 'VEH-TTL' }, t + STOCK_TTL_MS - 1)).toBeDefined();
    expect(c.get({ ...msg, item_id: 'VEH-TTL' }, t + STOCK_TTL_MS)).toBeUndefined();
    expect(STOCK_TTL_MS).toBe(60 * 60 * 1000);
  });
});

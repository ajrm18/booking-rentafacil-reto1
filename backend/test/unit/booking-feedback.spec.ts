import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { HttpException } from '@nestjs/common';
import { apiKeyV3Middleware, claveValidaV3, rentafacilApiKey } from '../../src/common/rentafacil-api-key';
import { V3AuthGuard } from '../../src/common/guards/v3-auth.guard';
import { IdempotencyOpcionalGuard, IdempotencyV2Guard } from '../../src/modules/autos-v2/idempotency-v2.guard';
import { assertReservablePorRango } from '../../src/modules/autos-v2/reservas-v2.service';
import { CatalogoV2Service } from '../../src/modules/autos-v2/catalogo-v2.service';
import { aOrdenV2 } from '../../src/modules/autos-v2/v2.mapper';
import { ReservasV3Service } from '../../src/modules/autos-v3/reservas-v3.service';
import { BookingNotifierService } from '../../src/modules/autos-v3/booking-notifier.service';
import {
  claveCancelacionDerivada, conFechasV3, conStockV3, estadoCatalogoV3, fechaDe, ordenCruzaRango, rangosSeCruzan, statusV3,
} from '../../src/modules/autos-v3/v3';
import { UUID_V4 } from '../../src/modules/autos-v2/idempotency-v2.guard';
import { captura, lineasCapturadas } from '../../src/common/app-logger';
import { usarFetch } from '../../src/common/http-saliente';

const CLAVE = process.env.RENTAFACIL_API_KEY!;
const ctxHttp = (headers: Record<string, string> = {}) => ({ switchToHttp: () => ({ getRequest: () => ({ headers, originalUrl: '/api/v3/autos/orders/x/cancel' }) }) }) as any;

/** Orden minima con rango de fechas. */
const orden = (pickup: string, dropoff: string, extra: Record<string, any> = {}) => ({
  order_id: randomUUID(), locator: 'RFDEC2026', vehicle_id: 'VEH-1001', status: 'CONFIRMED',
  checkin_devolucion_at: null, returned_at: null, checkin_entrega_at: null, checkin_digital_at: null,
  route_details: { pickup: { datetime: `${pickup}T15:00:00.000Z` }, dropoff: { datetime: `${dropoff}T15:00:00.000Z` } },
  owner_sub: 'b2b:booking-prototipo', total_price: 100, currency: 'USD', fk_cliente: null,
  ...extra,
}) as any;

// ═══════════════════════════════════════════════════════════════════════════
//  AJUSTE 1 — cancel sin Idempotency-Key
// ═══════════════════════════════════════════════════════════════════════════

describe('Ajuste 1: POST /api/v3/autos/orders/{pnr}/cancel con Idempotency-Key opcional', () => {
  it('IdempotencyOpcionalGuard deja pasar sin cabecera, valida el formato si viene', () => {
    const g = new IdempotencyOpcionalGuard();
    expect(g.canActivate(ctxHttp())).toBe(true);
    expect(g.canActivate(ctxHttp({ 'idempotency-key': randomUUID() }))).toBe(true);
    expect(() => g.canActivate(ctxHttp({ 'idempotency-key': 'no-es-uuid' }))).toThrow(HttpException);
  });

  it('/api/v2 sigue exigiendo Idempotency-Key (IdempotencyV2Guard sin cambios)', () => {
    expect(() => new IdempotencyV2Guard().canActivate(ctxHttp())).toThrow(HttpException);
  });

  it('la clave derivada es un UUID v4 estable por pnr + fecha y cambia con el dia', () => {
    const d1 = new Date('2026-12-20T10:00:00Z');
    const a = claveCancelacionDerivada('RF34567890', d1);
    expect(a).toMatch(UUID_V4);
    expect(claveCancelacionDerivada('rf34567890', new Date('2026-12-20T23:59:00Z'))).toBe(a);
    expect(claveCancelacionDerivada('RF34567890', new Date('2026-12-21T00:00:00Z'))).not.toBe(a);
    expect(claveCancelacionDerivada('RFOTRO0001', d1)).not.toBe(a);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  AJUSTE 2 — bloqueo por rango de fechas
// ═══════════════════════════════════════════════════════════════════════════

describe('Ajuste 2: disponibilidad por rango de fechas (no por auto entero)', () => {
  const diciembre = orden('2026-12-26', '2026-12-28');

  it('[a1,a2] y [b1,b2] se cruzan cuando a1 <= b2 AND b1 <= a2', () => {
    expect(rangosSeCruzan('2026-12-26', '2026-12-28', '2026-12-27', '2026-12-28')).toBe(true);
    expect(rangosSeCruzan('2026-12-26', '2026-12-28', '2026-12-28', '2026-12-30')).toBe(true); // borde inclusivo
    expect(rangosSeCruzan('2026-12-26', '2026-12-28', '2026-12-20', '2026-12-26')).toBe(true);
    expect(rangosSeCruzan('2026-12-26', '2026-12-28', '2027-01-10', '2027-01-12')).toBe(false);
    expect(rangosSeCruzan('2026-12-26', '2026-12-28', '2026-12-20', '2026-12-25')).toBe(false);
  });

  it('reserva de diciembre: bloquea 27-28 dic pero NO 10-12 ene', () => {
    expect(ordenCruzaRango(diciembre, '2026-12-27', '2026-12-28')).toBe(true);
    expect(ordenCruzaRango(diciembre, '2027-01-10', '2027-01-12')).toBe(false);
  });

  it('solo bloquean las ordenes CONFIRMED / ENTREGADO sin devolver', () => {
    expect(ordenCruzaRango(orden('2026-12-26', '2026-12-28', { checkin_entrega_at: new Date() }), '2026-12-27', '2026-12-27')).toBe(true);
    expect(ordenCruzaRango(orden('2026-12-26', '2026-12-28', { status: 'CANCELLED' }), '2026-12-27', '2026-12-27')).toBe(false);
    expect(ordenCruzaRango(orden('2026-12-26', '2026-12-28', { checkin_devolucion_at: new Date() }), '2026-12-27', '2026-12-27')).toBe(false);
  });

  it('catalogo v3: RESERVADO/LISTO/ENTREGADO se publican DISPONIBLE; EN_LIMPIEZA y EN_MANTENIMIENTO no', () => {
    expect(['RESERVADO', 'LISTO_PARA_ENTREGAR', 'ENTREGADO', 'DISPONIBLE'].map(estadoCatalogoV3)).toEqual(Array(4).fill('DISPONIBLE'));
    expect(estadoCatalogoV3('EN_LIMPIEZA')).toBe('EN_LIMPIEZA');
    expect(estadoCatalogoV3('EN_MANTENIMIENTO')).toBe('EN_MANTENIMIENTO');
    const card = (estado: string) => ({ vehicle_id: 'VEH-1001', precio_diario: 25, estado });
    expect(conStockV3({ data: [card('RESERVADO')] }).data[0]).toMatchObject({ estado: 'DISPONIBLE', status: 'DISPONIBLE', stock: 1, available_units: 1 });
    expect(conStockV3(card('EN_MANTENIMIENTO'))).toMatchObject({ status: 'EN_MANTENIMIENTO', available_units: 0 });
  });

  it('un auto RESERVADO / ENTREGADO globalmente se puede reservar por rango; mantenimiento no', () => {
    const pickup = new Date('2027-01-10T15:00:00Z');
    for (const status of ['AVAILABLE', 'RESERVED', 'READY_FOR_PICKUP', 'DELIVERED']) {
      expect(() => assertReservablePorRango({ vehicle_id: 'VEH-1001', status, wash_until: null } as any, pickup)).not.toThrow();
    }
    expect(() => assertReservablePorRango({ vehicle_id: 'VEH-1001', status: 'MAINTENANCE', wash_until: null } as any, pickup)).toThrow(HttpException);
    // Limpieza que termina antes de la recogida: reservable
    expect(() => assertReservablePorRango({ vehicle_id: 'VEH-1001', status: 'WASHING', wash_until: new Date('2027-01-10T12:00:00Z') } as any, pickup)).not.toThrow();
  });

  describe('GET /api/v3/autos/{id}/disponibilidad', () => {
    const svc = (activas: any[], status = 'RESERVED') => new CatalogoV2Service(
      { findOne: async () => ({ vehicle_id: 'VEH-1001', status, wash_until: null }) } as any,
      {} as any,
      { find: async () => activas } as any,
      { liberarCooldownsVencidos: async () => 0 } as any,
    );

    it('rango libre (enero) -> DISPONIBLE aunque el auto tenga la reserva de diciembre', async () => {
      const r = await svc([orden('2026-12-26', '2026-12-28')]).disponibilidad('VEH-1001', '2027-01-10', '2027-01-12');
      expect(r).toMatchObject({ disponible: true, estado: 'DISPONIBLE', available_units: 1 });
      expect(r.rangos_reservados).toEqual([{ pickup_date: '2026-12-26', dropoff_date: '2026-12-28', cruza: false }]);
    });

    it('rango que se cruza (27-28 dic) -> RESERVADO', async () => {
      const r = await svc([orden('2026-12-26', '2026-12-28')]).disponibilidad('VEH-1001', '2026-12-27', '2026-12-28');
      expect(r).toMatchObject({ disponible: false, estado: 'RESERVADO', available_units: 0 });
    });

    it('fechas invalidas -> 400 VALIDATION_FAILED (v3 lo traduce a 422 INVALID_DATES)', async () => {
      await expect(svc([]).disponibilidad('VEH-1001', '2027-01-12', '2027-01-10')).rejects.toThrow(HttpException);
      await expect(svc([]).disponibilidad('VEH-1001', 'manana', undefined)).rejects.toThrow(HttpException);
    });

    it('en mantenimiento -> EN_MANTENIMIENTO', async () => {
      const r = await svc([], 'MAINTENANCE').disponibilidad('VEH-1001', '2027-01-10', '2027-01-12');
      expect(r).toMatchObject({ disponible: false, estado: 'EN_MANTENIMIENTO' });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  AJUSTE 3 — pickup_date y dropoff_date en las ordenes
// ═══════════════════════════════════════════════════════════════════════════

describe('Ajuste 3: pickup_date / dropoff_date (YYYY-MM-DD) en las ordenes v3', () => {
  it('fechaDe usa toISOString().slice(0, 10)', () => {
    expect(fechaDe('2026-12-26T15:00:00.000Z')).toBe('2026-12-26');
    expect(fechaDe(null)).toBeNull();
    expect(fechaDe('basura')).toBeNull();
  });

  it('desde route_details de la orden y desde recogida/devolucion del DTO v2', () => {
    const o = orden('2026-12-26', '2026-12-28');
    expect(conFechasV3({ order_id: o.order_id }, o)).toMatchObject({ pickup_date: '2026-12-26', dropoff_date: '2026-12-28' });
    const dto = aOrdenV2(o, null);
    expect(conFechasV3(dto)).toMatchObject({ pickup_date: '2026-12-26', dropoff_date: '2026-12-28' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  AJUSTE 4 — X-API-Key obligatoria
// ═══════════════════════════════════════════════════════════════════════════

describe('Ajuste 4: X-API-Key obligatoria en /api/v3/autos/orders*, /autos/reservas* y /clientes*', () => {
  const app = express();
  app.use(apiKeyV3Middleware);
  app.all('*', (_req, res) => { res.json({ ok: true }); });

  beforeEach(() => captura(true));
  afterEach(() => captura(false));

  it('RENTAFACIL_API_KEY viene del entorno y solo esa (o API_KEY_INTERNAL) es valida', () => {
    expect(rentafacilApiKey()).toBe(CLAVE);
    expect(claveValidaV3(CLAVE)).toBe(true);
    expect(claveValidaV3('otra')).toBe(false);
    expect(claveValidaV3('')).toBe(false);
  });

  it.each([
    ['get', '/api/v3/autos/orders'], ['get', '/api/v3/autos/orders/RF34567890'], ['post', '/api/v3/autos/orders/create'],
    ['post', '/api/v3/autos/reservas'], ['post', '/api/v3/autos/orders/RF34567890/cancel'], ['get', '/api/v3/clientes?email=a@b.c'], ['post', '/api/v3/clientes'],
  ])('%s %s sin X-API-Key -> 401 MISSING_API_KEY', async (metodo, ruta) => {
    const r = await (request(app) as any)[metodo](ruta);
    expect(r.status).toBe(401);
    expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(r.body).toMatchObject({
      type: 'https://rentafacil.ec/errors/unauthorized', title: 'Unauthorized', status: 401,
      detail: 'X-API-Key missing or invalid', code: 'MISSING_API_KEY',
    });
  });

  it('X-API-Key incorrecta -> 401; correcta -> pasa y loguea sender=BOOKING', async () => {
    expect((await request(app).get('/api/v3/autos/orders').set('X-API-Key', 'mala')).status).toBe(401);
    const ok = await request(app).get('/api/v3/autos/orders').set('X-API-Key', CLAVE);
    expect(ok.status).toBe(200);
    const lineas = lineasCapturadas();
    expect(lineas.some((l) => /\[AUTH\] \/api\/v3\/autos\/orders -> OK sender=BOOKING/.test(l))).toBe(true);
    expect(lineas.some((l) => /\[AUTH\] \/api\/v3\/autos\/orders -> 401 MISSING_API_KEY/.test(l))).toBe(true);
  });

  it('el panel web con Authorization: Bearer pasa (lo valida V3AuthGuard)', async () => {
    expect((await request(app).get('/api/v3/autos/orders/buscar?q=RF').set('Authorization', 'Bearer x.y.z')).status).toBe(200);
  });

  it.each([
    '/api/v3/autos/health', '/api/v3/autos', '/api/v3/autos/VEH-1001', '/api/v3/autos/VEH-1001/coberturas', '/api/v3/autos/flota',
    '/api/v3/autos/promociones/contrato', '/api/v3/autos/eventos', '/api/v3/docs', '/api/v3/docs-json', '/api/v3/autos/VEH-1001/disponibilidad',
    '/api/v2/autos/orders', '/api/v1/orders', '/api/v2/autos/orders/RF1/cancel',
  ])('publica / compatibilidad: GET %s no exige X-API-Key', async (ruta) => {
    expect((await request(app).get(ruta)).status).toBe(200);
  });

  it('POST /api/v3/autos/search es publica', async () => {
    expect((await request(app).post('/api/v3/autos/search').send({})).status).toBe(200);
  });

  it('V3AuthGuard: una X-API-Key invalida responde 401 MISSING_API_KEY', () => {
    const guard = new V3AuthGuard({ verify: () => ({}) } as any, { getAllAndOverride: () => undefined } as any);
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-api-key': 'mala' }, originalUrl: '/api/v3/admin/vehicles' }) }), getHandler: () => null, getClass: () => null } as any;
    try { guard.canActivate(ctx); fail('debio lanzar'); } catch (e: any) {
      expect(e.getStatus()).toBe(401);
      expect(e.getResponse()).toMatchObject({ code: 'MISSING_API_KEY', type: 'https://rentafacil.ec/errors/unauthorized' });
    }
    const okCtx = { switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-api-key': CLAVE }, originalUrl: '/x' }) }), getHandler: () => null, getClass: () => null } as any;
    expect(guard.canActivate(okCtx)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  AJUSTES 5 y 7 — ReservasV3Service con dependencias simuladas
// ═══════════════════════════════════════════════════════════════════════════

function servicioV3(o: any) {
  const v2 = {
    buscarOrden: jest.fn().mockResolvedValue(o),
    cancelar: jest.fn().mockImplementation(async (id: string) => ({ order_id: id, pnr: o.locator, status: 'CANCELLED', auto_id: o.vehicle_id })),
    checkinEntrega: jest.fn().mockResolvedValue({ success: true, order_id: o.order_id, pnr: o.locator, estado_orden: 'ENTREGADO', estado_vehiculo: 'ENTREGADO', km_salida: 150, licencia_verificada: 'L1' }),
  };
  const orders = {
    findOneByOrFail: jest.fn().mockResolvedValue(o),
    findOne: jest.fn().mockResolvedValue(o),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const notificador = { notificarCheckin: jest.fn().mockResolvedValue({ id: 'n1', url: `https://booking.test/api/v3/reservas/${o.locator}/checkin` }), deOrden: jest.fn() };
  const svc = new ReservasV3Service(v2 as any, {} as any, notificador as any, orders as any, {} as any, { insert: jest.fn().mockResolvedValue({}) } as any);
  return { svc, v2, orders, notificador };
}
const ctxB2B = (idempotencyKey = '') => ({ auth: { sub: 'b2b:booking-prototipo', rol: 'B2B', scopes: [] }, idempotencyKey, correlationId: 'booking-1', origen: 'BOOKING' }) as any;

describe('Ajuste 1 + 3 (servicio): cancel sin Idempotency-Key usa la clave pnr+fecha y responde con fechas', () => {
  it('sin cabecera -> v2.cancelar recibe la clave derivada; con cabecera -> la del cliente', async () => {
    const o = orden('2026-12-26', '2026-12-28', { locator: 'RF34567890' });
    const { svc, v2 } = servicioV3(o);
    const r = await svc.cancelar('RF34567890', { reason: 'prueba sin idempotency' }, ctxB2B());
    expect(v2.cancelar).toHaveBeenCalledWith(o.order_id, { reason: 'prueba sin idempotency' }, expect.objectContaining({ idempotencyKey: claveCancelacionDerivada('RF34567890') }), { porRango: true });
    expect(r).toMatchObject({ status: 'CANCELLED', pnr: 'RF34567890', pickup_date: '2026-12-26', dropoff_date: '2026-12-28' });

    const propia = randomUUID();
    await svc.cancelar('RF34567890', { reason: 'x' }, ctxB2B(propia));
    expect(v2.cancelar).toHaveBeenLastCalledWith(o.order_id, { reason: 'x' }, expect.objectContaining({ idempotencyKey: propia }), { porRango: true });
  });
});

describe('Ajuste 5: checkin-entrega deja status CONFIRMADO_ASISTIDO en /api/v3', () => {
  it('respuesta v3 con status CONFIRMADO_ASISTIDO + fechas; v2 se invoca en modo porRango', async () => {
    const o = orden('2026-12-26', '2026-12-28', { locator: 'RF34567890', checkin_entrega_at: new Date('2026-12-26T15:05:00Z') });
    const { svc, v2 } = servicioV3(o);
    const r = await svc.checkinEntrega('RF34567890', { licencia_conducir: 'L1', km_salida: 150, acepta_contrato: true }, ctxB2B(randomUUID()));
    expect(v2.checkinEntrega).toHaveBeenCalledWith('RF34567890', expect.any(Object), expect.any(Object), { porRango: true });
    expect(r).toMatchObject({ status: 'CONFIRMADO_ASISTIDO', estado_orden: 'CONFIRMADO_ASISTIDO', estado_vehiculo: 'ENTREGADO', pickup_date: '2026-12-26', dropoff_date: '2026-12-28' });
  });

  it('mapeo: ENTREGADO interno -> CONFIRMADO_ASISTIDO en v3; v2 (aOrdenV2) sigue con ENTREGADO', () => {
    const o = orden('2026-12-26', '2026-12-28', { checkin_entrega_at: new Date() });
    const dtoV2 = aOrdenV2(o, null);
    expect(dtoV2.status).toBe('ENTREGADO');
    expect(conFechasV3(dtoV2)).toMatchObject({ status: 'CONFIRMADO_ASISTIDO', estado: 'CONFIRMADO_ASISTIDO' });
    expect(statusV3('CONFIRMED')).toBe('CONFIRMED');
  });
});

describe('Ajuste 7: cancelar una orden ya entregada -> 409 ORDER_ALREADY_DELIVERED', () => {
  it('con checkin_entrega_at -> 409 con el ProblemDetails exacto y sin tocar v2.cancelar', async () => {
    const o = orden('2026-12-26', '2026-12-28', { locator: 'RF34567890', checkin_entrega_at: new Date() });
    const { svc, v2 } = servicioV3(o);
    try { await svc.cancelar('RF34567890', { reason: 'tarde' }, ctxB2B()); fail('debio lanzar'); } catch (e: any) {
      expect(e).toBeInstanceOf(HttpException);
      expect(e.getStatus()).toBe(409);
      expect(e.getResponse()).toEqual({
        type: 'https://rentafacil.ec/errors/order-already-delivered', title: 'Order already delivered', status: 409,
        detail: 'La orden RF34567890 ya fue entregada al cliente y no puede cancelarse', code: 'ORDER_ALREADY_DELIVERED',
      });
    }
    expect(v2.cancelar).not.toHaveBeenCalled();
  });

  it('sin checkin_entrega_at -> procede la cancelacion', async () => {
    const o = orden('2026-12-26', '2026-12-28', { locator: 'RF34567890' });
    const { svc, v2 } = servicioV3(o);
    await expect(svc.cancelar('RF34567890', { reason: 'ok' }, ctxB2B())).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(v2.cancelar).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  AJUSTE 6 — notificacion a Booking con el PNR como external_order_id
// ═══════════════════════════════════════════════════════════════════════════

describe('Ajuste 6: la notificacion de check-in usa el PNR (RF...) y nunca el order_id UUID', () => {
  afterEach(() => { usarFetch((i, o) => fetch(i, o)); delete process.env.BOOKING_CHECKIN_URL; captura(false); });

  it('URL /reservas/<PNR>/checkin y body.external_order_id = PNR; log "POST /reservas/<PNR>/checkin -> 200 OK"', async () => {
    process.env.BOOKING_CHECKIN_URL = 'https://booking-core-api.azurewebsites.net/api/v3/reservas';
    captura(true);
    const filas = new Map<string, any>();
    const repo = {
      create: (x: any) => ({ ...x }),
      save: async (x: any) => { const f = { id: randomUUID(), created_at: new Date(), ...x }; filas.set(f.id, f); return f; },
      update: async (w: any, c: any) => { Object.assign(filas.get(w.id) ?? {}, c); return { affected: 1 }; },
    };
    const llamadas: { url: string; body: any }[] = [];
    usarFetch(async (url: any, init: any) => {
      llamadas.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ acknowledged: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const svc = new BookingNotifierService(repo as any, { registrar: jest.fn().mockResolvedValue({}) } as any);
    const orderId = randomUUID();
    const n = await svc.notificarCheckin({ order_id: orderId, pnr: 'RF34567890', client_id: 'c-1', admin_id: 'admin@rentafacil.ec', fecha_checkin: new Date('2026-12-26T15:05:00Z'), correlationId: 'c' });
    for (let i = 0; i < 50 && !llamadas.length; i++) await new Promise((r) => setTimeout(r, 10));
    await new Promise((r) => setTimeout(r, 30));
    svc.onModuleDestroy();

    expect(n!.url).toBe('https://booking-core-api.azurewebsites.net/api/v3/reservas/RF34567890/checkin');
    expect(llamadas[0].url).toBe('https://booking-core-api.azurewebsites.net/api/v3/reservas/RF34567890/checkin');
    expect(llamadas[0].body).toMatchObject({ external_order_id: 'RF34567890', estado: 'CONFIRMADO_ASISTIDO', client_id: 'c-1', admin_id: 'admin@rentafacil.ec', fecha_checkin: '2026-12-26T15:05:00.000Z' });
    expect(JSON.stringify(llamadas[0])).not.toContain(orderId);
    expect(lineasCapturadas().some((l) => l.includes('[BOOKING-NOTIFY] POST /reservas/RF34567890/checkin -> 200 OK'))).toBe(true);
  });
});

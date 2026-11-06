import { randomUUID } from 'crypto';
import { BACKOFF_MS, BookingNotifierService, etiquetaEspera } from '../../src/modules/autos-v3/booking-notifier.service';
import { usarFetch } from '../../src/common/http-saliente';
import { captura, lineasCapturadas } from '../../src/common/app-logger';

/** Repositorio en memoria con la API minima que usa el notificador. */
function repoFalso() {
  const filas = new Map<string, any>();
  return {
    filas,
    create: (x: any) => ({ ...x }),
    save: async (x: any) => { const f = { id: x.id ?? randomUUID(), created_at: new Date(), ...x }; filas.set(f.id, f); return f; },
    update: async (where: any, cambios: any) => { const f = filas.get(where.id); if (f) Object.assign(f, cambios); return { affected: f ? 1 : 0 }; },
    find: async () => [...filas.values()].filter((f) => f.status === 'PENDING' && f.next_attempt_at && f.next_attempt_at <= new Date()),
    count: async () => [...filas.values()].filter((f) => f.status === 'PENDING').length,
    findOne: async ({ where }: any) => [...filas.values()].find((f) => f.order_id === where.order_id) ?? null,
  };
}

const respuesta = (status: number, body: any) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('BookingNotifierService (fire-and-forget del check-in al Booking central)', () => {
  let repo: ReturnType<typeof repoFalso>;
  let outbox: { registrar: jest.Mock };
  let svc: BookingNotifierService;
  let llamadas: { url: string; init: any }[];
  const datos = () => ({
    order_id: randomUUID(), pnr: 'RFABC123', client_id: randomUUID(), admin_id: 'admin@rentafacil.ec',
    fecha_checkin: new Date('2026-11-10T15:00:00Z'), correlationId: 'booking-corr-123',
  });

  beforeEach(() => {
    process.env.BOOKING_CHECKIN_URL = 'https://booking.test/api/v3/reservas';
    process.env.BOOKING_API_KEY = 'clave-del-profesor';
    repo = repoFalso();
    outbox = { registrar: jest.fn().mockResolvedValue({}) };
    svc = new BookingNotifierService(repo as any, outbox as any);
    llamadas = [];
    captura(true);
  });
  afterEach(() => {
    svc.onModuleDestroy();
    usarFetch((i, o) => fetch(i, o));
    delete process.env.BOOKING_CHECKIN_URL;
    delete process.env.BOOKING_API_KEY;
    captura(false);
  });

  const mockFetch = (fn: () => Response | Promise<Response>) => usarFetch(async (url: any, init: any) => { llamadas.push({ url: String(url), init }); return fn(); });
  const esperarIntento = async (n: number) => { for (let i = 0; i < 50 && llamadas.length < n; i++) await new Promise((r) => setTimeout(r, 10)); await new Promise((r) => setTimeout(r, 20)); };

  it('arma el cuerpo exacto del requerimiento v3.1', () => {
    const d = datos();
    expect(BookingNotifierService.cuerpo(d)).toEqual({
      external_order_id: 'RFABC123', client_id: d.client_id, estado: 'CONFIRMADO_ASISTIDO', admin_id: 'admin@rentafacil.ec',
      fecha_checkin: '2026-11-10T15:00:00.000Z', observaciones: 'Vehiculo entregado fisicamente con contrato y licencia validada',
    });
  });

  it('POST a {BOOKING_CHECKIN_URL}/{pnr}/checkin con X-API-Key y el mismo X-Correlation-Id; 200 + acknowledged -> SENT', async () => {
    mockFetch(() => respuesta(200, { acknowledged: true, status: 'CONFIRMADO_ASISTIDO' }));
    const n = await svc.notificarCheckin(datos());
    await esperarIntento(1);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toBe('https://booking.test/api/v3/reservas/RFABC123/checkin');
    expect(llamadas[0].init.method).toBe('POST');
    expect(llamadas[0].init.headers['X-API-Key']).toBe('clave-del-profesor');
    expect(llamadas[0].init.headers['X-Correlation-Id']).toBe('booking-corr-123');
    expect(JSON.parse(llamadas[0].init.body).estado).toBe('CONFIRMADO_ASISTIDO');
    expect(repo.filas.get(n!.id).status).toBe('SENT');
    expect(outbox.registrar).toHaveBeenCalledWith(null, 'auto.checkin.notified', expect.objectContaining({ resultado: 'success', http_status: 200 }), expect.anything());
    expect(lineasCapturadas().some((l) => /\[BOOKING-NOTIFY\] POST \/reservas\/RFABC123\/checkin -> 200 OK \| correlation=booking-corr-123/.test(l))).toBe(true);
  });

  it('un 5xx no lanza: deja PENDING con retry_in=1s, guarda el codigo y emite auto.checkin.notified failed', async () => {
    mockFetch(() => respuesta(504, { error: 'gateway timeout' }));
    const n = await svc.notificarCheckin(datos());
    expect(n).not.toBeNull();
    await esperarIntento(1);
    const fila = repo.filas.get(n!.id);
    expect(fila.status).toBe('PENDING');
    expect(fila.attempts).toBe(1);
    expect(fila.last_status_code).toBe(504);
    expect(fila.next_attempt_at.getTime() - Date.now()).toBeLessThanOrEqual(1_000);
    expect(lineasCapturadas().some((l) => l.includes('-> ERROR 504 | retry_in=1s'))).toBe(true);
    for (let i = 0; i < 100 && !outbox.registrar.mock.calls.length; i++) await new Promise((r) => setTimeout(r, 10));
    expect(outbox.registrar).toHaveBeenCalledWith(null, 'auto.checkin.notified', expect.objectContaining({ resultado: 'failed', reintentara: true }), expect.anything());
  });

  it('200 sin acknowledged=true cuenta como fallo (se reintenta)', async () => {
    mockFetch(() => respuesta(200, { ok: true }));
    const n = await svc.notificarCheckin(datos());
    await esperarIntento(1);
    expect(repo.filas.get(n!.id).status).toBe('PENDING');
  });

  it('backoff exponencial 1 s, 5 s, 15 s, 1 min, 5 min y luego FAILED', async () => {
    expect(BACKOFF_MS).toEqual([1_000, 5_000, 15_000, 60_000, 300_000]);
    expect(BACKOFF_MS.map(etiquetaEspera)).toEqual(['1s', '5s', '15s', '1min', '5min']);
    mockFetch(() => respuesta(503, {}));
    const n = (await repo.save({ tipo: 'CHECKIN_ENTREGA', order_id: randomUUID(), external_order_id: 'RFX', url: 'https://booking.test/x', payload: {}, correlation_id: 'c', status: 'PENDING', attempts: 0 }));
    const esperas: number[] = [];
    for (let i = 0; i < 6; i++) {
      const antes = Date.now();
      const r = await svc.intentar(repo.filas.get(n.id));
      const f = repo.filas.get(n.id);
      if (r === 'RETRY') esperas.push(Math.round((f.next_attempt_at.getTime() - antes) / 1000));
      else expect(r).toBe('FAILED');
    }
    expect(esperas).toEqual([1, 5, 15, 60, 300]);
    expect(repo.filas.get(n.id).status).toBe('FAILED');
    expect(repo.filas.get(n.id).attempts).toBe(6);
  });

  it('timeout o red caida -> error controlado (el check-in local nunca falla)', async () => {
    usarFetch(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); });
    const n = await svc.notificarCheckin(datos());
    await new Promise((r) => setTimeout(r, 60));
    const f = repo.filas.get(n!.id);
    expect(f.status).toBe('PENDING');
    expect(f.last_status_code).toBe(504);
  });

  it('el worker reintenta las notificaciones vencidas', async () => {
    mockFetch(() => respuesta(200, { acknowledged: true }));
    const n = await repo.save({ tipo: 'CHECKIN_ENTREGA', order_id: randomUUID(), external_order_id: 'RFW', url: 'https://booking.test/w', payload: {}, correlation_id: 'c', status: 'PENDING', attempts: 1, next_attempt_at: new Date(Date.now() - 1000) });
    expect(await svc.procesarPendientes()).toBe(1);
    expect(repo.filas.get(n.id).status).toBe('SENT');
  });

  it('sin BOOKING_CHECKIN_URL ni BOOKING_BASE_URL responde null (NOT_CONFIGURED) sin llamar', async () => {
    delete process.env.BOOKING_CHECKIN_URL;
    mockFetch(() => respuesta(200, {}));
    expect(await svc.notificarCheckin(datos())).toBeNull();
    expect(llamadas).toHaveLength(0);
    expect(svc.estado.configurado).toBe(false);
  });

  it('usa BOOKING_BASE_URL + /reservas si no hay BOOKING_CHECKIN_URL', () => {
    delete process.env.BOOKING_CHECKIN_URL;
    process.env.BOOKING_BASE_URL = 'https://booking-core-api.azurewebsites.net/api/v3/';
    expect(svc.baseUrl).toBe('https://booking-core-api.azurewebsites.net/api/v3/reservas');
    delete process.env.BOOKING_BASE_URL;
  });

  it('con BOOKING_API_KEY pendiente no envia una X-API-Key falsa', async () => {
    process.env.BOOKING_API_KEY = 'PENDIENTE_ME_LA_DARA_EL_PROFESOR';
    mockFetch(() => respuesta(200, { acknowledged: true }));
    await svc.notificarCheckin(datos());
    await esperarIntento(1);
    expect(llamadas[0].init.headers['X-API-Key']).toBeUndefined();
  });
});

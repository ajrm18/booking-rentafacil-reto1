import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { captura, formatearLinea, lineasCapturadas, log, marcaTiempo } from '../../src/common/app-logger';
import { correlationMiddleware } from '../../src/common/correlation';
import { claveConfigurada, httpSaliente, usarFetch } from '../../src/common/http-saliente';
import { conCorrelacion, correlationActual } from '../../src/common/request-context';
import { V3AuthGuard } from '../../src/common/guards/v3-auth.guard';
import { origenDe } from '../../src/modules/clientes/clientes.controller';
import { ClientesService, normEmail, normIdentificacion } from '../../src/modules/clientes/clientes.service';

const LINEA = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[(INFO|WARN|ERROR)\] \[[A-Z-]+\] .+/;

describe('Logs estructurados con timestamp', () => {
  afterEach(() => captura(false));

  it('formato [YYYY-MM-DD HH:mm:ss.SSS] [NIVEL] [MODULO] mensaje | k=v', () => {
    const l = formatearLinea('INFO', 'CLIENTES', 'GET email=x -> FOUND', { status: 200 }, new Date('2026-11-10T09:05:03.007Z'));
    expect(l).toBe('[2026-11-10 09:05:03.007] [INFO] [CLIENTES] GET email=x -> FOUND | status=200');
    expect(marcaTiempo(new Date('2026-01-02T03:04:05.006Z'))).toBe('2026-01-02 03:04:05.006');
  });

  it('agrega el correlation id del contexto de la peticion', () => {
    captura(true);
    conCorrelacion('booking-abc', () => log.info('RESERVAS', 'POST /orders/create vehicle_id=V -> PNR=RF1 | 201'));
    const [l] = lineasCapturadas();
    expect(l).toMatch(LINEA);
    expect(l.endsWith('correlation=booking-abc')).toBe(true);
  });

  it('niveles WARN y ERROR', () => {
    captura(true);
    log.warn('BOOKING-NOTIFY', 'x');
    log.error('DB', 'y');
    expect(lineasCapturadas().map((l) => l.match(/\] \[(\w+)\] \[/)![1])).toEqual(['WARN', 'ERROR']);
  });
});

describe('X-Correlation-Id end-to-end', () => {
  const ejecutar = (headers: Record<string, string>) => new Promise<{ id: string; enContexto: string | undefined; respuesta: string }>((resolve) => {
    const req: any = { headers, method: 'GET', originalUrl: '/api/v3/health' };
    const res: any = { cabeceras: {} as Record<string, string>, setHeader(k: string, v: string) { this.cabeceras[k] = v; } };
    correlationMiddleware(req, res, () => resolve({ id: req.correlationId, enContexto: correlationActual(), respuesta: res.cabeceras['X-Correlation-Id'] }));
  });

  it('respeta el que llega, lo deja en el contexto y en la cabecera de respuesta', async () => {
    const r = await ejecutar({ 'x-correlation-id': 'booking-123' });
    expect(r).toEqual({ id: 'booking-123', enContexto: 'booking-123', respuesta: 'booking-123' });
  });

  it('si no llega, genera un UUID v4', async () => {
    const r = await ejecutar({});
    expect(r.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(r.respuesta).toBe(r.id);
  });

  it('las llamadas HTTP salientes reenvian el X-Correlation-Id del contexto', async () => {
    let enviada: any;
    usarFetch(async (_u: any, init: any) => { enviada = init.headers; return new Response('{"ok":true}', { status: 200 }); });
    try {
      const r = await conCorrelacion('corr-saliente-1', () => httpSaliente('https://booking.test/x', { body: { a: 1 } }));
      expect(r).toMatchObject({ status: 200, ok: true, body: { ok: true } });
      expect(enviada['X-Correlation-Id']).toBe('corr-saliente-1');
    } finally {
      usarFetch((i, o) => fetch(i, o));
    }
  });

  it('timeout de la llamada saliente -> error 504', async () => {
    usarFetch(((_u: any, init: any) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('a'), { name: 'AbortError' }))))) as any);
    try {
      await expect(httpSaliente('https://booking.test/lento', { timeoutMs: 30 })).rejects.toMatchObject({ status: 504 });
    } finally {
      usarFetch((i, o) => fetch(i, o));
    }
  });
});

describe('X-API-Key y tolerancia del contrato v3', () => {
  const jwt = new JwtService({ secret: 'test-secret' });
  const guard = new V3AuthGuard(jwt, new Reflector());
  const autenticar = (headers: Record<string, string>, tolerante = false) => (guard as any).autenticar({ headers, originalUrl: '/api/v3/x' }, tolerante);

  afterEach(() => { delete process.env.BOOKING_API_KEY; delete process.env.API_KEY_INTERNAL; });

  it('clave "PENDIENTE..." cuenta como no configurada', () => {
    expect(claveConfigurada('PENDIENTE_ME_LA_DARA_EL_PROFESOR')).toBeNull();
    expect(claveConfigurada('')).toBeNull();
    expect(claveConfigurada(' abc ')).toBe('abc');
  });

  it('X-API-Key valida (BOOKING_API_KEY o API_KEY_INTERNAL) -> B2B; invalida -> 401', () => {
    process.env.BOOKING_API_KEY = 'k-booking';
    process.env.API_KEY_INTERNAL = 'k-interna';
    expect(autenticar({ 'x-api-key': 'k-booking' }).rol).toBe('B2B');
    expect(autenticar({ 'x-api-key': 'k-interna' }).rol).toBe('B2B');
    expect(() => autenticar({ 'x-api-key': 'otra' })).toThrow();
  });

  it('con la clave del profesor pendiente acepta la X-API-Key que envie el Booking', () => {
    process.env.BOOKING_API_KEY = 'PENDIENTE_ME_LA_DARA_EL_PROFESOR';
    expect(autenticar({ 'x-api-key': 'lo-que-sea' }).rol).toBe('B2B');
  });

  it('sin credenciales: 401 salvo en endpoints tolerantes (B2B con WARN)', () => {
    expect(() => autenticar({})).toThrow();
    captura(true);
    expect(autenticar({}, true).rol).toBe('B2B');
    expect(lineasCapturadas().some((l) => l.includes('[WARN] [AUTH]'))).toBe(true);
    captura(false);
  });

  it('Bearer JWT -> rol del token', () => {
    const token = jwt.sign({ sub: 'admin@rentafacil.ec', role: 'admin' });
    expect(autenticar({ authorization: `Bearer ${token}` })).toMatchObject({ sub: 'admin@rentafacil.ec', rol: 'ADMIN' });
  });
});

describe('Clientes cross-platform: normalizacion, validacion y origen', () => {
  const svc = new ClientesService({} as any);

  it('normaliza email y cedula', () => {
    expect(normEmail('  Juan@Example.COM ')).toBe('juan@example.com');
    expect(normIdentificacion('171-003 4065')).toBe('1710034065');
  });

  it('valida email y exige identificacion (422 INVALID_PAYLOAD en v3)', () => {
    expect(() => svc.validar({ nombre: 'Juan', email: 'no-es-email', identificacion: '1710034065' })).toThrow();
    expect(() => svc.validar({ nombre: 'Juan', email: 'j@x.com', identificacion: '' })).toThrow();
    expect(svc.validar({ nombre: ' Juan Perez ', email: 'J@X.com', identificacion: '1710034065' })).toMatchObject({ nombre: 'Juan Perez', email: 'j@x.com' });
  });

  const req = (headers: Record<string, string>, extra: any = {}) => ({ headers, correlationId: headers['x-correlation-id'], ...extra }) as any;
  it('origen BOOKING si X-Correlation-Id empieza con booking- o X-Source: BOOKING; si no WEB', () => {
    expect(origenDe(req({ 'x-correlation-id': 'booking-123' }))).toBe('BOOKING');
    expect(origenDe(req({ 'x-source': 'booking' }))).toBe('BOOKING');
    expect(origenDe(req({ 'x-api-key': 'k' }, { authV2: { rol: 'B2B' } }))).toBe('BOOKING');
    expect(origenDe(req({ 'x-correlation-id': 'web-1' }))).toBe('WEB');
  });
});

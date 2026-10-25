import { HealthV2Service } from '../../src/modules/autos-v2/health-v2.service';

/** HealthV2Service con BD, bus y cliente gRPC simulados. */
function servicio(opts: { fila?: any; demoraMs?: number; falla?: boolean; bus?: string; circuito?: string } = {}) {
  const ds = {
    query: jest.fn(() => new Promise((resolve, reject) => setTimeout(() => (opts.falla
      ? reject(new Error('ECONNREFUSED'))
      : resolve([opts.fila ?? { total: 10, cooldown: 2, pendientes: 0 }])), opts.demoraMs ?? 5))),
  };
  const bus = { estado: opts.bus ?? 'DISABLED', asegurarConexion: jest.fn(async () => undefined) };
  const push = { circuito: opts.circuito ?? 'CLOSED', configurado: false };
  return new HealthV2Service(ds as any, bus as any, push as any);
}

describe('GET /api/v2/autos/health (HealthV2Service)', () => {
  it('responde en < 500 ms con los campos exactos que valida el Booking central', async () => {
    const t0 = Date.now();
    const h = await servicio().estado();
    expect(Date.now() - t0).toBeLessThan(500);
    expect(h).toMatchObject({
      status: 'HEALTHY',
      nodo_id: 'NODE_AUT_RENTAFACIL',
      nombre_proveedor: 'RentaFacil EC',
      vertical: 'AUTOS',
      version: '2.0.0',
      circuit_breaker_estado: 'CLOSED',
      total_vehiculos: 10,
    });
    expect(Number.isInteger(h.uptime_seconds)).toBe(true);
    expect(Number.isInteger(h.latencia_ms)).toBe(true);
    expect(Date.parse(h.timestamp)).not.toBeNaN();
  });

  it('refleja cooldown_activo_count (vehiculos EN_LIMPIEZA con cooldown vigente)', async () => {
    const h = await servicio({ fila: { total: 12, cooldown: 3, pendientes: 4 } }).estado();
    expect(h.cooldown_activo_count).toBe(3);
    expect(h.outbox_pendientes).toBe(4);
  });

  it('BD lenta: corta a los 400 ms y responde DOWN igualmente en < 500 ms', async () => {
    const t0 = Date.now();
    const h = await servicio({ demoraMs: 2000 }).estado();
    expect(Date.now() - t0).toBeLessThan(500);
    expect(h.status).toBe('DOWN');
    expect(h.dependencias.base_datos).toBe('DOWN');
  });

  it('DOWN si la BD falla o no hay vehiculos cargados', async () => {
    expect((await servicio({ falla: true }).estado()).status).toBe('DOWN');
    expect((await servicio({ fila: { total: 0, cooldown: 0, pendientes: 0 } }).estado()).status).toBe('DOWN');
  });

  it('DEGRADED si RabbitMQ esta configurado pero caido, o el circuito gRPC esta abierto', async () => {
    expect((await servicio({ bus: 'DISCONNECTED' }).estado()).status).toBe('DEGRADED');
    expect((await servicio({ circuito: 'OPEN' }).estado()).status).toBe('DEGRADED');
  });

  it('HEALTHY con RabbitMQ deshabilitado a proposito (modo degradado documentado en event_bus_modo)', async () => {
    const h = await servicio({ bus: 'DISABLED' }).estado();
    expect(h.status).toBe('HEALTHY');
    expect(h.dependencias.rabbitmq).toBe('DISABLED');
    expect(h.event_bus_modo).toContain('LOG_ONLY');
  });
});

import { getMetadataArgsStorage } from 'typeorm';
import { Order } from '../../src/modules/autos/entities/order.entity';
import { aV3, conStockV3, detectarTipo, estadoMostrador, traducirProblemaV3 } from '../../src/modules/autos-v3/v3';
import { ESQUEMAS, LISTA_ESQUEMAS } from '../../src/common/schemas';
import { requiereSsl, urlBaseDatos } from '../../src/common/database';
import { normalizarEstado, aEstadoV2, unidadesDisponibles } from '../../src/modules/autos/estado-vehiculo.mapper';
import { normalizarCobertura } from '../../src/modules/autos-v2/reglas';
// Importa todas las entidades para que registren su metadata
import '../../src/modules/autos/entities/depot.entity';
import '../../src/modules/autos/entities/supplier.entity';
import '../../src/modules/autos/entities/vehicle.entity';
import '../../src/modules/autos/entities/vehicle-image.entity';
import '../../src/modules/autos/entities/hold.entity';
import '../../src/modules/autos/entities/order-preview.entity';
import '../../src/modules/autos/entities/user.entity';
import '../../src/modules/autos/entities/webhook.entity';
import '../../src/modules/autos-v2/entities/contrato-promociones.entity';
import '../../src/modules/autos-v2/entities/mantenimiento-log.entity';
import '../../src/modules/integracion/entities/idempotency-record.entity';
import '../../src/modules/integracion/entities/outbox-event.entity';
import '../../src/modules/integracion/entities/grpc-log.entity';
import '../../src/modules/clientes/cliente.entity';
import '../../src/modules/autos-v3/entities/booking-notification.entity';
import '../../src/modules/autos-v3/entities/checkin.entity';

describe('Database-per-Service: cada entidad apunta a su esquema', () => {
  const esperado: Record<string, string> = {
    users: 'db_identity', clientes: 'db_identity',
    vehicles: 'db_catalog', vehicle_images: 'db_catalog', depots: 'db_catalog', suppliers: 'db_catalog',
    grpc_log: 'db_inventory',
    holds: 'db_orders', order_previews: 'db_orders', orders: 'db_orders', idempotency_records: 'db_orders',
    checkins: 'db_counter',
    mantenimiento_log: 'db_maintenance',
    contrato_promociones_b2b: 'db_pricing',
    outbox_events: 'db_outbox', outbox_booking_notifications: 'db_outbox',
    webhook_subscriptions: 'db_webhooks',
  };
  const tablas = getMetadataArgsStorage().tables;

  it.each(Object.entries(esperado))('%s -> %s', (tabla, esquema) => {
    const t = tablas.find((x) => x.name === tabla);
    expect(t).toBeDefined();
    expect(t!.schema).toBe(esquema);
  });

  it('ninguna entidad queda en el schema public', () => {
    for (const t of tablas.filter((x) => x.name)) expect(LISTA_ESQUEMAS).toContain(t.schema);
  });

  it('declara los 9 esquemas de la catedra', () => {
    expect(LISTA_ESQUEMAS).toEqual(['db_identity', 'db_catalog', 'db_inventory', 'db_orders', 'db_counter', 'db_maintenance', 'db_pricing', 'db_outbox', 'db_webhooks']);
    expect(ESQUEMAS.IDENTITY).toBe('db_identity');
  });

  it('orders tiene fk_cliente (id logico, sin FK fisica entre esquemas)', () => {
    const col = getMetadataArgsStorage().columns.find((c) => c.target === Order && c.propertyName === 'fk_cliente');
    expect(col?.options.type).toBe('uuid');
    expect(getMetadataArgsStorage().relations.some((r) => r.target === Order)).toBe(false);
  });
});

describe('Conexion Supabase / DATABASE_URL', () => {
  it('SUPABASE_URL tiene prioridad y DATABASE_URL es el respaldo', () => {
    const env: Record<string, string> = { SUPABASE_URL: 'postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:5432/postgres', DATABASE_URL: 'postgres://x@localhost/db' };
    expect(urlBaseDatos((k) => env[k])).toContain('supabase.com');
    expect(urlBaseDatos((k) => ({ DATABASE_URL: 'postgres://x@localhost/db' } as any)[k])).toBe('postgres://x@localhost/db');
    // DATABASE_URL=${SUPABASE_URL} sin expandir no se usa como URL
    expect(urlBaseDatos((k) => ({ SUPABASE_URL: '${X}', DATABASE_URL: 'postgres://x@localhost/db' } as any)[k])).toBe('postgres://x@localhost/db');
  });

  it('TLS en Supabase/Neon, sin TLS en Docker local', () => {
    expect(requiereSsl('postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:5432/postgres')).toBe(true);
    expect(requiereSsl('postgres://u:p@ep-x.neon.tech/db')).toBe(true);
    expect(requiereSsl('postgres://postgres:postgres@localhost:5433/rentafacil', 'production')).toBe(false);
    expect(requiereSsl('postgres://u:p@db.interno:5432/x', 'production')).toBe(true);
  });
});

describe('Errores canonicos del contrato v3 (RFC 7807)', () => {
  const t = (code: string, status: number, extra: any = {}) => traducirProblemaV3({ code, status, title: 'x', detail: 'd', ...extra }, status);

  it('409 que activan Saga: VEHICLE_UNAVAILABLE, OUT_OF_STOCK, VEHICLE_IN_CLEANING_COOLDOWN', () => {
    expect(t('VEHICLE_NOT_AVAILABLE', 409)).toMatchObject({ status: 409, body: { code: 'VEHICLE_UNAVAILABLE', legacy_code: 'VEHICLE_NOT_AVAILABLE' } });
    expect(t('VEHICLE_IN_CLEANING_COOLDOWN', 409).body.code).toBe('VEHICLE_IN_CLEANING_COOLDOWN');
    expect(t('OUT_OF_STOCK', 409).status).toBe(409);
    expect(t('VEHICLE_NOT_AVAILABLE', 409).body.type).toBe('https://booking.epn.edu.ec/errors/vehicle-unavailable');
  });

  it('422 semanticos (sin Saga): DRIVER_UNDERAGE, INVALID_DATES, INVALID_PAYLOAD', () => {
    expect(t('DRIVER_AGE_RESTRICTION', 422)).toMatchObject({ status: 422, body: { code: 'DRIVER_UNDERAGE' } });
    expect(t('VALIDATION_FAILED', 400, { invalid_params: [{ name: 'pickup_date', reason: 'x' }] })).toMatchObject({ status: 422, body: { code: 'INVALID_DATES' } });
    expect(t('VALIDATION_FAILED', 400, { invalid_params: [{ name: 'driver.email', reason: 'x' }] })).toMatchObject({ status: 422, body: { code: 'INVALID_PAYLOAD' } });
  });

  it('400 de sintaxis: MALFORMED_REQUEST e IDEMPOTENCY_CONFLICT (nunca 409, para no disparar la Saga)', () => {
    expect(t('IDEMPOTENCY_KEY_REUSED', 409)).toMatchObject({ status: 400, body: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(t('IDEMPOTENCY_KEY_REQUIRED', 400)).toMatchObject({ status: 400, body: { code: 'MALFORMED_REQUEST' } });
    expect(traducirProblemaV3({ status: 400 }, 400)).toMatchObject({ status: 400, body: { code: 'MALFORMED_REQUEST' } });
  });

  it('otros codigos pasan sin cambios', () => {
    expect(t('ORDER_NOT_FOUND', 404)).toMatchObject({ status: 404, body: { code: 'ORDER_NOT_FOUND' } });
  });
});

describe('Buscador del mostrador y estados visuales', () => {
  it('detecta el tipo: @ -> email, 10 digitos -> cedula, resto -> PNR', () => {
    expect(detectarTipo('juan@example.com')).toBe('EMAIL');
    expect(detectarTipo('1710034065')).toBe('IDENTIFICACION');
    expect(detectarTipo(' 1710034065 ')).toBe('IDENTIFICACION');
    expect(detectarTipo('RF7K2M4Q')).toBe('PNR');
    expect(detectarTipo('171003')).toBe('PNR');
  });

  const orden = (o: Partial<Order>) => ({ status: 'CONFIRMED', route_details: { dropoff: { datetime: new Date(Date.now() + 86400000).toISOString() } }, ...o }) as Order;

  it('RESERVADO -> PENDIENTE_ENTREGA -> CONFIRMADO_ASISTIDO -> EN_LIMPIEZA; CANCELLED', () => {
    expect(estadoMostrador(orden({}))).toBe('RESERVADO');
    expect(estadoMostrador(orden({ checkin_digital_at: new Date() }))).toBe('PENDIENTE_ENTREGA');
    expect(estadoMostrador(orden({ checkin_entrega_at: new Date() }))).toBe('CONFIRMADO_ASISTIDO');
    expect(estadoMostrador(orden({ checkin_entrega_at: new Date(), checkin_devolucion_at: new Date() }), { status: 'WASHING', wash_until: new Date(Date.now() + 3600_000) })).toBe('EN_LIMPIEZA');
    expect(estadoMostrador(orden({ checkin_entrega_at: new Date(), checkin_devolucion_at: new Date() }), { status: 'AVAILABLE', wash_until: null })).toBe('COMPLETADA');
    expect(estadoMostrador(orden({ status: 'CANCELLED' }))).toBe('CANCELLED');
  });
});

describe('Compatibilidad v1/v2/v3 en las respuestas', () => {
  it('aV3 reescribe los enlaces HATEOAS /api/v2 -> /api/v3 sin tocar otros campos', () => {
    const r = aV3({ _links: { self: '/api/v2/autos/orders/RF1' }, foto: 'https://x/api/v2x.png', n: 1 });
    expect(r).toEqual({ _links: { self: '/api/v3/autos/orders/RF1' }, foto: 'https://x/api/v2x.png', n: 1 });
  });

  it('conStockV3 agrega stock/available_units/status; RESERVADO es por rango -> DISPONIBLE en el catalogo', () => {
    const r = conStockV3({ data: [
      { vehicle_id: 'A', precio_diario: 1, estado: 'DISPONIBLE' }, { vehicle_id: 'B', precio_diario: 1, estado: 'RESERVADO' },
      { vehicle_id: 'C', precio_diario: 1, estado: 'EN_LIMPIEZA' },
    ] });
    expect(r.data.map((c: any) => [c.stock, c.available_units, c.status])).toEqual([[1, 1, 'DISPONIBLE'], [1, 1, 'DISPONIBLE'], [0, 0, 'EN_LIMPIEZA']]);
  });

  it('cobertura v3 en ingles (BASIC/TOTAL) y alias en espanol (BASICA/PREMIUM)', () => {
    expect(normalizarCobertura('BASIC')).toBe('BASICA');
    expect(normalizarCobertura('basica')).toBe('BASICA');
    expect(normalizarCobertura('TOTAL')).toBe('TOTAL');
    expect(normalizarCobertura('PREMIUM')).toBe('TOTAL');
    expect(normalizarCobertura(undefined)).toBe('BASICA');
    expect(() => normalizarCobertura('GOLD')).toThrow();
  });

  it('cooldown 2 h: EN_LIMPIEZA (espanol) y WASHING (ingles) son el mismo estado y reportan 0 unidades', () => {
    expect(normalizarEstado('EN_LIMPIEZA')).toBe('WASHING');
    expect(normalizarEstado('washing')).toBe('WASHING');
    expect(aEstadoV2('WASHING')).toBe('EN_LIMPIEZA');
    expect(unidadesDisponibles('WASHING')).toBe(0);
    expect(normalizarEstado('DISPONIBLE')).toBe('AVAILABLE');
    expect(unidadesDisponibles(normalizarEstado('DISPONIBLE')!)).toBe(1);
  });
});

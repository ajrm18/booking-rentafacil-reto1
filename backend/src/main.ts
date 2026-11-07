import { NestFactory } from '@nestjs/core';
import { INestApplication, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder, OpenAPIObject } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { AppModule } from './app.module';
import { configureApp, corsOptions } from './app.setup';
import { AutosModule } from './modules/autos/autos.module';
import { GRPC_PACKAGE, inventoryProtoPath, PROTO_LOADER_OPTIONS } from './modules/integracion/grpc/proto-path';
import { grpcServidor } from './modules/integracion/grpc/grpc-estado';
import { AppLogger, log } from './common/app-logger';
import { DataSource } from 'typeorm';
import { sembrarTodo } from './modules/autos/seeds/seed';
import { rentafacilApiKey, rentafacilApiKeyGenerada } from './common/rentafacil-api-key';

/**
 * Ajustes de integracion con el Booking Central (feedback Reto 2) documentados en /api/v3/docs,
 * en memoria y sin modificar el YAML oficial.
 */
function documentarAjustesBooking(doc: any): void {
  const p = doc.paths ?? {};
  const ok = (d: string) => ({ description: d, content: { 'application/json': { schema: { type: 'object' } } } });
  const problema = (d: string) => ({ description: d, content: { 'application/problem+json': { schema: { type: 'object' } } } });
  const r401 = problema('401 MISSING_API_KEY: { type: https://rentafacil.ec/errors/unauthorized, title: Unauthorized, status: 401, detail: "X-API-Key missing or invalid", code: MISSING_API_KEY }');
  const seguridadM2M = [{ ApiKeyAuth: [] }, { BearerAuth: [] }];

  // Ajuste 4: X-API-Key obligatoria en /autos/orders*, /autos/reservas* y /clientes
  for (const [ruta, item] of Object.entries<any>(p)) {
    if (!/^\/(autos\/(orders|reservas)|clientes)(\/|$)/.test(ruta)) continue;
    for (const op of Object.values<any>(item)) {
      if (!op || typeof op !== 'object' || !op.responses) continue;
      op.security = seguridadM2M;
      op.responses = { ...op.responses, 401: r401 };
    }
  }

  // Ajuste 1 + 7: cancel con Idempotency-Key opcional y 409 ORDER_ALREADY_DELIVERED
  const cancel = p['/autos/orders/{orderId}/cancel']?.post;
  if (cancel) {
    cancel.parameters = (cancel.parameters ?? []).map((x: any) => (x?.name === 'Idempotency-Key'
      ? { ...x, required: false, description: 'OPCIONAL en /api/v3 (en /api/v2 sigue siendo obligatoria). Si no viene, la cancelación se deduplica por PNR + fecha UTC.' }
      : x));
    cancel.description = `${cancel.description ?? ''}\n\n**RentaFacil EC:** el Booking puede cancelar con solo \`{ "reason": "<texto libre>" }\` y sin Idempotency-Key. ` +
      'Si la orden ya tiene check-in de entrega (vehículo entregado físicamente) responde **409 ORDER_ALREADY_DELIVERED**. La respuesta incluye `pickup_date` y `dropoff_date`.';
    cancel.responses = { ...cancel.responses, 409: problema('ORDER_ALREADY_DELIVERED (type https://rentafacil.ec/errors/order-already-delivered) | ORDER_ALREADY_CANCELLED | ORDER_EXPIRED') };
  }

  // Ajuste 3 + 5: pickup_date / dropoff_date y status CONFIRMADO_ASISTIDO en AutoOrderResponseV2
  const orden = doc.components?.schemas?.AutoOrderResponseV2;
  if (orden?.properties) {
    orden.properties.pickup_date = { type: 'string', format: 'date', example: '2026-12-26', description: 'Fecha de recogida YYYY-MM-DD (route_details.pickup.datetime)' };
    orden.properties.dropoff_date = { type: 'string', format: 'date', example: '2026-12-28', description: 'Fecha de devolución YYYY-MM-DD (route_details.dropoff.datetime)' };
    if (orden.properties.status) {
      orden.properties.status = { ...orden.properties.status, description: 'CONFIRMED | CHECKIN_COMPLETED | CONFIRMADO_ASISTIDO (tras checkin-entrega; en /api/v2 es ENTREGADO) | COMPLETADA | CANCELLED' };
    }
  }

  // Ajuste 2: disponibilidad por rango de fechas
  p['/autos/{id}/disponibilidad'] = {
    get: {
      tags: ['Autos - Catálogo y Búsqueda v2'],
      summary: 'Disponibilidad de un vehículo para un rango de fechas (bloqueo por rango, no por auto entero)',
      description: 'El auto solo está RESERVADO en los rangos que se cruzan con una orden CONFIRMED o ENTREGADO: [a1,a2] y [b1,b2] se cruzan cuando a1 <= b2 AND b1 <= a2. ' +
        'GET /autos y GET /autos/{id} muestran DISPONIBLE salvo EN_LIMPIEZA / EN_MANTENIMIENTO; POST /autos/search aplica la misma regla con pickup_date / dropoff_date.',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'VEH-1001' },
        { name: 'pickup_date', in: 'query', required: true, schema: { type: 'string', format: 'date' }, example: '2027-01-10' },
        { name: 'dropoff_date', in: 'query', required: true, schema: { type: 'string', format: 'date' }, example: '2027-01-12' },
      ],
      responses: { 200: ok('{ vehicle_id, pickup_date, dropoff_date, disponible, estado, available_units, rangos_reservados[] }'), 404: problema('VEHICLE_NOT_FOUND'), 422: problema('INVALID_DATES') },
      security: [],
    },
  };

  // Ajuste 9 (informativo): reason del stock es texto libre
  doc.info = doc.info ?? {};
  doc.info.description = `${doc.info.description ?? ''}\n\n### Integración con el Booking Central (RentaFacil EC)\n` +
    '- **Stock:** RentaFacil envía `POST {BOOKING}/api/v3/inventory/stock` con `{ item_id, available_units, date, reason }`; `reason` es **texto libre**.\n' +
    '- **Check-in:** `POST {BOOKING}/api/v3/reservas/{external_order_id}/checkin`, donde `external_order_id` es el **PNR (RF...)**, con estado `CONFIRMADO_ASISTIDO`.\n' +
    '- **X-API-Key:** obligatoria en `/autos/orders*`, `/autos/reservas*` y `/clientes` (401 `MISSING_API_KEY`). Públicas: health, catálogo, search, detalle, coberturas, flota, promociones/contrato, eventos y docs.\n' +
    '- **Cancel:** `POST /autos/orders/{pnr}/cancel` con solo `{ reason }` (Idempotency-Key opcional).\n' +
    '- **Disponibilidad:** bloqueo por rango de fechas que se cruzan (dos reservas pueden coexistir en meses distintos sobre el mismo auto).';
}

/** Lee un contrato YAML de backend/contracts (cwd = backend en Render y en local). */
function leerContrato(nombre: string): OpenAPIObject | null {
  const ruta = [join(process.cwd(), 'contracts', nombre), join(__dirname, '..', 'contracts', nombre)].find(existsSync);
  if (!ruta) { Logger.warn(`No se encontro contracts/${nombre}`, 'Bootstrap'); return null; }
  return yaml.load(readFileSync(ruta, 'utf8')) as OpenAPIObject;
}

/**
 * Contrato v2 oficial servido tal cual en /api/v2/docs (+ /api/v2/docs-json), y el contrato propio
 * (oficial + endpoints /admin de RentaFacil) en /api/v2/docs-rentafacil.
 */
function swaggerV2(app: INestApplication): void {
  const opciones = { swaggerOptions: { persistAuthorization: true, docExpansion: 'none' } };
  const oficial = leerContrato('autos-openapi-v2.yaml');
  if (oficial) SwaggerModule.setup('api/v2/docs', app, oficial, { ...opciones, customSiteTitle: 'RentaFacil EC - Autos API v2.0.0 (contrato oficial RDA2)' });
  const propio = leerContrato('rentafacil-ec-openapi-v2.yaml');
  if (propio) SwaggerModule.setup('api/v2/docs-rentafacil', app, propio, { ...opciones, customSiteTitle: 'RentaFacil EC - Contrato propio v2' });
}

/**
 * Contrato v3.0.0 oficial (sin modificar el YAML) en /api/v3/docs. Solo en memoria se agregan la
 * URL de Azure como primer servidor y los endpoints v3.1 propios (clientes, buscador, alta de autos).
 */
function swaggerV3(app: INestApplication): void {
  const doc = leerContrato('autos-openapi-v3.yaml') as any;
  if (!doc) return;
  const publica = process.env.PUBLIC_BASE_URL || 'https://rentafacil-autos-api.azurewebsites.net';
  doc.servers = [{ url: `${publica}/api/v3`, description: 'RentaFacil EC en Azure App Service (brazilsouth)' }, ...(doc.servers ?? [])];
  const ok = (d: string) => ({ description: d, content: { 'application/json': { schema: { type: 'object' } } } });
  const tag = ['RentaFacil v3.1 - Clientes cross-platform y Mostrador'];
  doc.tags = [...(doc.tags ?? []), { name: tag[0], description: 'Extensiones v3.1 de RentaFacil EC (evaluación): clientes anti-duplicados, buscador de mostrador y alta de vehículos.' }];
  doc.paths = {
    ...doc.paths,
    '/clientes': {
      get: {
        tags: tag, summary: 'Buscar cliente por email O identificacion (404 o [] con X-Prefer-Empty-Array: true)',
        parameters: [
          { name: 'email', in: 'query', schema: { type: 'string' } },
          { name: 'identificacion', in: 'query', schema: { type: 'string' } },
          { name: 'X-Prefer-Empty-Array', in: 'header', schema: { type: 'string', enum: ['true'] } },
        ],
        responses: { 200: ok('Cliente encontrado { client_id, nombre, email, identificacion } (o [] con la cabecera)'), 404: ok('ProblemDetails CLIENT_NOT_FOUND') },
      },
      post: {
        tags: tag, summary: 'Crear cliente; si email o identificacion ya existen devuelve el existente (200, nunca 409)',
        requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['nombre', 'email', 'identificacion'], properties: {
          nombre: { type: 'string', example: 'Juan Perez' }, email: { type: 'string', example: 'juan@example.com' },
          identificacion: { type: 'string', example: '1710034065' }, telefono: { type: 'string', example: '+593987654321' }, licencia: { type: 'string', example: '1710034065' },
        } } } } },
        responses: { 201: ok('{ client_id }'), 200: ok('Cliente existente'), 422: ok('INVALID_PAYLOAD') },
      },
    },
    '/autos/orders/buscar': {
      get: { tags: tag, summary: 'Buscador del mostrador (PNR, cédula de 10 dígitos o email)', security: [{ BearerAuth: [] }],
        parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }, { name: 'tipo', in: 'query', schema: { type: 'string', enum: ['PNR', 'IDENTIFICACION', 'EMAIL'] } }],
        responses: { 200: ok('Tarjetas de reservas') } },
    },
    '/admin/vehicles': {
      post: { tags: tag, summary: 'Crear vehículo con stock inicial (push gRPC available_units=1 al Booking)', security: [{ BearerAuth: [] }],
        responses: { 201: ok('AutoVehiculoCardV2 + stock') } },
    },
  };
  documentarAjustesBooking(doc);
  SwaggerModule.setup('api/v3/docs', app, doc, {
    swaggerOptions: { persistAuthorization: true, docExpansion: 'none' },
    customSiteTitle: 'RentaFacil EC - Autos API v3.0.0 (contrato oficial RDA2)',
  });
}

/** Servidor gRPC InventoryStockService en 0.0.0.0:50051, en el mismo proceso que el HTTP. */
async function grpc(app: INestApplication): Promise<void> {
  // En Azure App Service B1 el puerto 50051 no es alcanzable desde Internet: RentaFacil actua solo
  // como CLIENTE gRPC hacia el Booking (GRPC_ENABLED=false en Azure).
  if (process.env.GRPC_ENABLED === 'false') { log.info('GRPC', 'servidor gRPC propio deshabilitado (modo cliente hacia el Booking)'); return; }
  const url = process.env.GRPC_URL || `0.0.0.0:${process.env.GRPC_PORT || 50051}`;
  try {
    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.GRPC,
      options: { package: GRPC_PACKAGE, protoPath: inventoryProtoPath(), url, loader: PROTO_LOADER_OPTIONS },
    });
    await app.startAllMicroservices();
    grpcServidor.escuchando = url;
    Logger.log(`gRPC inventory.InventoryStockService escuchando en ${url}`, 'Bootstrap');
  } catch (e: any) {
    // El HTTP sigue funcionando: el stock se sincroniza por REST (/autos, /autos/flota) y RabbitMQ
    grpcServidor.error = e?.message ?? String(e);
    Logger.warn(`gRPC deshabilitado: ${grpcServidor.error}`, 'Bootstrap');
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: new AppLogger() });
  const config = app.get(ConfigService);

  // Prefijo /api/v1, ValidationPipe y filtro Problem Details (compartido con las pruebas e2e)
  configureApp(app);

  // Frontend propio + origenes del Booking Prototipo central (docs/integracion-booking.md §3.2)
  app.enableCors(corsOptions(config.get<string>('FRONTEND_URL')));

  // Metadatos y seguridad copiados de contracts/autos-openapi.yaml (info + components.securitySchemes)
  const swagger = new DocumentBuilder()
    .setTitle('GDS Autos Core API')
    .setDescription(
      'Microservicio centralizado para búsqueda, disponibilidad, reservas (órdenes) y postventa de renta de autos. ' +
      'El dueño de la reserva (ownerId) se infiere del sub del token JWT. La lógica de pagos pertenece a otros dominios/APIs.\n\n' +
      'Implementacion de RentaFacil EC (Reto 1 - Booking Prototipo) del contrato contracts/autos-openapi.yaml. ' +
      'Para probar: obtenga un JWT con POST /api/v1/auth/token y peguelo en Authorize > bearer.',
    )
    .setVersion('1.0.0')
    .setContact('Joselyn Cadena', '', 'jlcadenac@puce.edu.ec')
    .addOAuth2({
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: 'https://auth.booking-hub.com/oauth2/authorize',
          tokenUrl: 'https://auth.booking-hub.com/oauth2/token',
          scopes: {
            'autos:read': 'Leer información de autos, catálogos y reservas',
            'autos:book': 'Crear, mantener en hold y alterar reservas',
            'autos:cancel': 'Cancelar reservas',
            'autos:webhooks': 'Gestionar webhooks',
          },
        },
        clientCredentials: {
          tokenUrl: 'https://auth.booking-hub.com/oauth2/token',
          scopes: {
            'autos:read': '(B2B) Leer',
            'autos:book': '(B2B) Comprar',
            'autos:cancel': '(B2B) Cancelar',
            'autos:webhooks': '(B2B) Webhooks',
          },
        },
      },
    }, 'OAuth2Security')
    // JWT emitido localmente por /auth/token (sustituye al Authorization Server en Reto 1)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .addSecurityRequirements('OAuth2Security')
    .addTag('Búsqueda y Catálogo')
    .addTag('Información de Agencias y Proveedores')
    .addTag('Gestión de Órdenes (Reservas)')
    .addTag('Componentes Comunes')
    .addTag('Webhooks')
    .addTag('Account', 'Datos del usuario autenticado (fuera del contrato GDS)')
    .addTag('Auth', 'Authorization Server local: login y registro de clientes (fuera del contrato GDS)')
    .addTag('Admin - Suppliers', 'CRUD de la tabla suppliers')
    .addTag('Admin - Depots', 'CRUD de la tabla depots')
    .addTag('Admin - Vehicles', 'CRUD de la tabla vehicles (incluye estado WASHING y wash_until)')
    .addTag('Admin - Imagenes de Vehiculos', 'CRUD de la tabla vehicle_images')
    .addTag('Admin - Holds', 'CRUD de la tabla holds')
    .addTag('Admin - Previsualizaciones de Orden', 'CRUD de la tabla order_previews')
    .addTag('Admin - Orders', 'CRUD de la tabla orders')
    .addTag('Admin - Returns', 'Devolucion de vehiculos: la orden sigue CONFIRMED y el vehiculo pasa a WASHING 24 h')
    .addTag('Admin - Users', 'CRUD de la tabla users')
    .addTag('Admin - Webhooks', 'CRUD de la tabla webhook_subscriptions')
    .addTag('Admin - Dashboard', 'Estadisticas agregadas')
    .build();
  // Solo el modulo del Reto 1: el v2 se documenta con su YAML oficial
  const document = SwaggerModule.createDocument(app, swagger, { include: [AutosModule] });
  // Igual que el contrato: los endpoints publicos (header X-Affiliate-Id) y /auth/token
  // anulan la seguridad global con `security: []`.
  for (const [path, item] of Object.entries(document.paths)) {
    for (const op of Object.values(item) as any[]) {
      const publico = op?.parameters?.some((p: any) => p.in === 'header' && p.name === 'X-Affiliate-Id')
        || path.endsWith('/auth/token') || path.endsWith('/auth/register');
      if (publico) op.security = [];
    }
  }
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      tagsSorter: 'alpha',
    },
    customSiteTitle: 'RentaFacil EC - Autos API Docs',
  });
  swaggerV2(app);
  swaggerV3(app);
  await grpc(app);

  // Azure App Service inyecta PORT (8080 por defecto en Linux)
  const port = Number(process.env.PORT || config.get<number>('PORT') || 8080);
  await app.listen(port, '0.0.0.0');
  log.info('BOOTSTRAP', `RentaFacil EC - Autos API v3 escuchando en 0.0.0.0:${port}`, { node_env: process.env.NODE_ENV, nodo: process.env.NODE_ID || 'NODE_AUT_RENTAFACIL' });
  log.info('BOOTSTRAP', 'Swagger v1: /api/docs | v2: /api/v2/docs | v3: /api/v3/docs | health: /api/v3/autos/health');
  // X-API-Key que el Booking Central debe enviar a /api/v3/autos/orders* y /api/v3/clientes*
  if (rentafacilApiKeyGenerada()) {
    log.warn('STARTUP', 'RENTAFACIL_API_KEY no configurada: se genero una clave temporal (cambia en cada reinicio). Fijela en Azure -> Configuration.');
  }
  log.info('STARTUP', `RENTAFACIL_API_KEY=${rentafacilApiKey()}`);

  // Seed idempotente en el arranque (Azure no ejecuta scripts previos): 12 autos, usuarios demo, contrato B2B
  if (process.env.SEED_ON_START === 'true') {
    sembrarTodo(app.get(DataSource))
      .then(() => log.info('SEED', 'datos demo verificados (idempotente)'))
      .catch((e) => log.warn('SEED', `no se pudo sembrar: ${e?.message}`));
  }
}
bootstrap();

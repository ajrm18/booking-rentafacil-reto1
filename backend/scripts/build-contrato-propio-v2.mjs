/**
 * Genera contracts/rentafacil-ec-openapi-v2.yaml: el contrato oficial v2 (autos-openapi-v2.yaml,
 * sin modificar sus operaciones) + los endpoints propios de RentaFacil EC que no estan en el
 * contrato publico (/admin, /auth, /account del contrato interno del Reto 1 y la bitacora de
 * mantenimiento). Como unos viven en /api/v1 y otros en /api/v2, el server es /api y las rutas
 * llevan el prefijo de version.
 *
 * Uso: node scripts/build-contrato-propio-v2.mjs   (y luego npm run validate:contracts)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../contracts');
const leer = (f) => yaml.load(fs.readFileSync(path.join(dir, f), 'utf8'));
const oficial = leer('autos-openapi-v2.yaml');
const interno = leer('rentafacil-ec-openapi.yaml');

// Componentes del contrato interno que chocan con los del oficial: se renombran con sufijo V1
const renombres = [
  ['#/components/schemas/ProblemDetails"', '#/components/schemas/ProblemDetailsV1"'],
  ...['400', '401', '403', '404', '409', '429'].map((c) => [`#/components/responses/ProblemDetails${c}"`, `#/components/responses/ProblemDetailsV1_${c}"`]),
];
const reescribir = (obj) => {
  let s = JSON.stringify(obj);
  for (const [a, b] of renombres) s = s.split(a).join(b);
  return JSON.parse(s.replace(/"bearerAuth"/g, '"BearerAuth"'));
};
const internoPaths = reescribir(interno.paths);
const internoComp = reescribir(interno.components);
const schemasInternos = { ...internoComp.schemas };
schemasInternos.ProblemDetailsV1 = schemasInternos.ProblemDetails;
delete schemasInternos.ProblemDetails;
const responsesInternas = Object.fromEntries(Object.entries(internoComp.responses).map(([k, v]) => [k.replace('ProblemDetails', 'ProblemDetailsV1_'), v]));

const conPrefijo = (paths, prefijo) => Object.fromEntries(Object.entries(paths).map(([p, item]) => [`${prefijo}${p}`, item]));

const extensiones = {
  '/v2/autos/{id}/mantenimiento/bitacora': {
    get: {
      tags: ['RentaFacil - Extensiones v2'],
      summary: 'Bitácora de mantenimiento de un vehículo (tabla mantenimiento_log)',
      description: 'Últimos 50 registros de POST /v2/autos/{id}/mantenimiento/registro. RBAC: MANTENIMIENTO o ADMIN.',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'VEH-1007' }],
      responses: {
        200: {
          description: 'Registros de la bitácora',
          content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/MantenimientoLogRentaFacil' } } } },
        },
        401: { $ref: '#/components/responses/ProblemDetails401' },
        403: { $ref: '#/components/responses/ProblemDetails403' },
        404: { $ref: '#/components/responses/ProblemDetails404' },
      },
    },
  },
};

const schemasExtension = {
  MantenimientoLogRentaFacil: {
    type: 'object',
    properties: {
      bitacora_id: { type: 'string', example: 'BIT-AUTO-1A2B3C4D' },
      vehicle_id: { type: 'string' },
      tecnico_id: { type: 'string' },
      registrado_por: { type: 'string', description: 'sub del JWT' },
      kilometraje_registrado: { type: 'integer' },
      nivel_combustible: { type: 'integer' },
      condiciones_carroceria: { type: 'string', nullable: true },
      estado_neumaticos: { type: 'string', nullable: true },
      observaciones: { type: 'string', nullable: true },
      mantenimiento_realizado: { type: 'boolean' },
      proximo_mantenimiento_km: { type: 'integer' },
      alerta_emitida: { type: 'boolean' },
      created_at: { type: 'string', format: 'date-time' },
    },
  },
};

const propio = {
  openapi: '3.0.3',
  info: {
    title: 'RentaFacil EC — Autos API v2 (contrato oficial RDA2 + extensiones propias)',
    version: '2.0.0-rentafacil.1',
    contact: { name: 'Anthony Rosero' },
    description: [
      'Contrato propio de **RentaFacil EC** para el Reto 2. Extiende el contrato oficial',
      '`autos-openapi-v2.yaml` (v2.0.0, fuente de verdad, sin cambios en sus operaciones: rutas `/v2/...`)',
      'con los endpoints internos que no forman parte del contrato público (rutas `/v1/...`: Auth, Account',
      'y el BFF `/admin`, que siguen bajo `/api/v1`) y una extensión v2 (`/v2/autos/{id}/mantenimiento/bitacora`).',
      '',
      '**Server**: `/api` (cada ruta lleva su versión). Generado con `scripts/build-contrato-propio-v2.mjs`.',
      '',
      '### Decisiones de implementación',
      '- **Roles (BearerAuth)**: el JWT de `POST /v1/auth/token` lleva `role` = `client` | `admin` | `mechanic`,',
      '  expuestos en v2 como `CLIENTE` | `ADMIN` | `MANTENIMIENTO`. La cabecera `X-Role` es informativa: el rol sale del token.',
      '- **ApiKeyAuth**: `X-API-Key` se acepta para el Booking Prototipo (rol `B2B`) cuando el servidor tiene `BOOKING_API_KEY`.',
      '- **X-Correlation-Id**: opcional según el contrato; si falta se genera y siempre se devuelve en la respuesta.',
      '- **Idempotency-Key**: UUID v4 obligatorio en toda mutación (400 si falta). Reintentos devuelven la misma respuesta.',
      '- **Estados**: `vehicles.status` sigue en inglés (AVAILABLE, RESERVED, READY_FOR_PICKUP, DELIVERED, WASHING, MAINTENANCE)',
      '  y se publica con las 6 fases de `EstadoVehiculoEnum`. Cooldown EN_LIMPIEZA = 120 min exactos.',
      '- **Precios v2**: con impuestos incluidos (como el ejemplo oficial 3 × 35.50 + 3 × 18 = 160.50); recargo por edad 10 USD/día.',
      '- **Extensiones de respuesta**: `AutoOrderResponseV2` agrega `checkins` (las 3 fases con sus timestamps), `vehiculo`,',
      '  `recogida`, `devolucion`; `AutosHealthResponseV2` agrega `dependencias`, `event_bus_modo` y `outbox_pendientes`.',
      '  El contrato oficial no declara `additionalProperties: false`, así que son compatibles.',
    ].join('\n'),
  },
  servers: [
    { url: 'https://rentafacil-api.onrender.com/api', description: 'Producción (Render)' },
    { url: 'http://localhost:3000/api', description: 'Local' },
  ],
  tags: [
    ...(oficial.tags ?? []),
    { name: 'RentaFacil - Extensiones v2', description: 'Endpoints v2 propios de RentaFacil EC (fuera del contrato oficial)' },
    ...(interno.tags ?? []).map((t) => ({ ...t, description: `${t.description ?? ''} (interno, /api/v1)`.trim() })),
  ],
  paths: { ...conPrefijo(oficial.paths, '/v2'), ...extensiones, ...conPrefijo(internoPaths, '/v1') },
  components: {
    schemas: { ...oficial.components.schemas, ...schemasExtension, ...schemasInternos },
    responses: { ...oficial.components.responses, ...responsesInternas },
    parameters: { ...oficial.components.parameters, ...internoComp.parameters },
    securitySchemes: oficial.components.securitySchemes,
  },
  security: oficial.security,
};

const cabecera = [
  '# Contrato propio de RentaFacil EC para el Reto 2 (RDA2). GENERADO: no editar a mano.',
  '# Fuente: contracts/autos-openapi-v2.yaml (oficial) + contracts/rentafacil-ec-openapi.yaml (interno).',
  '# Regenerar: node scripts/build-contrato-propio-v2.mjs',
  '',
].join('\n');
fs.writeFileSync(path.join(dir, 'rentafacil-ec-openapi-v2.yaml'), cabecera + yaml.dump(propio, { lineWidth: 120, noRefs: true }));
console.log(`rentafacil-ec-openapi-v2.yaml: ${Object.keys(propio.paths).length} rutas`);

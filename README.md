# RentaFacil EC - Booking Prototipo (Reto 1 + Reto 2)

Implementación del **contrato oficial** `contracts/autos-openapi.yaml` (GDS Autos Core API v1.0.0) para el Reto 1 del proyecto integrador **Booking Prototipo** de la asignatura de Integración de Sistemas de la PUCE.

**Autor:** Anthony Rosero
**Contrato:** `backend/contracts/autos-openapi.yaml` (copia exacta del repositorio oficial del profesor)
**Arquitectura Reto 1:** Monolito API-first (NestJS) + Frontend SPA (React) + PostgreSQL
**Reto 2:** contrato `backend/contracts/autos-openapi-v2.yaml` en `/api/v2`, gRPC `:50051`, CloudEvents a RabbitMQ con Transactional Outbox

---

## Reto 2 (RDA2) — Proveedor integrado al Booking Prototipo central

Implementación del **contrato oficial v2.0.0** `backend/contracts/autos-openapi-v2.yaml` bajo **`/api/v2`**. El Reto 1 sigue vivo **1:1** en `/api/v1` (compatibilidad hacia atrás que exige el propio contrato v2 en `servers:`).

- **Swagger v2 (contrato oficial):** `/api/v2/docs` · JSON: `/api/v2/docs-json` · contrato propio (oficial + `/admin`): `/api/v2/docs-rentafacil`
- **Swagger v1:** `/api/docs` (sin cambios)
- **Arquitectura objetivo:** `docs/rentafacil-reto2.mermaid` · **flujo de integración:** `docs/integracion-booking.md`

| Grupo | Endpoint (`/api/v2`) | Seguridad |
|---|---|---|
| Catálogo y búsqueda | `GET /autos`, `POST /autos/search` (franjas de 30 min estrictas), `GET /autos/{id}`, `GET /autos/{id}/coberturas` | pública |
| Reservas | `GET /autos/orders`, `POST /autos/orders/create` (+ alias `POST /autos/reservas`), `GET /autos/orders/{orderId}` (UUID o PNR), `POST /autos/orders/{orderId}/cancel` (Saga, reembolso 100 %) | JWT |
| Check-in | `POST /autos/reservas/{id}/checkin` (digital, cliente), `POST /autos/orders/{id}/checkin-entrega` y `/checkin-devolucion` (agente: ADMIN o MANTENIMIENTO) | JWT |
| Flota | `GET /autos/flota` (cronómetro del cooldown), `POST /autos/{id}/devolucion`, `POST /autos/{id}/mantenimiento/registro` (RBAC MANTENIMIENTO/ADMIN) | pública / JWT |
| Promociones B2B (§9) | `GET /autos/promociones/contrato`, `PUT /autos/promociones/contrato` (ADMIN) | JWT |
| Telemetría | `GET /autos/health` (semáforo LED, < 500 ms), `GET /autos/eventos` (feed Outbox) | pública / JWT |

**Reglas transversales:** toda mutación exige `Idempotency-Key` (UUID v4, `400` si falta) y los reintentos devuelven la misma respuesta (tabla `idempotency_records`); `X-Correlation-Id` se propaga (o se genera) y vuelve en la respuesta, los Problem Details y los CloudEvents; errores RFC 7807 con `type, title, status, detail, instance, code, correlation_id, timestamp` (+ `invalid_params`). Edad < 18 → `422 DRIVER_AGE_RESTRICTION`; < 25 o > 70 → recargo de 10 USD/día.

**Máquina de estados de 6 fases:** `DISPONIBLE → RESERVADO → LISTO_PARA_ENTREGAR → ENTREGADO → EN_LIMPIEZA → (EN_MANTENIMIENTO)`. La columna `vehicles.status` sigue en inglés (`AVAILABLE, RESERVED, READY_FOR_PICKUP, DELIVERED, WASHING, MAINTENANCE`) y un mapper la traduce; `/api/v1` sigue viendo `AVAILABLE/RESERVED/WASHING/MAINTENANCE`. **Cooldown de limpieza: 2 h exactas** (antes 24 h): durante ese tiempo el auto no aparece en `/search` ni `/autos/{id}` y reservarlo responde `409 VEHICLE_IN_CLEANING_COOLDOWN`.

**Triple check-in:** digital (licencia, voucher QR fast-track) → entrega en mostrador (licencia física + `km_salida`) → devolución en patio (`km_retorno ≥ km_salida`, combustible, `km_recorridos`, cooldown 2 h y alerta si `kilometraje_actual ≥ proximo_mantenimiento_km`).

**Integración asíncrona y gRPC:**
- **CloudEvents v1.0 + Transactional Outbox:** cada cambio se guarda en `outbox_events` en la misma transacción; un worker publica cada 5 s al exchange topic `booking.events` de RabbitMQ (`auto.order.confirmed`, `auto.order.cancelled`, `auto.cooldown.started`, `auto.cooldown.ended`, `auto.mantenimiento.alerta`, `stock.actualizado`). Sin `RABBITMQ_URL` el bus queda en **modo degradado** (eventos en el outbox y en el log; `/health` lo informa).
- **gRPC `inventory.InventoryStockService`** (`backend/src/proto/inventory.proto`, copia de la §2.1 del contrato) en `0.0.0.0:50051` en el mismo proceso que el HTTP: `PushStockUpdate` y `StreamInventoryChanges` alimentan una caché en RAM con TTL de 1 h. Con `BOOKING_GRPC_URL` cada cambio de stock se empuja también al Booking (timeout 5 s + circuit breaker; fallos en `logs/error.log`).
- **Render Free solo publica el puerto HTTP**: `:50051` no es alcanzable desde Internet. En producción el stock se sincroniza por REST (`/autos`, `/autos/flota`) y por `stock.actualizado`; gRPC funciona en local (`localhost:50051`). `render.yaml` documenta el servicio privado `rentafacil-grpc` para un plan de pago.

**Frontend:** cliente `frontend/src/api/clientV2.ts`; catálogo y checkout con franjas de 30 min y coberturas **BÁSICA ($0)** / **TOTAL ($18/día)**; "Mis reservas" con las 3 fases y sus timestamps, check-in digital y QR; panel admin con **Flota en vivo** (cronómetro, refresco 5 s), **Mostrador y patio**, **Mantenimiento**, **Promociones B2B** y **Salud y eventos** (semáforo + feed Outbox). Cuenta del técnico (rol MANTENIMIENTO): `tecnico@rentafacil.ec` / `Tecnico12345`.

**Variables nuevas del backend:** `RABBITMQ_URL`, `OUTBOX_INTERVAL_MS`, `GRPC_ENABLED`, `GRPC_PORT`, `BOOKING_GRPC_URL`, `BOOKING_GRPC_TLS`, `BOOKING_API_KEY` (ver `backend/.env.example`).

**Pruebas Reto 2:** unitarias (mapper de estados, cooldown 2 h, 409 en limpieza, 422/recargo por edad, idempotencia, gRPC real cliente-servidor, health < 500 ms) y e2e (flujo v2 completo, Saga, promociones, cobertura del contrato 19/19 operaciones, publicación real a RabbitMQ con `TEST_RABBITMQ_URL`). UI en Chrome: `node frontend/scripts/e2e-ui.mjs [URL]` y `node frontend/scripts/e2e-reto2.mjs [WEB] [API_V2]`.

## Integración con Booking Prototipo

Datos para el formulario **"Nuevo Proveedor"** (`Microservicios & Integración` ➔ `Gestión de Proveedores` ➔ `➕ Registrar Proveedor`), tomados de `docs/integracion-booking.md` §5:

| Campo | Valor |
|---|---|
| Nombre | `RentaFacil EC` |
| Equipo | `Anthony Rosero` |
| URL base de la API | `https://rentafacil-api.onrender.com/api/v2` |
| Tipo de servicio | `Autos` |
| gRPC endpoint (si lo pide) | `rentafacil-grpc.onrender.com:50051` (o el que configuremos) |
| Contrato OpenAPI (referencia) | `/api/v2/docs-json` |

El botón **🔄 Recheck** llama `GET {URL_BASE}/autos/health`, que responde `nodo_id = NODE_AUT_RENTAFACIL`, `nombre_proveedor = RentaFacil EC`, `vertical = AUTOS`, `version = 2.0.0`. **📥 Sincronizar** consume `GET /autos` o `POST /autos/search`. CORS abierto para `https://booking.epn.edu.ec`, `http://localhost:3000`, `http://localhost:5173`, `http://localhost:4000` y el frontend en Vercel; se expone la cabecera `X-Correlation-Id`.

> Nota: en Render Free el gRPC no se publica (ver arriba); el endpoint gRPC de la tabla aplica cuando se despliegue como servicio privado o en local (`localhost:50051`).

---


## 1. Cumplimiento del contrato

El backend implementa **todos** los endpoints del contrato oficial, con exactamente las mismas rutas, tags, headers, scopes OAuth2 y formato Problem Details (RFC 7807):

| Grupo | Endpoint | Método | Header/Guard |
|---|---|---|---|
| Búsqueda y Catálogo | `/search` | POST | `X-Affiliate-Id` |
| Búsqueda y Catálogo | `/details` | POST | `X-Affiliate-Id` |
| Agencias/Proveedores | `/depots` | POST | `X-Affiliate-Id` |
| Agencias/Proveedores | `/depots/reviews/scores` | POST | `X-Affiliate-Id` |
| Agencias/Proveedores | `/suppliers` | POST | `X-Affiliate-Id` |
| Componentes Comunes | `/constants` | POST | `X-Affiliate-Id` |
| Órdenes | `/orders/hold` | POST | OAuth2 `autos:book` |
| Órdenes | `/orders/preview` | POST | OAuth2 `autos:read` |
| Órdenes | `/orders/create` | POST | OAuth2 `autos:book` + `Idempotency-Key` |
| Órdenes | `/orders/{orderId}` | GET | OAuth2 `autos:read` |
| Órdenes | `/orders/{orderId}/modify` | POST | OAuth2 `autos:book` + `Idempotency-Key` |
| Órdenes | `/orders/{orderId}/cancel` | POST | OAuth2 `autos:cancel` + `Idempotency-Key` |
| Webhooks | `/webhooks` | GET, POST | OAuth2 `autos:webhooks` |
| Webhooks | `/webhooks/{id}` | DELETE | OAuth2 `autos:webhooks` |

Todos bajo prefijo `/api/v1` (equivalente al `servers.url` = `https://.../autos/v1` del contrato).

**Detalles del contrato que se cumplen** (verificados con una prueba E2E de 146 comprobaciones):
- Cabeceras `Cache-Control` (valor exacto por endpoint) y `X-API-Deprecation-Date` en las 6 respuestas públicas.
- `429` con `code: RATE_LIMIT_EXCEEDED` y `Retry-After` al exceder el límite por afiliado (`RATE_LIMIT_PER_MINUTE`, 120 por defecto); `409` también envía `Retry-After`.
- Errores `application/problem+json` con solo los campos de `ProblemDetails` (`additionalProperties: false`) y `invalidParams` con rutas anidadas (ej. `driver.age`).
- Paginación `maximum_results` / `page` con `metadata.next_page`; `last_modified` filtra `/details`.
- El `search_token` transporta la ruta de la búsqueda: `/orders/preview` cobra los días reales y la orden guarda `route_details`.
- Fechas de alquiler validadas en `/orders/preview`, `/orders/create` y `modify`: inicio no anterior a hoy (UTC, con 1 día de tolerancia por zona horaria), fin posterior al inicio y máximo 90 días. Si fallan: `400` con `code: VALIDATION_FAILED` y el motivo en `detail`.
- El dueño de la orden es el `sub` del JWT: solo el dueño (o un admin) puede ver, modificar o cancelar su orden.
- `Idempotency-Key` en create/modify/cancel: un reintento con la misma clave devuelve el mismo resultado.
- `modify` recalcula `total_price` al cambiar extras o ruta.
- Webhooks: `url` (uri) y `events` (enum) validados; se entrega el `WebhookPayload` del callback `carEvent`
  (`CAR_ORDER_CONFIRMED`, `CAR_ORDER_CANCELLED`, `DEPOT_UPDATE`) firmado con HMAC-SHA256 en `X-Webhook-Signature` si hay `secret`.
- Swagger declara `OAuth2Security` con los flujos `authorizationCode` y `clientCredentials` y `security: []` en los endpoints públicos.
- `OrderDetail.status` conserva el enum del contrato (`CONFIRMED | CANCELLED | PENDING`): "Finalizada" es un estado **solo de presentación** (orden CONFIRMED cuya devolución ya pasó).

**Extra (fuera del contrato público) para cumplir el Reto 1:**
- `POST /api/v1/auth/token` — Authorization Server local (equivalente al OAuth2 de `auth.booking-hub.com`), contra la tabla `users` (contraseñas con hash scrypt).
- `POST /api/v1/auth/register` — registro público de clientes (página `/registro`): nombre, apellido, correo, teléfono, cédula y contraseña, todos obligatorios y con las mismas reglas que "Nuevo cliente" del admin. El rol siempre es `client` (enviar `role` da `400`); responde igual que `/auth/token`, así el cliente entra directamente.
- `GET /api/v1/account/orders` — órdenes del usuario autenticado (dueño = `sub` del token), usado por "Mis reservas".
- **9 APIs de administración, una por cada tabla** (OAuth2 scope `autos:webhooks`). Cada una expone
  `GET /` (listar), `GET /:id`, `POST /`, `PUT /:id` y `DELETE /:id` bajo `/api/v1/admin/<recurso>`:

| Tabla | API | Filtros en `GET` |
|---|---|---|
| `suppliers` | `/admin/suppliers` | — |
| `depots` | `/admin/depots` | — |
| `vehicles` | `/admin/vehicles` | `?status=` |
| `vehicle_images` | `/admin/vehicle-images` | `?vehicle_id=` |
| `holds` | `/admin/holds` | `?status=`, `?vehicle_id=` |
| `order_previews` | `/admin/order-previews` | `?vehicle_id=` |
| `orders` | `/admin/orders` | `?status=` |
| `webhook_subscriptions` | `/admin/webhooks` | — |
| `users` | `/admin/users` | `?role=` |

  Además `GET /api/v1/admin/stats` devuelve conteos de las 9 tablas, órdenes finalizadas e ingresos para el panel de control.
  Errores en formato Problem Details: `404` si el registro no existe, `400` si faltan campos
  obligatorios y `409` al eliminar un registro con dependencias (ej. una agencia con vehículos).
- **Devolución de vehículos**: `POST /api/v1/admin/orders/{orderId}/return` (scopes `autos:webhooks` + `autos:book`).
  No cancela la orden: sigue `CONFIRMED` y guarda `returned_at` / `returned_by_sub` (sub del JWT). El vehículo pasa a
  `WASHING` durante 2 h (Reto 2; antes 24 h) (`vehicles.wash_until`): `/search` solo lo ofrece si la recogida es posterior a `wash_until`, y
  vuelve solo a `AVAILABLE` al vencer (auto-sanado en cada `/search` y `/details`, sin cron). Idempotente; `404` si la
  orden o el vehículo no existen y `409` si la orden no está `CONFIRMED`. En el panel: botón **Registrar retorno** y badge
  **DEVUELTO el DD/MM/YYYY HH:mm**; en Vehículos, badge amarillo **En lavado** con la fecha de fin.

## Contratos
- `backend/contracts/autos-openapi.yaml` — contrato GDS Autos Core v1.0.0
  (compartido por el profesor, implementado 1:1 por este backend).
- `backend/contracts/rentafacil-ec-openapi.yaml` — contrato interno propio de
  RentaFacil EC (APIs admin, auth y operacional). Autor: Anthony Rosero.
- `/api/docs` — Swagger UI con la unión de ambos.
- `/api/docs-json` — OpenAPI JSON generado desde el código.

Validación de ambos YAML: `cd backend && npm run validate:contracts`.

---

## 2. Estructura del proyecto

```
booking-rentafacil/
├── backend/
│   ├── contracts/autos-openapi.yaml    <- Contrato oficial (copia intacta)
│   ├── contracts/rentafacil-ec-openapi.yaml <- Contrato interno propio (admin, auth, devoluciones)
│   ├── scripts/validate-contracts.mjs  <- Valida ambos contratos (npm run validate:contracts)
│   ├── test/                           <- Jest: unitarias (test/unit) y e2e HTTP (test/e2e)
│   ├── scripts/e2e-prod.mjs            <- Prueba E2E contra producción
│   ├── src/
│   │   ├── main.ts                     Swagger, ValidationPipe, ProblemDetailsFilter
│   │   ├── app.module.ts
│   │   ├── common/
│   │   │   ├── guards/{affiliate,idempotency-key,oauth2,rate-limit}.guard.ts
│   │   │   ├── filters/http-exception.filter.ts   (RFC 7807)
│   │   │   ├── password.ts             (hash scrypt)
│   │   │   └── transformers/column-numeric.transformer.ts
│   │   └── modules/autos/
│   │       ├── autos.controller.ts     (endpoints del contrato)
│   │       ├── admin/                  (9 APIs CRUD, una por tabla + stats)
│   │       ├── account.controller.ts   (mis órdenes)
│   │       ├── auth-demo.controller.ts (JWT local)
│   │       ├── autos.service.ts        (lógica de negocio)
│   │       ├── webhook-dispatcher.service.ts
│   │       ├── dto/                    (CarSearchRequest, OrderHold, etc.)
│   │       ├── entities/               (Vehicle, Depot, Supplier, Hold, OrderPreview, Order, WebhookSubscription, VehicleImage, User)
│   │       └── seeds/seed.ts           (datos iniciales idempotentes)
│   ├── package.json, Dockerfile, render.yaml
├── frontend/
│   ├── scripts/                        (E2E de UI con Playwright: e2e-ui.mjs, e2e-usuarios.mjs, e2e-registro.mjs, e2e-retorno.mjs)
│   ├── src/
│   │   ├── api/                        (cliente HTTP con X-Affiliate-Id y Bearer)
│   │   ├── types/                      (tipos alineados al contrato)
│   │   ├── utils/reservas.ts           (validación de fechas, estado visible de la orden)
│   │   ├── context/AuthContext.tsx     (token + usuario)
│   │   ├── components/                 (Navbar, Footer, VehiculoCard, Modal, PaymentSimulatorModal...)
│   │   ├── pages/                      (Inicio, Catálogo, Detalle, Login, Mis reservas, Reserva confirmada)
│   │   └── admin/                      (Panel de control, Usuarios, Vehículos, Agencias, Proveedores, Órdenes)
│   ├── package.json, vercel.json
└── docs/documento-tecnico.docx
```

---

## 3. Levantar en local

### 3.1. Requisitos
- Node.js 20+
- Docker Desktop (para PostgreSQL local)

### 3.2. Backend
```bash
cd backend
cp .env.example .env

# PostgreSQL en Docker
docker run --name rentafacil-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=rentafacil -p 5432:5432 -d postgres:16

# Editar .env con DATABASE_URL=postgres://postgres:postgres@localhost:5432/rentafacil

npm install
npm run start:dev
```

En otra terminal, cargar datos iniciales (agencias, proveedores, vehículos, usuarios demo y 12 reservas históricas):
```bash
npm run seed
```

- API: <http://localhost:3000/api/v1>
- Swagger: <http://localhost:3000/api/docs>

**Cuentas demo (JWT):**
- Admin: `admin@rentafacil.ec` / `Admin12345` → scopes: `autos:read autos:book autos:cancel autos:webhooks`
- Cliente: `maria@example.com` / `Cliente12345` (María Maldonado, 0983563584) → scopes: `autos:read autos:book autos:cancel`
- Cliente: `carlos@example.com` / `Cliente12345` (Carlos Muñoz, 0984445566)

El administrador puede crear más clientes desde **Admin → Usuarios → + Nuevo cliente**.

### 3.3. Frontend
```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```
- <http://localhost:5173>

### 3.4. Probar el flujo completo con Swagger
1. `POST /api/v1/auth/token` con `admin@rentafacil.ec` → recibes `access_token`.
2. En Swagger, botón **Authorize** → pega `Bearer <token>` (o solo el token, el `persistAuthorization` está activo).
3. `POST /api/v1/search` con header `X-Affiliate-Id: 1` y body (fechas futuras, máximo 90 días):
   ```json
   {
     "booker": { "country": "ec" },
     "currency": "USD",
     "driver": { "age": 25 },
     "route": {
       "pickup": { "datetime": "2027-01-10T10:00:00Z", "location": { "airport": "UIO" } },
       "dropoff": { "datetime": "2027-01-14T10:00:00Z", "location": { "airport": "UIO" } }
     }
   }
   ```
   → Guarda `search_token` y algún `vehicle_id`.
4. `POST /api/v1/orders/hold` → recibes `hold_id`.
5. `POST /api/v1/orders/preview` con `vehicle_id`, `search_token`, `hold_id` y opcional `extras` → recibes `order_preview_id` y `total_price`.
6. `POST /api/v1/orders/create` con header `Idempotency-Key: <UUID v4>` y body con `order_preview_id`, `payment_reference` y `driver_details` → recibes `OrderDetail` con `locator` y `_links`.
7. `GET /api/v1/orders/{orderId}` → consultar detalle.
8. `POST /api/v1/orders/{orderId}/cancel` con `Idempotency-Key` → cancela.

### 3.5. Pruebas automatizadas
```bash
node backend/scripts/e2e-prod.mjs              # registro + flujo completo del contrato contra producción
cd frontend
npm run e2e:ui [URL]                            # reserva + simulador de pagos en Chrome real
node scripts/e2e-usuarios.mjs [URL]             # fechas, alta de cliente desde el admin y reserva del nuevo cliente
node scripts/e2e-registro.mjs [URL]             # registro público: validaciones, duplicados, ingreso y volver al vehículo
node scripts/e2e-retorno.mjs [URL] [API]        # admin: Registrar retorno -> badge DEVUELTO -> vehículo En lavado
```

Pruebas Jest del backend (unitarias + e2e HTTP con supertest). Las que usan base de datos necesitan una BD
desechable en `TEST_DATABASE_URL` (TypeORM `synchronize` crea las tablas); sin ella se omiten:
```bash
cd backend
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/rentafacil_test npm test
npm run test:unit    # solo unitarias
npm run test:e2e     # solo e2e
```
En local (backend en :3000, frontend en :5173, `npm run seed` al día):
`API_URL=http://localhost:3000 FRONT_URL=http://localhost:5173 node backend/scripts/e2e-prod.mjs` y `[URL]` = `http://localhost:5173`.

---

## 4. Despliegue en Render (backend + PostgreSQL)

1. Sube el repo completo a GitHub.
2. En Render: **New > PostgreSQL** con nombre `rentafacil-db`, plan Free. Copia el Internal Database URL.
3. **New > Web Service** conectado al repo:
   - Root Directory: `backend`
   - Build Command: `npm ci --include=dev && npm run build` (con `NODE_ENV=production`, `npm ci` omite devDependencies y `nest build` fallaría)
   - Start Command: `npm run start:render` (ejecuta el seed idempotente y luego `node dist/main.js`)
   - Plan: Free
   - Environment variables:
     - `DATABASE_URL` = Internal Database URL del paso 2
     - `JWT_SECRET` = cadena aleatoria larga
     - `JWT_EXPIRES_IN` = `1d`
     - `NODE_ENV` = `production`
     - `FRONTEND_URL` = URL de Vercel (se completa después del paso 5)
4. El seed corre automáticamente al iniciar (`start:render`); es idempotente: crea solo lo que falta (usuarios demo, reservas históricas) y corrige textos antiguos sin tildes. El plan Free de Render no incluye Shell.
5. Después del despliegue del frontend, volver aquí y actualizar `FRONTEND_URL`, luego Manual Deploy.

- API en producción: `https://rentafacil-api.onrender.com/api/v1`
- Swagger en producción: `https://rentafacil-api.onrender.com/api/docs`

---

## 5. Despliegue en Vercel (frontend)

1. En Vercel: **Add new > Project** e importa el repo.
2. Configuración:
   - Framework preset: Vite
   - Root Directory: `frontend`
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Environment variables:
     - `VITE_API_URL` = `https://rentafacil-api.onrender.com/api/v1`
     - `VITE_AFFILIATE_ID` = `1`
3. Deploy. Copia la URL y ponla como `FRONTEND_URL` en Render.

---

## 6. Modelo de datos (interno, en Postgres)

9 tablas relacionales dentro de una única base de datos (cada una con su API CRUD en `/api/v1/admin/...`):

- **suppliers** (`supplier_id`, `name`, `brand`, `description`)
- **depots** (`depot_id`, `name`, `city`, `address`, `airport`, `latitude`, `longitude`, `score`, `active`)
- **vehicles** (`vehicle_id` string, `make`, `model`, `year`, `plate`, `seats`, `doors`, `bag_capacity`, `transmission`, `fuel_type`, `car_type`, `price_per_day`, `status` (AVAILABLE, RESERVED, WASHING, MAINTENANCE, INACTIVE), `wash_until`, `depot_id` FK, `supplier_id` FK)
- **vehicle_images** (`id`, `url`, `position`, `vehicle_id` FK)
- **holds** (`hold_id`, `vehicle_id`, `search_token`, `status`, `expires_at`)
- **order_previews** (`order_preview_id`, `vehicle_id`, `search_token`, `hold_id`, `extras`, `total_price`, `breakdown`, `expires_at`)
- **orders** (`order_id` uuid, `locator`, `status`, `vehicle_id`, `owner_sub`, `vehicle_details`, `route_details`, `driver_details`, `extras`, `total_price`, `currency`, `idempotency_key`, `returned_at`, `returned_by_sub`, `creation_date`)
- **webhook_subscriptions** (`id` uuid, `url`, `events`, `secret`, `active`)
- **users** (`user_id` uuid, `first_name`, `last_name`, `email` único, `password_hash` scrypt, `role` client/admin, `phone`, `national_id`, `created_at`)

Los nombres de tablas, columnas y campos de la API se mantienen en inglés porque el contrato oficial también lo está; los textos que ve el usuario están en español con tildes y ñ.

---

## 7. Checklist Reto 1

- [x] Sistema desplegado en Internet (Render + Vercel)
- [x] Backend funcional con APIs documentadas según contrato oficial (Swagger en `/api/docs`)
- [x] Sistema de administración funcional (panel `/admin` con usuarios, vehículos, agencias, proveedores y órdenes; ingresos reales en el panel de control)
- [x] Marketplace web funcional (inicio + catálogo + detalle + flujo hold/preview/create + confirmación + mis reservas)
- [x] Base de datos operativa (PostgreSQL con 9 tablas, cada una con su API CRUD)
- [x] Documento técnico (`docs/documento-tecnico.docx`)
- [x] Frontend responsivo (adaptable a cualquier pantalla)
- [x] Navegable solo con teclado (Tab / Shift+Tab / Enter / Escape): enlace "Saltar al contenido", foco visible, menú móvil accesible
- [x] Simulador de pagos antes de `/orders/create` (Luhn, MM/AA, CVV; tarjeta de prueba `4111 1111 1111 1111`, `12/30`, CVV `123`). Prueba E2E de UI: `cd frontend && npm run e2e:ui [URL]`
- [x] Validación de fechas en frontend (mensajes en línea) y backend (inicio no pasado, fin posterior, máximo 90 días)
- [x] Gestión de usuarios: el admin crea clientes con contraseña generada y copia sus credenciales
- [x] Validación de todos los formularios en frontend y backend (nombres solo letras, correo con una sola @, teléfono solo números, cédula con dígito verificador, rangos en vehículos y agencias)
- [x] Autollenado de los datos del conductor desde el perfil del cliente (editables)
- [x] Ortografía española completa (tildes y ñ) en todo lo que ve el usuario
- [x] Cumplimiento 1:1 con `contracts/autos-openapi.yaml`
- [x] Headers requeridos: `X-Affiliate-Id`, `Idempotency-Key`
- [x] OAuth2 con scopes: `autos:read`, `autos:book`, `autos:cancel`, `autos:webhooks`
- [x] Errores en formato RFC 7807 (`application/problem+json`)
- [x] HATEOAS `_links` en `OrderDetail` (self, modify, cancel)
- [x] Cache-Control por endpoint según contrato
- [x] Preparado para integración con Booking Prototipo central (Reto 2)

---

## 8. Tecnologías

**Backend:** NestJS 10, TypeORM 0.3, PostgreSQL 16, class-validator, @nestjs/jwt, @nestjs/swagger.
**Frontend:** React 18, Vite 5, TypeScript, React Router 6, Axios.
**Pruebas:** scripts E2E en Node y Playwright (Chrome real).
**Despliegue:** Render (backend + BD), Vercel (frontend).

---

## Pruebas rápidas para el profesor (docs/integracion-booking.md §4)

```bash
# 1. Verificar que respondemos saludables
curl https://rentafacil-api.onrender.com/api/v2/autos/health

# 2. Listar nuestro catálogo
curl https://rentafacil-api.onrender.com/api/v2/autos

# 3. Buscar vehículos con fecha
curl -X POST https://rentafacil-api.onrender.com/api/v2/autos/search   -H "Content-Type: application/json"   -H "X-Correlation-Id: test-prof-001"   -d '{
    "pickup_location": "UIO",
    "pickup_date": "2026-11-01",
    "pickup_time": "10:00",
    "dropoff_date": "2026-11-04",
    "dropoff_time": "10:00",
    "driver_age": 32
  }'

# 4. Ver el contrato OpenAPI servido por nuestro backend
curl https://rentafacil-api.onrender.com/api/v2/docs-json
```

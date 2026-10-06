# RentaFacil EC - Reto 1 Booking Prototipo

Implementacion del **contrato oficial** `contracts/autos-openapi.yaml` (GDS Autos Core API v1.0.0) para el Reto 1 del proyecto integrador **Booking Prototipo** de la asignatura de Integracion de Sistemas de la PUCE.

**Autor:** Anthony Rosero
**Contrato:** `backend/contracts/autos-openapi.yaml` (copia exacta del repositorio oficial del profesor)
**Arquitectura Reto 1:** Monolito API-first (NestJS) + Frontend SPA (React) + PostgreSQL

---

## 1. Cumplimiento del contrato

El backend implementa **todos** los endpoints del contrato oficial, con exactamente las mismas rutas, tags, headers, scopes OAuth2 y formato Problem Details (RFC 7807):

| Grupo | Endpoint | Metodo | Header/Guard |
|---|---|---|---|
| Busqueda y Catalogo | `/search` | POST | `X-Affiliate-Id` |
| Busqueda y Catalogo | `/details` | POST | `X-Affiliate-Id` |
| Agencias/Proveedores | `/depots` | POST | `X-Affiliate-Id` |
| Agencias/Proveedores | `/depots/reviews/scores` | POST | `X-Affiliate-Id` |
| Agencias/Proveedores | `/suppliers` | POST | `X-Affiliate-Id` |
| Componentes Comunes | `/constants` | POST | `X-Affiliate-Id` |
| Ordenes | `/orders/hold` | POST | OAuth2 `autos:book` |
| Ordenes | `/orders/preview` | POST | OAuth2 `autos:read` |
| Ordenes | `/orders/create` | POST | OAuth2 `autos:book` + `Idempotency-Key` |
| Ordenes | `/orders/{orderId}` | GET | OAuth2 `autos:read` |
| Ordenes | `/orders/{orderId}/modify` | POST | OAuth2 `autos:book` + `Idempotency-Key` |
| Ordenes | `/orders/{orderId}/cancel` | POST | OAuth2 `autos:cancel` + `Idempotency-Key` |
| Webhooks | `/webhooks` | GET, POST | OAuth2 `autos:webhooks` |
| Webhooks | `/webhooks/{id}` | DELETE | OAuth2 `autos:webhooks` |

Todos bajo prefijo `/api/v1` (equivalente al `servers.url` = `https://.../autos/v1` del contrato).

**Detalles del contrato que se cumplen** (verificados con una prueba E2E de 127 comprobaciones):
- Cabeceras `Cache-Control` (valor exacto por endpoint) y `X-API-Deprecation-Date` en las 6 respuestas publicas.
- `429` con `code: RATE_LIMIT_EXCEEDED` y `Retry-After` al exceder el limite por afiliado (`RATE_LIMIT_PER_MINUTE`, 120 por defecto); `409` tambien envia `Retry-After`.
- Errores `application/problem+json` con solo los campos de `ProblemDetails` (`additionalProperties: false`) y `invalidParams` con rutas anidadas (ej. `driver.age`).
- Paginacion `maximum_results` / `page` con `metadata.next_page`; `last_modified` filtra `/details`.
- El `search_token` transporta la ruta de la busqueda: `/orders/preview` cobra los dias reales y la orden guarda `route_details`.
- El dueño de la orden es el `sub` del JWT: solo el dueño (o un admin) puede ver, modificar o cancelar su orden.
- `Idempotency-Key` en create/modify/cancel: un reintento con la misma clave devuelve el mismo resultado.
- `modify` recalcula `total_price` al cambiar extras o ruta.
- Webhooks: `url` (uri) y `events` (enum) validados; se entrega el `WebhookPayload` del callback `carEvent`
  (`CAR_ORDER_CONFIRMED`, `CAR_ORDER_CANCELLED`, `DEPOT_UPDATE`) firmado con HMAC-SHA256 en `X-Webhook-Signature` si hay `secret`.
- Swagger declara `OAuth2Security` con los flujos `authorizationCode` y `clientCredentials` y `security: []` en los endpoints publicos.

**Extra (fuera del contrato publico) para cumplir el Reto 1:**
- `POST /api/v1/auth/token` — Authorization Server local (equivalente al OAuth2 de `auth.booking-hub.com`).
- **8 APIs de administracion, una por cada tabla** (OAuth2 scope `autos:webhooks`). Cada una expone
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

  Ademas `GET /api/v1/admin/stats` devuelve conteos de las 8 tablas para el dashboard.
  Errores en formato Problem Details: `404` si el registro no existe, `400` si faltan campos
  obligatorios y `409` al eliminar un registro con dependencias (ej. una agencia con vehiculos).

---

## 2. Estructura del proyecto

```
booking-rentafacil/
├── backend/
│   ├── contracts/autos-openapi.yaml    <- Contrato oficial (copia intacta)
│   ├── src/
│   │   ├── main.ts                     Swagger, ValidationPipe, ProblemDetailsFilter
│   │   ├── app.module.ts
│   │   ├── common/
│   │   │   ├── guards/{affiliate,idempotency-key,oauth2}.guard.ts
│   │   │   ├── filters/http-exception.filter.ts   (RFC 7807)
│   │   │   ├── dto/problem-details.dto.ts
│   │   │   └── transformers/column-numeric.transformer.ts
│   │   └── modules/autos/
│   │       ├── autos.controller.ts     (endpoints del contrato)
│   │       ├── admin/                  (8 APIs CRUD, una por tabla + stats)
│   │       ├── auth-demo.controller.ts (JWT local)
│   │       ├── autos.service.ts        (logica de negocio)
│   │       ├── dto/                    (CarSearchRequest, OrderHold, etc.)
│   │       ├── entities/               (Vehicle, Depot, Supplier, Hold, OrderPreview, Order, WebhookSubscription, VehicleImage)
│   │       └── seeds/seed.ts           (datos iniciales)
│   ├── package.json, Dockerfile, render.yaml
├── frontend/
│   ├── src/
│   │   ├── api/                        (cliente HTTP con X-Affiliate-Id y Bearer)
│   │   ├── types/                      (tipos alineados al contrato)
│   │   ├── context/AuthContext.tsx     (token + user)
│   │   ├── components/                 (Navbar, Footer, VehiculoCard, PrivateRoute)
│   │   ├── pages/                      (Home, Catalogo, Detalle, Login, MisReservas, ReservaConfirmada)
│   │   └── admin/                      (Dashboard, Vehiculos, Depots, Suppliers, Orders)
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

En otra terminal, cargar datos iniciales:
```bash
npm run seed
```

- API: <http://localhost:3000/api/v1>
- Swagger: <http://localhost:3000/api/docs>

**Cuentas demo (JWT):**
- Admin: `admin@rentafacil.ec` / `Admin12345` → scopes: `autos:read autos:book autos:cancel autos:webhooks`
- Cliente: `maria@example.com` / `Cliente12345` → scopes: `autos:read autos:book autos:cancel`

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
2. En Swagger, boton **Authorize** → pega `Bearer <token>` (o solo el token, el `persistAuthorization` esta activo).
3. `POST /api/v1/search` con header `X-Affiliate-Id: 1` y body:
   ```json
   {
     "booker": { "country": "ec" },
     "currency": "USD",
     "driver": { "age": 25 },
     "route": {
       "pickup": { "datetime": "2026-10-01T10:00:00Z", "location": { "airport": "UIO" } },
       "dropoff": { "datetime": "2026-10-05T10:00:00Z", "location": { "airport": "UIO" } }
     }
   }
   ```
   → Guarda `search_token` y algun `vehicle_id`.
4. `POST /api/v1/orders/hold` → recibes `hold_id`.
5. `POST /api/v1/orders/preview` con `vehicle_id`, `search_token`, `hold_id` y opcional `extras` → recibes `order_preview_id` y `total_price`.
6. `POST /api/v1/orders/create` con header `Idempotency-Key: <UUID v4>` y body con `order_preview_id`, `payment_reference` y `driver_details` → recibes `OrderDetail` con `locator` y `_links`.
7. `GET /api/v1/orders/{orderId}` → consultar detalle.
8. `POST /api/v1/orders/{orderId}/cancel` con `Idempotency-Key` → cancela.

---

## 4. Despliegue en Render (backend + PostgreSQL)

1. Sube el repo completo a GitHub.
2. En Render: **New > PostgreSQL** con nombre `rentafacil-db`, plan Free. Copia el Internal Database URL.
3. **New > Web Service** conectado al repo:
   - Root Directory: `backend`
   - Build Command: `npm ci --include=dev && npm run build` (con `NODE_ENV=production`, `npm ci` omite devDependencies y `nest build` fallaria)
   - Start Command: `npm run start:render` (ejecuta el seed idempotente y luego `node dist/main.js`)
   - Plan: Free
   - Environment variables:
     - `DATABASE_URL` = Internal Database URL del paso 2
     - `JWT_SECRET` = cadena aleatoria larga
     - `JWT_EXPIRES_IN` = `1d`
     - `NODE_ENV` = `production`
     - `FRONTEND_URL` = URL de Vercel (se completa despues del paso 5)
4. El seed corre automaticamente al iniciar (`start:render`); es idempotente. El plan Free de Render no incluye Shell.
5. Despues del despliegue del frontend, volver aqui y actualizar `FRONTEND_URL`, luego Manual Deploy.

- API en produccion: `https://rentafacil-api.onrender.com/api/v1`
- Swagger en produccion: `https://rentafacil-api.onrender.com/api/docs`

---

## 5. Despliegue en Vercel (frontend)

1. En Vercel: **Add new > Project** e importa el repo.
2. Configuracion:
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

8 tablas relacionales dentro de una unica base de datos (cada una con su API CRUD en `/api/v1/admin/...`):

- **suppliers** (`supplier_id`, `name`, `brand`, `description`)
- **depots** (`depot_id`, `name`, `city`, `address`, `airport`, `latitude`, `longitude`, `score`, `active`)
- **vehicles** (`vehicle_id` string, `make`, `model`, `year`, `plate`, `seats`, `doors`, `bag_capacity`, `transmission`, `fuel_type`, `car_type`, `price_per_day`, `status`, `depot_id` FK, `supplier_id` FK)
- **vehicle_images** (`id`, `url`, `position`, `vehicle_id` FK)
- **holds** (`hold_id`, `vehicle_id`, `search_token`, `status`, `expires_at`)
- **order_previews** (`order_preview_id`, `vehicle_id`, `search_token`, `hold_id`, `extras`, `total_price`, `breakdown`, `expires_at`)
- **orders** (`order_id` uuid, `locator`, `status`, `vehicle_id`, `owner_sub`, `vehicle_details`, `route_details`, `driver_details`, `extras`, `total_price`, `currency`, `idempotency_key`, `creation_date`)
- **webhook_subscriptions** (`id` uuid, `url`, `events`, `secret`, `active`)

---

## 7. Checklist Reto 1

- [x] Sistema desplegado en Internet (Render + Vercel)
- [x] Backend funcional con APIs documentadas segun contrato oficial (Swagger en `/api/docs`)
- [x] Sistema de administracion funcional (panel `/admin` con CRUDs de vehiculos, depots, suppliers, ordenes)
- [x] Marketplace web funcional (home + catalogo + detalle + flujo hold/preview/create + confirmacion)
- [x] Base de datos operativa (PostgreSQL con 8 tablas, cada una con su API CRUD)
- [x] Documento tecnico (`docs/documento-tecnico.docx`)
- [x] Frontend responsivo (adaptable a cualquier pantalla)
- [x] Navegable solo con teclado (Tab / Shift+Tab / Enter / Escape): enlace "Saltar al contenido", foco visible, menu movil accesible
- [x] Simulador de pagos antes de `/orders/create` (Luhn, MM/AA, CVV; tarjeta de prueba `4111 1111 1111 1111`, `12/30`, CVV `123`). Prueba E2E de UI: `cd frontend && npm run e2e:ui [URL]`
- [x] Cumplimiento 1:1 con `contracts/autos-openapi.yaml`
- [x] Headers requeridos: `X-Affiliate-Id`, `Idempotency-Key`
- [x] OAuth2 con scopes: `autos:read`, `autos:book`, `autos:cancel`, `autos:webhooks`
- [x] Errores en formato RFC 7807 (`application/problem+json`)
- [x] HATEOAS `_links` en `OrderDetail` (self, modify, cancel)
- [x] Cache-Control por endpoint segun contrato
- [x] Preparado para integracion con Booking Prototipo central (Reto 2)

---

## 8. Tecnologias

**Backend:** NestJS 10, TypeORM 0.3, PostgreSQL 16, class-validator, @nestjs/jwt, @nestjs/swagger.
**Frontend:** React 18, Vite 5, TypeScript, React Router 6, Axios.
**Despliegue:** Render (backend + BD), Vercel (frontend).

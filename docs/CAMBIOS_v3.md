# Cambios v2 → v3 (Reto 2 final, RDA2)

> RentaFacil EC · Anthony Rosero · Contrato `backend/contracts/autos-openapi-v3.yaml` (v3.0.0, sin modificar) + requerimiento v3.1.

## Resumen

| Tema | v2 (Render + Neon) | v3 (Azure + Supabase) |
|---|---|---|
| URL base | `https://rentafacil-api.onrender.com/api/v2` | `https://rentafacil-autos-api.azurewebsites.net/api/v3` |
| Hosting | Render Free | Azure App Service Linux **B1** (`mexicocentral`, ver "Región") |
| Base de datos | Neon, todo en `public` | **Supabase** Session pooler, **9 esquemas** Database-per-Service |
| Bus de eventos | CloudAMQP | CloudAMQP (sin cambios) + evento nuevo `auto.checkin.notified` |
| Payload de reserva | `conductor` en español | **`driver` en inglés** (`full_name, email, phone, license_number, age`), `coverage_type: BASIC/TOTAL`; los alias en español se siguen aceptando (Ley de Postel) |
| Errores | códigos v2 (`VEHICLE_NOT_AVAILABLE`, `DRIVER_AGE_RESTRICTION`, `VALIDATION_FAILED` 400) | catálogo canónico v3 (ver abajo); el código v2 queda en `legacy_code` |
| Clientes | no existía | `GET/POST /api/v3/clientes` anti-duplicados (email o cédula) |
| Check-in de entrega | `ENTREGADO` local | `CONFIRMADO_ASISTIDO` + notificación HTTP al Booking central con reintentos |
| Logs | Logger de Nest | `[YYYY-MM-DD HH:mm:ss.SSS] [NIVEL] [MODULO] mensaje | k=v | correlation=<id>` + archivo con rotación diaria |
| gRPC | servidor propio :50051 + cliente opcional | solo **cliente** hacia el Booking (`BOOKING_GRPC_HOST`) con **fallback REST** |

`/api/v1` y `/api/v2` siguen funcionando igual (mismas rutas, DTOs y respuestas). `/api/v2/autos/health` sigue diciendo `version: 2.0.0`.

## Contrato v3.0.0

- Todas las rutas del contrato bajo `/api/v3/autos/...` (catálogo, búsqueda, flota, coberturas, reservas, cancelación Saga, triple check-in, devolución, mantenimiento, promociones B2B, eventos, health).
- `POST /autos/orders/create` (alias `POST /autos/reservas` y `POST /autos/orders`) responde además `vehicle_id` (alias de `auto_id`), `voucher_qr_payload` (alias de `voucher_qr_data`) y `client_id`.
- Catálogo: cada tarjeta trae `status`, `stock` y `available_units` (1 = DISPONIBLE, 0 = ocupado).
- Enlaces HATEOAS reescritos a `/api/v3/...`.
- Swagger por versión: `/api/docs` (v1), `/api/v2/docs` (v2), `/api/v3/docs` (v3, con la URL de Azure como primer servidor y las extensiones v3.1).

### Errores canónicos (RFC 7807)

| HTTP | `code` | Activa Saga en el Booking |
|---|---|---|
| 409 | `VEHICLE_UNAVAILABLE`, `OUT_OF_STOCK`, `VEHICLE_IN_CLEANING_COOLDOWN` | **sí** |
| 422 | `DRIVER_UNDERAGE`, `INVALID_DATES`, `INVALID_PAYLOAD` | no |
| 400 | `MALFORMED_REQUEST` (JSON roto, falta Idempotency-Key), `IDEMPOTENCY_CONFLICT` (misma clave, otro auto) | no |

### Cabeceras

`Idempotency-Key` (UUID v4) obligatoria en mutaciones · `X-Correlation-Id` (se genera si falta, vuelve en la respuesta) · `X-API-Key` (BOOKING_API_KEY o API_KEY_INTERNAL).
Mientras la clave del profesor esté `PENDIENTE...`, cualquier X-API-Key del Booking se acepta con `WARN [AUTH]`, y `orders/create`, `cancel` y `clientes` toleran peticiones sin credenciales (también con WARN). Una vez configurada, una clave incorrecta responde 401.

## Requerimiento v3.1

1. **Clientes cross-platform** (`db_identity.clientes`, `email` e `identificacion` únicos con índices `idx_clientes_email` e `idx_clientes_identificacion`):
   - `GET /api/v3/clientes?email=|identificacion=` → `200 {client_id, nombre, email, identificacion}` / `404 CLIENT_NOT_FOUND` / `200 []` con `X-Prefer-Empty-Array: true`.
   - `POST /api/v3/clientes` → `201 {client_id}` o `200` con el existente.
   - `origen`: `BOOKING` (X-Correlation-Id `booking-*`, `X-Source: BOOKING` o X-API-Key) o `WEB`.
   - Cada reserva hace upsert del conductor antes de crear la orden y guarda `orders.fk_cliente` (`[CLIENTES] upsert email=<x> result=<CREATED|EXISTS>`).
2. **Mostrador:** `GET /api/v3/autos/orders/buscar?q=` + pantalla `/admin/mostrador` con buscador unificado (debounce 300 ms), tarjetas por reserva y el botón **Confirmar Entrega de Llaves / Check-in** (modal: licencia física, `km_salida`, aceptación del contrato).
3. **Check-in asistido:** `POST /api/v3/autos/orders/{id}/checkin-entrega` → orden `CONFIRMADO_ASISTIDO`, vehículo `ENTREGADO`, fila en `db_counter.checkins` y notificación `POST {BOOKING_CHECKIN_URL}/{PNR}/checkin` (fire-and-forget, Opossum, timeout 5 s, outbox `db_outbox.outbox_booking_notifications`, backoff 1 s / 5 s / 15 s / 1 min / 5 min, CloudEvent `auto.checkin.notified`). Un reintento con la misma `Idempotency-Key` no notifica dos veces.
4. **Alta de vehículos con stock:** `POST /api/v3/admin/vehicles` + pantalla `/admin/vehiculos/nuevo` (stock 1, `PushStockUpdate available_units=1`).
5. **CRUD de clientes:** `GET/PATCH /api/v3/admin/clientes[/:id]` + pantalla `/admin/clientes`.

## Observabilidad

- `GET /api/v3/health` y `/api/v3/autos/health`: `status, nodo_id, nombre_proveedor, vertical, version 3.0.0, uptime_seconds, latencia_ms, total_vehiculos, circuit_breaker_estado, cooldown_activo_count, dependencias {base_datos, rabbitmq, booking_central}, outbox_pendientes, timestamp`. Responde con una instantánea refrescada cada 10 s en segundo plano, así se mantiene bajo 500 ms aunque Supabase (us-east-1) esté lejos de Azure.
- `X-Correlation-Id` en `AsyncLocalStorage`: logs, respuesta, HTTP saliente (fetch con cabecera inyectada) y CloudEvents.
- `logs/combined-YYYY-MM-DD.log` y `logs/error-YYYY-MM-DD.log` (winston-daily-rotate-file, 14 días). En Azure: `/home/LogFiles/app`.

## Base de datos

| Esquema | Tablas |
|---|---|
| `db_identity` | `users`, `clientes` |
| `db_catalog` | `vehicles`, `vehicle_images`, `depots`, `suppliers` |
| `db_inventory` | `grpc_log` (auditoría de cada PushStockUpdate) |
| `db_orders` | `holds`, `order_previews`, `orders` (+ `fk_cliente`, `estado_asistido`), `idempotency_records` |
| `db_counter` | `checkins` (DIGITAL, ENTREGA, DEVOLUCION) |
| `db_maintenance` | `mantenimiento_log` |
| `db_pricing` | `contrato_promociones_b2b` |
| `db_outbox` | `outbox_events`, `outbox_booking_notifications` |
| `db_webhooks` | `webhook_subscriptions` |

Sin FK físicas entre esquemas (IDs lógicos). `npm run migrate:supabase` crea todo, copia datos legados (`public` o `LEGACY_DATABASE_URL`) y siembra los datos demo de forma idempotente. El pool usa `ssl: { rejectUnauthorized: false }`, `max: 5` y `prepare: false` (como piden las guías del pooler).

## Región de Azure

La guía exige `brazilsouth`, pero la suscripción *Azure for Students* tiene la política "Allowed resource deployment regions" con solo `northcentralus, spaincentral, switzerlandnorth, canadacentral, mexicocentral`. Azure rechazó brazilsouth con `RequestDisallowedByAzure`, y canadacentral y northcentralus no tienen cuota B1. El plan B1 Linux quedó en **mexicocentral**, la región permitida más cercana a Booking (Brasil) y a Supabase (us-east-1). El nombre de la app y del grupo de recursos son los de la guía.

## Pruebas

`npm test` con `TEST_DATABASE_URL` (Postgres desechable): **194 pruebas pasan** y 1 se omite (la publicación real a RabbitMQ necesita `TEST_RABBITMQ_URL`). Las nuevas cubren:

- **`test/e2e/v3-flujos.e2e-spec.ts`:** los dos flujos de la evaluación, de punta a punta, con un mock gRPC del Booking y un mock HTTP del check-in.
- **`test/unit/booking-notifier.spec.ts`:** notificación al Booking, backoff y fallos.
- **`test/unit/v3-reglas.spec.ts`:** esquemas, errores v3, buscador, compatibilidad y cooldown en español e inglés.
- **`test/unit/observabilidad.spec.ts`:** logs, X-Correlation-Id, X-API-Key y clientes.
- **`test/unit/grpc-push-booking.spec.ts`:** cliente gRPC con fallback REST.

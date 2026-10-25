# Integración con Booking Prototipo Central (RDA2)

> Documento de referencia para la integración de RentaFacil EC como PROVEEDOR
> del Booking Prototipo Central (sistema agregador del profesor Paúl Rosero).
>
> **Autor:** Anthony Rosero · PUCE Integración de Sistemas · Reto 2 (RDA2)
> **Vertical:** AUTOS
> **Fuente:** Comunicaciones oficiales del profesor y plantilla del Reto 2.

---

## 1. Plantilla oficial del Reto 2

El profesor compartió el repositorio base:

- **Repo plantilla:** https://github.com/semestre5grupal-ops/Plantilla-Integracion-Sistemas.git
- **Contrato oficial a cumplir:** `contracts/autos-openapi.yaml` (versión v2.0.0 — ver `backend/contracts/autos-openapi-v2.yaml` en este repo).
- **Regla:** antes de programar cualquier cosa, el agente de código debe leer el contrato con mucho cuidado y detenimiento para codificar siempre cumpliendo con lo que se solicita.

---

## 2. Flujo de integración oficial (Formulario "Nuevo Proveedor")

El Booking Prototipo central integra a cada proveedor (nosotros = RentaFacil EC)
siguiendo este flujo exacto:

1. **Entregar la URL base** del backend al Booking central. Ejemplos:
   - Producción: `https://rentafacil-api.onrender.com/api/v2`
   - Local: `http://localhost:3000/api/v2`

2. **El Booking central entra** a su pestaña:
   `Microservicios & Integración` ➔ `Gestión de Proveedores`

3. **Clic en "➕ Registrar Proveedor"** e ingresa los datos del proveedor:
   - **Nombre:** `RentaFacil EC`
   - **Equipo:** `Anthony Rosero`
   - **URL base de la API:** `https://rentafacil-api.onrender.com/api/v2`
     (el campo acepta con o sin `/api/v2` al final)
   - **Tipo de servicio:** `Autos`

4. **Clic en "🔄" (Recheck / Ping):**
   - El Booking llama `GET {URL_BASE}/autos/health`.
   - Si responde `200 OK` con el schema `AutosHealthResponseV2`, el semáforo LED pasa a **🟢 verde**.
   - Si no responde o está en `DOWN`, pasa a **🔴 rojo**.
   - El Booking muestra la **latencia de respuesta en milisegundos**.

5. **Clic en "📥 Sincronizar":**
   - En aproximadamente 2 segundos, todos los vehículos del catálogo de RentaFacil quedan guardados en la base del Booking central y visibles para los clientes del marketplace multimodal.
   - El Booking consume `GET /autos` o `POST /autos/search` para obtener el inventario inicial.
   - A partir de ahí, los cambios de stock se transmiten en tiempo real por gRPC (puerto 50051) y/o eventos RabbitMQ.

---

## 3. Requisitos técnicos que debe cumplir RentaFacil EC

Para que el ping del Booking central nos dé 🟢 verde y la sincronización funcione:

### 3.1. Endpoint `/autos/health` obligatorio

- Debe responder en **menos de 500 ms**.
- Debe NO requerir autenticación (`security: []`).
- Schema exacto: `AutosHealthResponseV2` del contrato v2 (ver `backend/contracts/autos-openapi-v2.yaml`).
- Campos clave:
  - `status`: `HEALTHY` | `DEGRADED` | `DOWN`
  - `nodo_id`: `NODE_AUT_RENTAFACIL`
  - `nombre_proveedor`: `RentaFacil EC`
  - `vertical`: `AUTOS`
  - `version`: `2.0.0`
  - `uptime_seconds`, `latencia_ms`, `cooldown_activo_count`, `total_vehiculos`

### 3.2. CORS abierto a los orígenes del Booking central

Agregar a la lista de orígenes permitidos:

```
https://booking.epn.edu.ec
http://localhost:3000
http://localhost:5173
http://localhost:4000
```

Y exponer el header `X-Correlation-Id` para trazabilidad end-to-end.

### 3.3. Endpoint de catálogo inicial

El Booking central hace `GET /autos` o `POST /autos/search` para la sincronización inicial.
Debe retornar la lista completa de vehículos disponibles con el schema `AutoVehiculoCardV2`
(con todos los campos: `vehicle_id`, `marca`, `modelo`, `categoria`, `precio_diario`,
`estado`, `kilometraje_actual`, `foto_url`, etc.).

### 3.4. Push de stock por gRPC (puerto 50051)

Cuando un vehículo cambia de estado (`DISPONIBLE` → `RESERVADO`, etc.), debemos
enviar un `StockUpdateMessage` al Booking central vía gRPC:

- **Endpoint Booking central:** `grpc://booking.epn.edu.ec:50051` (en producción)
  o `grpc://localhost:50051` (en local).
- **Servicio:** `inventory.InventoryStockService`
- **RPC:** `PushStockUpdate(StockUpdateMessage) returns StockUpdateAck`

Si el Booking central no está disponible, el push falla en silencio y se registra
en `logs/error.log` + cola DLQ de RabbitMQ para reintento posterior.

### 3.5. Eventos CloudEvents a RabbitMQ

Cada cambio de estado emite un evento CloudEvent v1.0 al exchange
`booking.events` del RabbitMQ compartido con el Booking central:

- `auto.order.confirmed` (al crear orden)
- `auto.order.cancelled` (al cancelar / Saga)
- `auto.cooldown.started` (al devolver, inicia los 120 min)
- `auto.cooldown.ended` (al expirar el cooldown)
- `auto.mantenimiento.alerta` (al superar umbral km)
- `stock.actualizado` (cada cambio de inventario)

---

## 4. Prueba manual que puede hacer el profesor

Para que el profesor verifique que estamos bien integrados:

```bash
# 1. Verificar que respondemos saludables
curl https://rentafacil-api.onrender.com/api/v2/autos/health

# 2. Listar nuestro catálogo
curl https://rentafacil-api.onrender.com/api/v2/autos

# 3. Buscar vehículos con fecha
curl -X POST https://rentafacil-api.onrender.com/api/v2/autos/search \
  -H "Content-Type: application/json" \
  -H "X-Correlation-Id: test-prof-001" \
  -d '{
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

---

## 5. Datos para el formulario "Nuevo Proveedor"

Resumen de lo que el profesor debe ingresar en el Booking central para
registrarnos:

| Campo | Valor |
|---|---|
| Nombre | `RentaFacil EC` |
| Equipo | `Anthony Rosero` |
| URL base de la API | `https://rentafacil-api.onrender.com/api/v2` |
| Tipo de servicio | `Autos` |
| gRPC endpoint (si lo pide) | `rentafacil-grpc.onrender.com:50051` (o el que configuremos) |
| Contrato OpenAPI (referencia) | `/api/v2/docs-json` |

---

## 6. Compatibilidad hacia atrás

El Reto 1 sigue vivo en `/api/v1` por compatibilidad (así lo pide el contrato
oficial v2 en la sección `servers:`). El Booking central solo consumirá `/api/v2`.
No debemos romper `/api/v1` bajo ninguna circunstancia porque es la base del Reto 1
ya entregado.

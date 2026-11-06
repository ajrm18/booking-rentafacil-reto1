# 🚗 Guía de Despliegue en Azure y CloudAMQP para Socios de AUTOS
## Integración con Booking Prototipo (RDA2 — Semanas 9 y 10)

Esta guía está diseñada para que cualquier equipo de la categoría **AUTOS** (Renta de Vehículos, Flotas, Concesionarias) despliegue su microservicio en **Azure App Service (Linux B1)** y se conecte al **Event Bus RabbitMQ (CloudAMQP)** en minutos.

Contiene las instrucciones manuales previas y un **Prompt Maestro** para entregárselo directamente a su asistente de IA (Claude, Copilot, ChatGPT o Cursor) para que ejecute el despliegue de forma automatizada por terminal.

---

## 🎯 Requisitos de la Categoría AUTOS para Integrar con Booking

Para cumplir con la rúbrica **CE01, CE03, CE07 y CE10 (Condición Habilitante Obligatoria)**, su microservicio de Autos debe exponer en Internet:
1. **Endpoint de Salud / Telemetría:** `GET /api/v3/health` o `GET /api/v3/autos/health` (respondiendo en menos de 1 segundo).
2. **Búsqueda y Catálogo de Flota:** `GET /api/v3/autos` o `POST /api/v3/autos/search` (con datos de vehículos, marca, modelo, precio y stock).
3. **Creación de Reservas:** `POST /api/v3/autos/orders` (o `/reservas`).
4. **Push de Stock a Booking:** Notificar cambios de stock cuando se reserve o libere un vehículo, usando el endpoint REST oficial de Booking o publicando el evento en RabbitMQ.
5. **Seguridad:** Autenticación mediante la cabecera `X-API-Key`.

---

## 📋 Parte 1: Lo que debe hacer el estudiante (Paso a paso en 5 minutos)

### 1. Activar suscripción de Azure for Students
- Ingresa a [https://azure.microsoft.com/free/students](https://azure.microsoft.com/free/students) con tu correo institucional (`@puce.edu.ec`).
- Te otorga 100 USD de crédito sin tarjeta de crédito.

### 2. Instalar Azure CLI en tu máquina
Si aún no la tienes instalada en Windows, abre **PowerShell como Administrador**:
```powershell
winget install Microsoft.AzureCLI
```
*Cierra y vuelve a abrir PowerShell para que el comando `az` esté disponible.*

### 3. Iniciar sesión en Azure
```powershell
az login
```
- Se abrirá una ventana en tu navegador para autenticarte con tu cuenta PUCE.
- En la terminal aparecerá una lista de sedes/directorios universitarios (es normal). Al final verás **Azure for Students**: selecciona su número (usualmente `1`) y presiona `Enter`.

### 4. Cargar tus secretos en el Portal de Azure (cuando tu agente lo pida)
- Ve a [portal.azure.com](https://portal.azure.com) → Tu Web App → **Configuración** → **Variables de entorno**.
- Agrega las claves de tu base de datos (Supabase, PostgreSQL, etc.) y tu `API_KEY`.
- No compartas contraseñas sensibles en chats de IA.

---

## 🤖 Parte 2: Prompt Maestro para entregar a tu Agente de IA

Copia y pega el siguiente bloque en tu agente de programación (Claude Code, Antigravity, Cursor, ChatGPT o GitHub Copilot) dentro del proyecto de tu tienda de autos:

---

```text
Quiero desplegar el backend de nuestra tienda de AUTOS en Azure App Service (Linux, Plan B1) y conectarlo al Event Bus CloudAMQP para integrarnos con Booking Prototipo (RDA2). 

Ya tengo la sesión activa en Azure con 'az login' en la suscripción "Azure for Students".
Nombre propuesto para nuestra app en Azure: <NOMBRE_DE_TU_APP> (ejemplo: autorent-autos-api o maneja-autos-api).

Sigue estrictamente las lecciones aprendidas y directrices que funcionaron en Booking y RutaLibre:

1. RESTRICCIÓN DE REGIÓN EN AZURE FOR STUDENTS:
   - Microsoft restringe los recursos a ciertas regiones. Usa 'brazilsouth' (Brasil Sur) para que esté en la misma región y latencia ultrabaja que Booking Prototipo.
   - Registra el proveedor si falta: az provider register --namespace Microsoft.Web

2. CREACIÓN DE RECURSOS:
   - Grupo de recursos: rg-<NOMBRE_DE_TU_APP> (ubicación: brazilsouth).
   - Plan de App Service: plan-<NOMBRE_DE_TU_APP> --sku B1 --is-linux (el plan F1 gratis no soporta Always On).
   - Web App: az webapp create --resource-group rg-<NOMBRE_DE_TU_APP> --plan plan-<NOMBRE_DE_TU_APP> --name <NOMBRE_DE_TU_APP> --runtime "NODE:22-lts"

3. AJUSTES DEL RUNTIME Y CONFIGURACIÓN:
   - Always On activo (evita que la app se duerma): az webapp config set --always-on true
   - Tiempo de arranque extendido: WEBSITES_CONTAINER_START_TIME_LIMIT=600
   - Desactivar builds lentos en la nube (el paquete va precompilado):
     az webapp config appsettings set --settings SCM_DO_BUILD_DURING_DEPLOYMENT=false ENABLE_ORYX_BUILD=false
   - Puerto de escucha: la app debe escuchar en process.env.PORT || 8080 en 0.0.0.0.
   - Comando de inicio (Startup file): "node dist/main.js" (o el archivo de entrada compilado de tu proyecto).

4. CONEXIÓN CON BOOKING PROTOTIPO Y CLOUDAMQP:
   Configura en las variables de entorno de la app:
   - BOOKING_REST_STOCK_URL="https://booking-core-api.azurewebsites.net/api/v3/inventory/stock"
   - BOOKING_BASE_URL="https://booking-core-api.azurewebsites.net/api/v3"
   - RABBITMQ_URL="amqps://qkvqjvku:ATBxToI1JvR6YbRBIIAnATa5mnjdIqz_@shark.rmq.cloudamqp.com/qkvqjvku"
   - EVENT_BUS_MODE="rabbitmq"

5. EMPAQUETADO Y DESPLIEGUE SEGURO (CRÍTICO EN WINDOWS):
   - NO uses 'Compress-Archive' de PowerShell porque introduce barras invertidas '\' que rompen las rutas en Linux.
   - Usa un script de Python con 'zipfile' para crear un zip limpio que use barras POSIX '/' e incluya:
     * La carpeta compilada ('dist/' o 'build/').
     * 'package.json' y 'package-lock.json'.
     * 'node_modules/' de producción ('npm install --omit=dev' o 'npm prune --omit=dev').
     * Contratos y esquemas OpenAPI si aplica.
   - Despliega el archivo zip usando:
     az webapp deploy --resource-group rg-<NOMBRE_DE_TU_APP> --name <NOMBRE_DE_TU_APP> --src-path <RUTA_DEL_ZIP> --type zip --async true

6. VERIFICACIÓN Y AUDITORÍA:
   - Verifica que el endpoint de salud responda HTTP 200:
     GET https://<NOMBRE_DE_TU_APP>.azurewebsites.net/api/v3/health (o /autos/health)
   - Verifica que el catálogo responda:
     GET https://<NOMBRE_DE_TU_APP>.azurewebsites.net/api/v3/autos
   - Al finalizar, entrégame la URL pública y las credenciales formateadas según la Ficha Técnica para Booking.
```

---

## 📡 Parte 3: Contratos REST oficiales para la categoría AUTOS

Para que el agregador de Booking pueda consumir su catálogo, verificar la flota y crear órdenes, asegúrense de implementar o mantener estas rutas:

### 1. Healthcheck y Telemetría de Flota
* **Ruta:** `GET /api/v3/health` o `GET /api/v3/autos/health`
* **Autenticación:** Cabecera `X-API-Key`
* **Respuesta Esperada (`200 OK`):**
```json
{
  "status": "HEALTHY",
  "nodo_id": "NODE_AUT_<TU_CODIGO>",
  "nombre_proveedor": "Nombre de Tu Tienda de Autos",
  "vertical": "AUTOS",
  "version": "3.0.0",
  "uptime_seconds": 1250,
  "latencia_ms": 25,
  "total_vehiculos": 15,
  "circuit_breaker_estado": "CLOSED",
  "timestamp": "2026-10-28T22:00:00.000Z"
}
```

### 2. Catálogo y Búsqueda de Vehículos
* **Ruta:** `GET /api/v3/autos` o `POST /api/v3/autos/search`
* **Parámetros / Body:**
```json
{
  "ciudad": "Quito",
  "fecha_inicio": "2026-11-01",
  "fecha_fin": "2026-11-05",
  "categoria": "SEDAN"
}
```
* **Respuesta (`200 OK`):** Lista de vehículos con identificador único (`id`), modelo, marca, precio por día y unidades disponibles (`stock`).

### 3. Creación de Reserva / Orden
* **Ruta:** `POST /api/v3/autos/orders`
* **Body:**
```json
{
  "auto_id": "auto-001",
  "cliente_nombre": "Juan Pérez",
  "cliente_email": "juan@example.com",
  "fecha_inicio": "2026-11-01",
  "fecha_fin": "2026-11-05",
  "precio_total": 180.00
}
```

---

## 🔄 Parte 4: Notificación de Stock a Booking Prototipo

Cada vez que una reserva sea creada o cancelada en su tienda, deben avisar a Booking para mantener el inventario sincronizado. Tienen dos canales oficiales:

### Opción A (Recomendada en Azure): Push HTTP REST
* **Método y URL:** `POST https://booking-core-api.azurewebsites.net/api/v3/inventory/stock`
* **Headers:**
  * `Content-Type: application/json`
  * `X-API-Key: <TU_API_KEY_REGISTRADA>`
* **Cuerpo JSON:**
```json
{
  "item_id": "auto-001",
  "available_units": 3,
  "date": "2026-10-28",
  "reason": "ORDER_CREATED"
}
```
* **Respuesta de Booking (`200 OK`):**
```json
{
  "success": true,
  "acknowledged": true,
  "message": "Stock sincronizado exitosamente en Booking Prototipo para auto-001: 3 unidades disponibles.",
  "source": "HTTP_REST"
}
```

### Opción B: Event Bus Asíncrono (CloudAMQP RabbitMQ)
* **Broker:** `amqps://qkvqjvku:ATBxToI1JvR6YbRBIIAnATa5mnjdIqz_@shark.rmq.cloudamqp.com/qkvqjvku`
* **Exchange:** `booking.events` (Topic, Durable)
* **Routing Key:** `stock.updated`
* **Payload JSON:**
```json
{
  "service_id": "NODE_AUT_<TU_CODIGO>",
  "item_id": "auto-001",
  "available_units": 3,
  "date": "2026-10-28"
}
```

---

## ⚠️ Checklist de Errores Comunes y Soluciones Rápidas

| Error Típico | Causa en Azure | Solución |
| :--- | :--- | :--- |
| `SkuNotAvailable` al crear VM | Azure for Students no tiene cupos de hardware en máquinas virtuales. | **No uses VMs.** Usa App Service Plan B1 Linux (`az webapp create`). |
| `sh: 1: nest: not found` | Oryx en Azure intenta compilar en la nube sin `@nestjs/cli`. | Desactiva el build remoto: `SCM_DO_BUILD_DURING_DEPLOYMENT=false` y `ENABLE_ORYX_BUILD=false`. Sube la carpeta `dist/` precompilada. |
| `Cannot find module ...` | En Windows `Compress-Archive` empaquetó con barras invertidas `\`. | Usa el script Python `zipfile` para empaquetar con `/`. |
| `502 Bad Gateway` en subida | Subir `node_modules` completos con librerías de test/desarrollo supera 300 MB. | Ejecuta `npm prune --omit=dev` antes de empaquetar. El zip quedará entre 40 y 65 MB. |
| `401 Unauthorized` | Cabecera `X-API-Key` no coincide. | Asegúrate de enviar la clave acordada con Booking. |

---

## 📬 Ficha Técnica para Enviar a Paúl (Booking)

Una vez que su servicio esté desplegado y respondiendo `200 OK` en el health check, envíenle estos datos a Paúl para registrar formalmente su nodo en la plataforma central de Booking:

```text
📋 FICHA DE INTEGRACIÓN - TIENDA DE AUTOS
---------------------------------------------------------------
1. Nombre del sistema: <Nombre comercial de tu tienda>
2. Integrantes del equipo: <Nombres de los integrantes>
3. Código de nodo propuesto: NODE_AUT_<SIGLAS> (ej: NODE_AUT_MATEO, NODE_AUT_DANIEL)
4. URL base de la API REST en Azure: https://<tu-app>.azurewebsites.net/api/v3
5. URL directa del Healthcheck: https://<tu-app>.azurewebsites.net/api/v3/health (o /autos/health)
6. X-API-Key de tu microservicio: <Tu clave secreta>
7. Endpoint de Búsqueda de Vehículos: GET o POST /api/v3/autos/search
8. ¿Conectado a CloudAMQP de RabbitMQ?: [ SÍ / NO ]
---------------------------------------------------------------
```

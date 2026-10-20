# RentaFacil EC — Backend (GDS Autos Core API)

API NestJS + PostgreSQL de RentaFacil EC. Autor: Anthony Rosero.
La guía completa (local, despliegue, modelo de datos) está en el [README principal](../README.md).

## Contratos
- `backend/contracts/autos-openapi.yaml` — contrato GDS Autos Core v1.0.0
  (compartido por el profesor, implementado 1:1 por este backend).
- `backend/contracts/rentafacil-ec-openapi.yaml` — contrato interno propio de
  RentaFacil EC (APIs admin, auth y operacional). Autor: Anthony Rosero.
- `/api/docs` — Swagger UI con la unión de ambos.
- `/api/docs-json` — OpenAPI JSON generado desde el código.

```bash
npm run validate:contracts   # valida ambos YAML con @apidevtools/swagger-parser
```

## Pruebas
```bash
# Unitarias + e2e HTTP (Jest + supertest). Las que usan BD necesitan una base desechable:
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/rentafacil_test npm test
npm run test:unit
npm run test:e2e
```

## Devolución de vehículos
`POST /api/v1/admin/orders/{orderId}/return` registra la devolución sin cancelar la orden
(sigue `CONFIRMED`, con `returned_at` y `returned_by_sub`). El vehículo pasa a `WASHING` durante
24 h (`wash_until`); `/search` lo ofrece solo para recogidas desde `wash_until` y vuelve solo a
`AVAILABLE` al vencer (auto-sanado en cada `/search` y `/details`, sin worker).

/**
 * Valida los contratos OpenAPI del proyecto (sintaxis, $ref y esquema OpenAPI 3.0):
 *   - contracts/autos-openapi.yaml         (GDS Autos Core v1.0.0, oficial)
 *   - contracts/rentafacil-ec-openapi.yaml (interno de RentaFacil EC)
 * Uso: npm run validate:contracts
 */
import SwaggerParser from '@apidevtools/swagger-parser';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../contracts');
const contratos = ['autos-openapi.yaml', 'rentafacil-ec-openapi.yaml'];

let fallos = 0;
for (const archivo of contratos) {
  try {
    const api = await SwaggerParser.validate(path.join(dir, archivo));
    const ops = Object.values(api.paths).reduce(
      (n, item) => n + Object.keys(item).filter((k) => ['get', 'post', 'put', 'patch', 'delete'].includes(k)).length, 0);
    console.log(`\x1b[32m✔\x1b[0m ${archivo}: ${api.info.title} v${api.info.version} (${Object.keys(api.paths).length} rutas, ${ops} operaciones)`);
  } catch (e) {
    fallos++;
    console.log(`\x1b[31m✘\x1b[0m ${archivo}: ${e.message}`);
  }
}
process.exit(fallos ? 1 : 0);

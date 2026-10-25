import { readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { createTestApp, describeDb, TestApp } from '../helpers/test-app';

/**
 * Contract testing del proveedor: cada operacion de contracts/autos-openapi-v2.yaml tiene una ruta
 * registrada en /api/v2 (y viceversa, salvo las extensiones documentadas en el contrato propio).
 */
describeDb('Cobertura del contrato autos-openapi-v2.yaml', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => t.close());

  const aRegex = (p: string) => new RegExp(`^${p.replace(/\{[^}]+\}/g, '[^/]+').replace(/:[^/]+/g, '[^/]+')}$`);

  it('todas las operaciones del contrato estan implementadas bajo /api/v2', () => {
    const contrato: any = yaml.load(readFileSync(join(__dirname, '../../contracts/autos-openapi-v2.yaml'), 'utf8'));
    const operaciones = Object.entries(contrato.paths).flatMap(([p, item]: [string, any]) =>
      Object.keys(item).filter((m) => ['get', 'post', 'put', 'delete', 'patch'].includes(m)).map((m) => `${m.toUpperCase()} /api/v2${p}`));

    const rutas: string[] = t.app.getHttpAdapter().getInstance()._router.stack
      .filter((l: any) => l.route?.path?.startsWith('/api/v2/'))
      .flatMap((l: any) => Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${l.route.path}`));

    const faltantes = operaciones.filter((op) => {
      const [metodo, ruta] = op.split(' ');
      return !rutas.some((r) => { const [m, p] = r.split(' '); return m === metodo && aRegex(p).test(ruta.replace(/\{[^}]+\}/g, 'X')); });
    });
    expect(faltantes).toEqual([]);
    expect(operaciones.length).toBe(19);

    const extras = rutas.filter((r) => {
      const [m, p] = r.split(' ');
      return !operaciones.some((op) => { const [mo, po] = op.split(' '); return mo === m && aRegex(po).test(p.replace(/:[^/]+/g, 'X')); });
    });
    expect(extras).toEqual(['GET /api/v2/autos/:id/mantenimiento/bitacora']);
  });
});

import { ConflictException } from '@nestjs/common';
import { IdempotencyService } from '../../src/modules/integracion/idempotency.service';
import { UUID_V4 } from '../../src/modules/autos-v2/idempotency-v2.guard';

/** Repositorio en memoria de idempotency_records (findOne + insert ... ON CONFLICT DO NOTHING). */
function repoEnMemoria() {
  const filas = new Map<string, any>();
  return {
    filas,
    findOne: jest.fn(async ({ where }: any) => filas.get(where.idempotency_key) ?? null),
    createQueryBuilder: () => {
      let valores: any;
      const qb: any = {
        insert: () => qb, into: () => qb,
        values: (v: any) => { valores = v; return qb; },
        orIgnore: () => qb,
        execute: async () => { if (!filas.has(valores.idempotency_key)) filas.set(valores.idempotency_key, { ...valores }); },
      };
      return qb;
    },
  };
}

describe('Idempotencia de /api/v2 (checkin-devolucion y demas mutaciones)', () => {
  const clave = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

  it('el segundo POST con la misma Idempotency-Key devuelve la misma respuesta sin volver a ejecutar', async () => {
    const repo = repoEnMemoria();
    const svc = new IdempotencyService(repo as any);
    let ejecuciones = 0;
    const devolucion = async () => ({ success: true, km_recorridos: 450, ejecucion: ++ejecuciones });

    const a = await svc.ejecutar(clave, 'checkin-devolucion:ORDER-1', devolucion);
    const b = await svc.ejecutar(clave, 'checkin-devolucion:ORDER-1', devolucion);
    expect(b).toEqual(a);
    expect(ejecuciones).toBe(1);
  });

  it('la misma clave en otra operacion -> 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const svc = new IdempotencyService(repoEnMemoria() as any);
    await svc.ejecutar(clave, 'checkin-devolucion:ORDER-1', async () => ({ ok: true }));
    const err = await svc.ejecutar(clave, 'cancel:ORDER-2', async () => ({ ok: true })).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('los errores no se guardan: se puede corregir y reintentar con la misma clave', async () => {
    const repo = repoEnMemoria();
    const svc = new IdempotencyService(repo as any);
    await expect(svc.ejecutar(clave, 's', async () => { throw new Error('km_retorno < km_salida'); })).rejects.toThrow();
    expect(repo.filas.size).toBe(0);
    await expect(svc.ejecutar(clave, 's', async () => ({ ok: true }))).resolves.toEqual({ ok: true });
  });

  it('Idempotency-Key debe ser UUID v4', () => {
    expect(UUID_V4.test(clave)).toBe(true);
    expect(UUID_V4.test('9b1deb4d-3b7d-1bad-9bdd-2b0d7b3dcb6d')).toBe(false); // version 1
    expect(UUID_V4.test('no-es-uuid')).toBe(false);
  });
});

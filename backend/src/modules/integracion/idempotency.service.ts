import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IdempotencyRecord } from './entities/idempotency-record.entity';

/**
 * Idempotencia persistente de las mutaciones de /api/v2: la primera ejecucion exitosa de
 * (Idempotency-Key, scope) guarda su respuesta; los reintentos la reciben tal cual.
 * Los errores no se guardan, para que el cliente pueda corregir y reintentar con la misma clave.
 */
@Injectable()
export class IdempotencyService {
  constructor(@InjectRepository(IdempotencyRecord) private readonly repo: Repository<IdempotencyRecord>) {}

  async ejecutar<T>(clave: string, scope: string, fn: () => Promise<T>, statusCode = 200): Promise<T> {
    const previo = await this.repo.findOne({ where: { idempotency_key: clave } });
    if (previo) {
      if (previo.scope !== scope) {
        throw new ConflictException({
          type: 'https://booking.epn.edu.ec/errors/idempotency-key-reused',
          title: 'Idempotency-Key ya utilizada',
          status: 409,
          detail: `La Idempotency-Key ${clave} ya se uso en otra operacion (${previo.scope}). Genere un UUID v4 nuevo.`,
          code: 'IDEMPOTENCY_KEY_REUSED',
        });
      }
      return previo.response as T;
    }
    const resultado = await fn();
    await this.repo.createQueryBuilder().insert().into(IdempotencyRecord)
      .values({ idempotency_key: clave, scope, status_code: statusCode, response: resultado as any })
      .orIgnore().execute();
    return resultado;
  }
}

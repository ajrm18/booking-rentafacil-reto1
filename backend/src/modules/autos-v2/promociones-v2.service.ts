import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContratoPromociones } from './entities/contrato-promociones.entity';
import { invalido, ParametroInvalido } from './problema';
import { NODO } from '../integracion/nodo';

/** Fila unica del acuerdo B2B (proveedor_codigo pedido por la catedra para el seed). */
export const PROVEEDOR_PROMOCIONES = 'NODE_AUT_LOCAL';

export const CONTRATO_INICIAL = {
  permite_promociones: true,
  porcentaje_descuento_maximo: 15.0,
  destinos_habilitados: ['Quito', 'Guayaquil', 'Cuenca', 'Manta'],
  vigencia_hasta: '2026-12-31',
  condiciones_combo: 'Descuento autorizado del 15% en combos multivertical con hotel o vuelo.',
};

/** Cuestionario B2B de promociones y combos (Catedra RDA2 §9). */
@Injectable()
export class PromocionesV2Service implements OnModuleInit {
  private readonly logger = new Logger('Promociones');

  constructor(@InjectRepository(ContratoPromociones) private readonly repo: Repository<ContratoPromociones>) {}

  /** Seed idempotente: crea la fila con los valores iniciales solo si no existe. */
  async onModuleInit(): Promise<void> {
    try {
      await this.repo.createQueryBuilder().insert().into(ContratoPromociones)
        .values({ proveedor_codigo: PROVEEDOR_PROMOCIONES, nombre_socio: NODO.nombre, vertical: NODO.vertical, ...CONTRATO_INICIAL })
        .orIgnore().execute();
    } catch (e: any) {
      this.logger.warn(`No se pudo sembrar el contrato de promociones: ${e?.message}`);
    }
  }

  async obtener() {
    let c = await this.repo.findOne({ where: { proveedor_codigo: PROVEEDOR_PROMOCIONES } });
    if (!c) { await this.onModuleInit(); c = await this.repo.findOneByOrFail({ proveedor_codigo: PROVEEDOR_PROMOCIONES }); }
    return this.respuesta(c);
  }

  async actualizar(body: any, sub: string) {
    const b = body && typeof body === 'object' ? body : {};
    const errores: ParametroInvalido[] = [];
    if (typeof b.permite_promociones !== 'boolean') errores.push({ name: 'permite_promociones', reason: 'Booleano obligatorio (¿acepta participar en combos?)' });
    const pct = typeof b.porcentaje_descuento_maximo === 'number' ? b.porcentaje_descuento_maximo : NaN;
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) errores.push({ name: 'porcentaje_descuento_maximo', reason: 'Número obligatorio entre 0 y 100' });
    if (b.destinos_habilitados !== undefined && (!Array.isArray(b.destinos_habilitados)
      || b.destinos_habilitados.some((d: unknown) => typeof d !== 'string' || !d.trim() || d.length > 60))) {
      errores.push({ name: 'destinos_habilitados', reason: 'Lista de ciudades (texto de hasta 60 caracteres)' });
    }
    if (b.vigencia_hasta !== undefined && b.vigencia_hasta !== null
      && (typeof b.vigencia_hasta !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.vigencia_hasta) || isNaN(Date.parse(b.vigencia_hasta)))) {
      errores.push({ name: 'vigencia_hasta', reason: 'Fecha con formato YYYY-MM-DD' });
    }
    if (b.condiciones_combo !== undefined && b.condiciones_combo !== null && (typeof b.condiciones_combo !== 'string' || b.condiciones_combo.length > 500)) {
      errores.push({ name: 'condiciones_combo', reason: 'Texto de hasta 500 caracteres' });
    }
    if (b.permite_promociones === false && pct > 0) {
      errores.push({ name: 'porcentaje_descuento_maximo', reason: 'Debe ser 0 si no se aceptan promociones' });
    }
    if (errores.length) throw invalido(errores);

    const c = await this.repo.findOne({ where: { proveedor_codigo: PROVEEDOR_PROMOCIONES } })
      ?? this.repo.create({ proveedor_codigo: PROVEEDOR_PROMOCIONES, nombre_socio: NODO.nombre, vertical: NODO.vertical });
    c.permite_promociones = b.permite_promociones;
    c.porcentaje_descuento_maximo = Number(pct.toFixed(2));
    if (b.destinos_habilitados !== undefined) c.destinos_habilitados = [...new Set<string>(b.destinos_habilitados.map((d: string) => d.trim()))];
    if (b.vigencia_hasta !== undefined) c.vigencia_hasta = b.vigencia_hasta;
    if (b.condiciones_combo !== undefined) c.condiciones_combo = b.condiciones_combo?.trim() || null;
    c.actualizado_por = sub;
    const guardado = await this.repo.save(c);
    return {
      success: true,
      mensaje: 'Acuerdo B2B de promociones y combos actualizado exitosamente.',
      contrato: this.respuesta(guardado),
    };
  }

  private respuesta(c: ContratoPromociones) {
    const hoy = new Date().toISOString().slice(0, 10);
    return {
      proveedor_codigo: c.proveedor_codigo,
      nombre_socio: c.nombre_socio,
      vertical: c.vertical,
      permite_promociones: c.permite_promociones,
      porcentaje_descuento_maximo: Number(c.porcentaje_descuento_maximo),
      destinos_habilitados: c.destinos_habilitados ?? [],
      vigencia_hasta: c.vigencia_hasta,
      condiciones_combo: c.condiciones_combo,
      vigente: c.permite_promociones && (!c.vigencia_hasta || c.vigencia_hasta >= hoy),
      actualizado_por: c.actualizado_por,
      updated_at: c.updated_at ? new Date(c.updated_at).toISOString() : null,
    };
  }
}

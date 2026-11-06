import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, QueryFailedError, Repository } from 'typeorm';
import { log } from '../../common/app-logger';
import { invalido, ParametroInvalido, problema } from '../autos-v2/problema';
import { Cliente, OrigenCliente } from './cliente.entity';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface DatosCliente {
  nombre?: unknown; email?: unknown; identificacion?: unknown; telefono?: unknown; licencia?: unknown;
}

export interface ResultadoUpsert { cliente: Cliente; creado: boolean }

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim());
export const normEmail = (v: unknown) => texto(v).toLowerCase();
/** Cedula/pasaporte sin espacios ni guiones, en mayusculas (1710034065, AB123456). */
export const normIdentificacion = (v: unknown) => texto(v).replace(/[\s.-]/g, '').toUpperCase();

/** Vista publica del contrato v3.1 (GET /api/v3/clientes y POST con cliente existente). */
export const aClientePublico = (c: Cliente) => ({ client_id: c.client_id, nombre: c.nombre, email: c.email, identificacion: c.identificacion });

/**
 * Clientes cross-platform v3.1: un cliente creado en el Booking central que luego reserva en
 * RentaFacil (o al reves) se reconoce por email O identificacion y nunca se duplica.
 */
@Injectable()
export class ClientesService {
  constructor(@InjectRepository(Cliente) private readonly repo: Repository<Cliente>) {}

  /** Busca por email O identificacion (al menos uno obligatorio). */
  async buscar(email?: unknown, identificacion?: unknown): Promise<Cliente | null> {
    const e = normEmail(email), i = normIdentificacion(identificacion);
    if (!e && !i) {
      throw invalido([{ name: 'email|identificacion', reason: 'Envíe al menos uno de los parámetros email o identificacion' }]);
    }
    const qb = this.repo.createQueryBuilder('c');
    if (e) qb.orWhere('c.email = :e', { e });
    if (i) qb.orWhere('c.identificacion = :i', { i });
    // Prioridad al email cuando ambos coinciden con clientes distintos
    const filas = await qb.getMany();
    return filas.find((c) => c.email === e) ?? filas[0] ?? null;
  }

  validar(d: DatosCliente, exigirNombre = true): { nombre: string; email: string; identificacion: string; telefono: string | null; licencia: string | null } {
    const datos = {
      nombre: texto(d.nombre).slice(0, 200),
      email: normEmail(d.email),
      identificacion: normIdentificacion(d.identificacion),
      telefono: texto(d.telefono).slice(0, 20) || null,
      licencia: texto(d.licencia).slice(0, 30) || null,
    };
    const errores: ParametroInvalido[] = [];
    if (exigirNombre && datos.nombre.length < 2) errores.push({ name: 'nombre', reason: 'Nombre obligatorio (mínimo 2 caracteres)' });
    if (!EMAIL_RE.test(datos.email) || datos.email.length > 160) errores.push({ name: 'email', reason: 'Correo electrónico con formato válido obligatorio' });
    if (!datos.identificacion) errores.push({ name: 'identificacion', reason: 'Identificación (cédula o pasaporte) obligatoria' });
    else if (!/^[A-Z0-9]{5,20}$/.test(datos.identificacion)) errores.push({ name: 'identificacion', reason: 'Cédula o pasaporte de 5 a 20 caracteres alfanuméricos' });
    if (errores.length) throw invalido(errores);
    return datos;
  }

  /**
   * Upsert anti-duplicados: si el email O la identificacion ya existen devuelve el existente
   * (completando telefono/licencia si faltaban); si no, lo crea. Seguro ante carreras: un
   * INSERT que choca con el UNIQUE vuelve a leer el ganador.
   */
  async upsert(d: DatosCliente, origen: OrigenCliente): Promise<ResultadoUpsert> {
    const datos = this.validar(d);
    const existente = await this.buscar(datos.email, datos.identificacion);
    if (existente) {
      const faltantes: Partial<Cliente> = {};
      if (!existente.telefono && datos.telefono) faltantes.telefono = datos.telefono;
      if (!existente.licencia && datos.licencia) faltantes.licencia = datos.licencia;
      if (Object.keys(faltantes).length) {
        await this.repo.update({ client_id: existente.client_id }, faltantes);
        Object.assign(existente, faltantes);
      }
      log.info('CLIENTES', `upsert email=${datos.email} result=EXISTS`, { client_id: existente.client_id, origen: existente.origen });
      return { cliente: existente, creado: false };
    }
    try {
      const nuevo = await this.repo.save(this.repo.create({ ...datos, origen }));
      log.info('CLIENTES', `upsert email=${datos.email} result=CREATED`, { client_id: nuevo.client_id, origen });
      return { cliente: nuevo, creado: true };
    } catch (e) {
      if (e instanceof QueryFailedError && (e as any).driverError?.code === '23505') {
        const ganador = await this.buscar(datos.email, datos.identificacion);
        if (ganador) {
          log.info('CLIENTES', `upsert email=${datos.email} result=EXISTS`, { client_id: ganador.client_id, carrera: true });
          return { cliente: ganador, creado: false };
        }
      }
      throw e;
    }
  }

  // ── Panel admin /admin/clientes ──────────────────────────────────────────────

  async listar(q?: string, limit = 50): Promise<{ total: number; data: Cliente[] }> {
    const qb = this.repo.createQueryBuilder('c').orderBy('c.created_at', 'DESC').take(Math.min(Math.max(limit, 1), 200));
    const t = texto(q);
    if (t) {
      qb.where(new Brackets((w) => {
        w.where('c.nombre ILIKE :t', { t: `%${t}%` })
          .orWhere('c.email ILIKE :t', { t: `%${t}%` })
          .orWhere('c.identificacion ILIKE :t', { t: `%${t}%` });
      }));
    }
    const [data, total] = await qb.getManyAndCount();
    return { total, data };
  }

  async obtener(id: string): Promise<Cliente> {
    const c = /^[0-9a-f-]{36}$/i.test(id) ? await this.repo.findOne({ where: { client_id: id } }) : null;
    if (!c) throw problema(404, 'CLIENT_NOT_FOUND', `No existe el cliente ${id}.`, { title: 'Cliente no encontrado' });
    return c;
  }

  /** client_id de los clientes que coinciden con el buscador del mostrador (prefijo de email/cedula o nombre). */
  async idsCoincidentes(tipo: 'EMAIL' | 'IDENTIFICACION' | 'PNR', q: string): Promise<string[]> {
    const qb = this.repo.createQueryBuilder('c').select('c.client_id', 'id').take(50);
    if (tipo === 'EMAIL') qb.where('c.email LIKE :p', { p: `${normEmail(q)}%` });
    else if (tipo === 'IDENTIFICACION') qb.where('c.identificacion LIKE :p', { p: `${normIdentificacion(q)}%` });
    else qb.where('c.identificacion LIKE :p OR c.nombre ILIKE :n', { p: `${normIdentificacion(q)}%`, n: `%${texto(q)}%` });
    return (await qb.getRawMany()).map((f) => f.id);
  }

  async porIds(ids: (string | null | undefined)[]): Promise<Map<string, Cliente>> {
    const unicos = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unicos.length) return new Map();
    const filas = await this.repo.createQueryBuilder('c').where('c.client_id IN (:...ids)', { ids: unicos }).getMany();
    return new Map(filas.map((c) => [c.client_id, c]));
  }

  async actualizar(id: string, body: DatosCliente): Promise<Cliente> {
    const actual = await this.obtener(id);
    const datos = this.validar({
      nombre: body.nombre ?? actual.nombre, email: body.email ?? actual.email, identificacion: body.identificacion ?? actual.identificacion,
      telefono: body.telefono ?? actual.telefono, licencia: body.licencia ?? actual.licencia,
    });
    const choque = await this.repo.createQueryBuilder('c')
      .where('c.client_id <> :id', { id: actual.client_id })
      .andWhere(new Brackets((w) => w.where('c.email = :e', { e: datos.email }).orWhere('c.identificacion = :i', { i: datos.identificacion })))
      .getOne();
    if (choque) throw problema(409, 'CLIENT_DUPLICATED', 'Otro cliente ya usa ese email o esa identificación.', { title: 'Cliente duplicado' });
    await this.repo.update({ client_id: actual.client_id }, datos);
    log.info('CLIENTES', `PATCH client_id=${actual.client_id} -> UPDATED`);
    return this.obtener(actual.client_id);
  }
}

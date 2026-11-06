import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, IsNull, Repository } from 'typeorm';
import { log } from '../../common/app-logger';
import { Order } from '../autos/entities/order.entity';
import { Vehicle } from '../autos/entities/vehicle.entity';
import { aEstadoV2 } from '../autos/estado-vehiculo.mapper';
import { invalido, problema } from '../autos-v2/problema';
import { ReservasV2Service } from '../autos-v2/reservas-v2.service';
import { AuthV2 } from '../autos-v2/v2-auth.guard';
import { OrigenCliente } from '../clientes/cliente.entity';
import { ClientesService, normIdentificacion } from '../clientes/clientes.service';
import { BookingNotifierService } from './booking-notifier.service';
import { Checkin } from './entities/checkin.entity';
import { aV3, detectarTipo, estadoMostrador, TipoBusqueda } from './v3';

export interface CtxV3 { auth: AuthV2; idempotencyKey: string; correlationId: string; origen: OrigenCliente }

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim());

/**
 * Reservas del contrato v3.0.0 + requerimiento v3.1. Reutiliza la logica probada de v2 (Saga,
 * cooldown, triple check-in) y agrega: upsert del cliente cross-platform antes de crear la orden,
 * buscador del mostrador y check-in de entrega CONFIRMADO_ASISTIDO con notificacion al Booking.
 */
@Injectable()
export class ReservasV3Service {
  constructor(
    private readonly v2: ReservasV2Service,
    private readonly clientes: ClientesService,
    private readonly notificador: BookingNotifierService,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(Checkin) private readonly checkins: Repository<Checkin>,
  ) {}

  /** POST /api/v3/autos/orders/create (driver en ingles; alias en espanol tolerados). */
  async crear(body: any, ctx: CtxV3) {
    const r = await this.v2.crear(body, ctx, {
      resolverCliente: async (c) => {
        try {
          const { cliente } = await this.clientes.upsert({
            nombre: c.nombre, email: c.email, telefono: c.telefono, licencia: c.licencia_conducir,
            identificacion: c.identificacion || c.licencia_conducir,
          }, ctx.origen);
          return cliente.client_id;
        } catch (e: any) {
          // El modulo de clientes nunca bloquea una reserva valida
          log.warn('CLIENTES', `upsert email=${c.email} result=ERROR`, { error: e?.response?.detail ?? e?.message });
          return null;
        }
      },
    });
    const o = await this.orders.findOne({ where: { order_id: r.order_id } });
    return aV3({ ...r, vehicle_id: r.auto_id, voucher_qr_payload: r.voucher_qr_data, client_id: o?.fk_cliente ?? null });
  }

  async listar(auth: AuthV2) {
    return aV3(await this.v2.listar(auth));
  }

  async obtener(ref: string, auth: AuthV2) {
    const r = await this.v2.obtener(ref, auth);
    const o = await this.orders.findOne({ where: { order_id: r.order_id } });
    const v = o ? await this.vehicles.findOne({ where: { vehicle_id: o.vehicle_id } }) : null;
    return aV3({ ...r, vehicle_id: r.auto_id, voucher_qr_payload: r.voucher_qr_data, client_id: o?.fk_cliente ?? null, estado_mostrador: o ? estadoMostrador(o, v) : null });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Buscador del mostrador: PNR, identificacion/cedula o email
  // ═══════════════════════════════════════════════════════════════════════════

  async buscar(q: string, tipoPedido?: string, limit = 25) {
    const t = texto(q);
    if (t.length < 2) throw invalido([{ name: 'q', reason: 'Escriba al menos 2 caracteres (PNR, cédula o email)' }]);
    const tipo: TipoBusqueda = (['EMAIL', 'IDENTIFICACION', 'PNR'] as const).find((x) => x === String(tipoPedido ?? '').toUpperCase()) ?? detectarTipo(t);

    // 1) clientes que coinciden (db_identity) -> ids logicos
    const idsClientes = await this.clientes.idsCoincidentes(tipo, t);

    // 2) ordenes (db_orders) por PNR, datos del conductor o cliente vinculado
    const oq = this.orders.createQueryBuilder('o').orderBy('o.creation_date', 'DESC').take(Math.min(Math.max(limit, 1), 50));
    oq.where(new Brackets((w) => {
      if (tipo === 'EMAIL') {
        w.where("LOWER(o.driver_details->>'email') LIKE :e", { e: `${t.toLowerCase()}%` });
      } else if (tipo === 'IDENTIFICACION') {
        w.where("REPLACE(o.driver_details->>'licencia_conducir', '-', '') LIKE :i", { i: `${normIdentificacion(t)}%` })
          .orWhere("o.driver_details->>'identificacion' LIKE :i", { i: `${normIdentificacion(t)}%` });
      } else {
        w.where('o.locator ILIKE :pnr', { pnr: `%${t}%` })
          .orWhere("o.driver_details->>'nombre' ILIKE :n", { n: `%${t}%` })
          .orWhere("REPLACE(o.driver_details->>'licencia_conducir', '-', '') LIKE :i", { i: `${normIdentificacion(t)}%` });
      }
      if (idsClientes.length) w.orWhere('o.fk_cliente IN (:...ids)', { ids: idsClientes });
    }));
    const lista = await oq.getMany();
    const resultados = await this.tarjetas(lista);
    log.info('MOSTRADOR', `buscar q=${t} tipo=${tipo} -> ${resultados.length} resultado(s)`);
    return { q: t, tipo_detectado: tipo, total: resultados.length, resultados };
  }

  /** Tarjeta del buscador: PNR, estado visual, vehiculo (marca/modelo/placa), cliente y fechas. */
  async tarjetas(lista: Order[]) {
    const vs = lista.length ? await this.vehicles.find({ where: { vehicle_id: In([...new Set(lista.map((o) => o.vehicle_id))]) } }) : [];
    const vehiculos = new Map(vs.map((v) => [v.vehicle_id, v]));
    const clientes = await this.clientes.porIds(lista.map((o) => o.fk_cliente));
    const notifs = new Map<string, any>();
    for (const o of lista.filter((x) => x.checkin_entrega_at)) {
      const n = await this.notificador.deOrden(o.order_id);
      if (n) notifs.set(o.order_id, { id: n.id, status: n.status, attempts: n.attempts, last_status_code: n.last_status_code, sent_at: n.sent_at });
    }
    return lista.map((o) => {
      const v = vehiculos.get(o.vehicle_id);
      const c = o.fk_cliente ? clientes.get(o.fk_cliente) : undefined;
      const d = o.driver_details ?? {};
      const ruta = o.route_details ?? {};
      const estado = estadoMostrador(o, v);
      return {
        order_id: o.order_id,
        pnr: o.locator,
        estado_mostrador: estado,
        puede_entregar: estado === 'RESERVADO' || estado === 'PENDIENTE_ENTREGA',
        puede_devolver: estado === 'CONFIRMADO_ASISTIDO',
        vehiculo: {
          vehicle_id: o.vehicle_id,
          marca: v?.make ?? o.vehicle_details?.make, modelo: v?.model ?? o.vehicle_details?.model,
          placa: v?.plate ?? null, anio: v?.year ?? o.vehicle_details?.year ?? null,
          foto_url: v?.main_image_url ?? o.vehicle_details?.main_image_url ?? null,
          estado: v ? aEstadoV2(v.status) : null, kilometraje_actual: v?.kilometraje_actual ?? null,
        },
        cliente: {
          client_id: c?.client_id ?? o.fk_cliente ?? null,
          nombre: c?.nombre ?? d.nombre ?? null,
          identificacion: c?.identificacion ?? d.identificacion ?? d.licencia_conducir ?? null,
          email: c?.email ?? d.email ?? null,
          telefono: c?.telefono ?? d.telefono ?? null,
          licencia: c?.licencia ?? d.licencia_conducir ?? null,
        },
        recogida: { fecha_hora: ruta.pickup?.datetime ?? null, lugar: ruta.pickup?.location?.name ?? null },
        devolucion: { fecha_hora: ruta.dropoff?.datetime ?? null, lugar: ruta.dropoff?.location?.name ?? null },
        total: Number(o.total_price), moneda: o.currency, tipo_cobertura: o.tipo_cobertura,
        checkin_entrega: o.checkin_entrega_at ? { at: o.checkin_entrega_at.toISOString(), km_salida: o.km_salida, admin_id: o.tecnico_entrega } : null,
        notificacion_booking: notifs.get(o.order_id) ?? null,
        creada_at: o.creation_date?.toISOString?.() ?? null,
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Check-in de entrega asistido (boton "Confirmar Entrega de Llaves / Check-in")
  // ═══════════════════════════════════════════════════════════════════════════

  async checkinEntrega(ref: string, body: any, ctx: CtxV3) {
    const b = body && typeof body === 'object' ? body : {};
    if (b.acepta_contrato === false || b.acepto_contrato === false) {
      throw problema(422, 'INVALID_PAYLOAD', 'Debe confirmar que el contrato está firmado y la licencia es válida.',
        { title: 'Contrato no aceptado', invalid_params: [{ name: 'acepta_contrato', reason: 'Debe ser true' }] });
    }
    const v2Body = {
      licencia_conducir: b.licencia_conducir ?? b.numero_licencia ?? b.license_number,
      km_salida: b.km_salida ?? b.odometro ?? b.mileage_out,
      tecnico_entrega: b.tecnico_entrega,
    };
    const r = await this.v2.checkinEntrega(ref, v2Body, ctx);
    const o = await this.orders.findOneByOrFail({ order_id: r.order_id });

    // Solo la primera vez (un reintento con la misma Idempotency-Key no vuelve a notificar)
    const marca = await this.orders.update({ order_id: o.order_id, estado_asistido: IsNull() }, { estado_asistido: 'CONFIRMADO_ASISTIDO' });
    let notificacion: any = null;
    if (marca.affected) {
      await this.checkins.insert({
        order_id: o.order_id, pnr: o.locator, tipo: 'ENTREGA', vehicle_id: o.vehicle_id, client_id: o.fk_cliente,
        km: r.km_salida, licencia_presentada: r.licencia_verificada, admin_id: ctx.auth.sub, estado_resultante: 'CONFIRMADO_ASISTIDO',
        correlation_id: ctx.correlationId,
      }).catch((e) => log.warn('CHECKIN', `bitacora db_counter.checkins: ${e?.message}`));
      log.info('CHECKIN', `/orders/${o.locator}/checkin-entrega -> ENTREGADO | km_salida=${r.km_salida}`, { estado: 'CONFIRMADO_ASISTIDO', admin_id: ctx.auth.sub });
      const n = await this.notificador.notificarCheckin({
        order_id: o.order_id, pnr: o.locator, client_id: o.fk_cliente, admin_id: ctx.auth.sub,
        fecha_checkin: o.checkin_entrega_at ?? new Date(), correlationId: ctx.correlationId,
      });
      notificacion = n ? { id: n.id, status: 'PENDING', destino: n.url, modo: 'fire-and-forget' } : { status: 'NOT_CONFIGURED' };
    } else {
      const n = await this.notificador.deOrden(o.order_id);
      notificacion = n ? { id: n.id, status: n.status, destino: n.url, attempts: n.attempts } : null;
    }
    return aV3({
      ...r,
      estado_orden: 'CONFIRMADO_ASISTIDO',
      estado_vehiculo: 'ENTREGADO',
      client_id: o.fk_cliente,
      admin_id: ctx.auth.sub,
      notificacion_booking: notificacion,
      mensaje: 'Entrega confirmada. Vehículo entregado al cliente.',
    });
  }

  async checkinDevolucion(ref: string, body: any, ctx: CtxV3) {
    const r = await this.v2.checkinDevolucion(ref, body, ctx);
    await this.checkins.insert({
      order_id: r.order_id, pnr: r.pnr, tipo: 'DEVOLUCION', vehicle_id: r.cooldown?.auto_id ?? '', client_id: null,
      km: r.km_retorno, licencia_presentada: null, admin_id: ctx.auth.sub, estado_resultante: 'EN_LIMPIEZA', correlation_id: ctx.correlationId,
    }).catch(() => undefined);
    log.info('CHECKIN', `/orders/${r.pnr}/checkin-devolucion -> EN_LIMPIEZA | km_retorno=${r.km_retorno}`);
    return aV3(r);
  }

  async checkinDigital(ref: string, body: any, ctx: CtxV3) {
    const r = await this.v2.checkinDigital(ref, body, ctx);
    const o = await this.orders.findOne({ where: { order_id: r.reserva_id } });
    if (o) {
      await this.checkins.insert({
        order_id: o.order_id, pnr: o.locator, tipo: 'DIGITAL', vehicle_id: o.vehicle_id, client_id: o.fk_cliente,
        km: null, licencia_presentada: o.licencia_verificada, admin_id: ctx.auth.sub, estado_resultante: 'PENDIENTE_ENTREGA', correlation_id: ctx.correlationId,
      }).catch(() => undefined);
    }
    return aV3(r);
  }

  async cancelar(ref: string, body: any, ctx: CtxV3) {
    return aV3(await this.v2.cancelar(ref, body, ctx));
  }
}

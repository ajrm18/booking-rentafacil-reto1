import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, QueryFailedError, Repository } from 'typeorm';
import { randomBytes, randomUUID } from 'crypto';
import { calcularDisponibleDesde, Vehicle } from '../autos/entities/vehicle.entity';
import { Order } from '../autos/entities/order.entity';
import { aEstadoV2 } from '../autos/estado-vehiculo.mapper';
import { InventarioService } from '../integracion/inventario.service';
import { OutboxService } from '../integracion/outbox.service';
import { IdempotencyService } from '../integracion/idempotency.service';
import { EVENTOS } from '../integracion/nodo';
import { AuthV2, veTodo } from './v2-auth.guard';
import { invalido, ParametroInvalido, problema } from './problema';
import { assertReservable, calcularPrecio, evaluarEdad, FRANJA_30_MIN, normalizarCobertura, parsearPeriodo } from './reglas';
import { aCooldown, aOrdenV2, estadoOrdenV2, reservaVencida, voucherCheckin } from './v2.mapper';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PNR_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim());
const iso = (d: Date) => d.toISOString();
const entero = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const normLicencia = (s: string) => s.replace(/[\s-]/g, '').toUpperCase();

interface Ctx { auth: AuthV2; idempotencyKey: string; correlationId: string }

/** Reservas (Saga hold -> create -> cancel) y triple check-in de /api/v2 (HU-AUT-06). */
@Injectable()
export class ReservasV2Service {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    private readonly inventario: InventarioService,
    private readonly outbox: OutboxService,
    private readonly idem: IdempotencyService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  //  Consultas
  // ═══════════════════════════════════════════════════════════════════════════

  async listar(auth: AuthV2) {
    const lista = await this.orders.find({
      where: veTodo(auth) ? {} : { owner_sub: auth.sub },
      order: { creation_date: 'DESC' }, take: 500,
    });
    const vehiculos = await this.vehiculosDe(lista);
    return lista.map((o) => aOrdenV2(o, vehiculos.get(o.vehicle_id)));
  }

  async obtener(ref: string, auth: AuthV2) {
    const o = await this.buscarOrden(ref, auth);
    return aOrdenV2(o, await this.vehicles.findOne({ where: { vehicle_id: o.vehicle_id } }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  POST /autos/orders/create (y alias /autos/reservas)
  // ═══════════════════════════════════════════════════════════════════════════

  async crear(body: any, ctx: Ctx) {
    const b = body && typeof body === 'object' ? body : {};
    const vehicleId = texto(b.vehicle_id ?? b.auto_id);

    // Idempotencia: la misma clave devuelve la misma orden (orders.idempotency_key, como en v1)
    const previa = await this.orders.findOne({ where: { idempotency_key: ctx.idempotencyKey } });
    if (previa) return this.repetida(previa, vehicleId);

    const errores: ParametroInvalido[] = [];
    if (!vehicleId) errores.push({ name: 'vehicle_id', reason: 'Campo obligatorio (o su alias auto_id)' });
    const c = b.conductor && typeof b.conductor === 'object' ? b.conductor : null;
    if (!c) errores.push({ name: 'conductor', reason: 'Campo obligatorio' });
    const conductor = {
      nombre: texto(c?.nombre ?? c?.nombre_completo ?? c?.full_name),
      email: texto(c?.email ?? c?.correo).toLowerCase(),
      telefono: texto(c?.telefono ?? c?.phone),
      licencia_conducir: texto(c?.licencia_conducir),
      pais_licencia: texto(c?.pais_licencia) || null,
      edad: c?.edad ?? c?.edad_conductor ?? c?.driver_age ?? null,
      numero_vuelo: texto(c?.numero_vuelo) || null,
    };
    if (c) {
      if (conductor.nombre.length < 3) errores.push({ name: 'conductor.nombre', reason: 'Nombre del conductor obligatorio (mínimo 3 caracteres)' });
      if (!EMAIL.test(conductor.email)) errores.push({ name: 'conductor.email', reason: 'Correo electrónico válido obligatorio' });
      if (!/^\+?[0-9\s-]{7,20}$/.test(conductor.telefono)) errores.push({ name: 'conductor.telefono', reason: 'Teléfono obligatorio (7 a 20 dígitos)' });
      if (!/^[A-Za-z0-9-]{5,20}$/.test(conductor.licencia_conducir)) errores.push({ name: 'conductor.licencia_conducir', reason: 'Número de licencia obligatorio (5 a 20 caracteres alfanuméricos)' });
    }
    const horas = { pickup_time: texto(b.hora_recogida ?? b.pickup_time) || '10:00', dropoff_time: texto(b.hora_devolucion ?? b.dropoff_time) || '10:00' };
    for (const [k, alias] of [['pickup_time', 'hora_recogida'], ['dropoff_time', 'hora_devolucion']] as const) {
      if (!FRANJA_30_MIN.test(horas[k])) errores.push({ name: alias, reason: 'Franja horaria estricta de 30 minutos (ej. 10:00 o 10:30)' });
    }
    if (!texto(b.pickup_date ?? b.fecha_recogida)) errores.push({ name: 'pickup_date', reason: 'Campo obligatorio (o su alias fecha_recogida)' });
    if (!texto(b.dropoff_date ?? b.fecha_devolucion)) errores.push({ name: 'dropoff_date', reason: 'Campo obligatorio (o su alias fecha_devolucion)' });
    if (errores.length) throw invalido(errores);

    const periodo = parsearPeriodo(
      { pickup_date: texto(b.pickup_date ?? b.fecha_recogida), dropoff_date: texto(b.dropoff_date ?? b.fecha_devolucion), ...horas },
      { pickup_date: 'pickup_date', dropoff_date: 'dropoff_date', pickup_time: 'hora_recogida', dropoff_time: 'hora_devolucion' },
    );
    const edad = evaluarEdad(conductor.edad, 'conductor.edad');
    const cobertura = normalizarCobertura(b.tipo_cobertura ?? b.cobertura, b.tipo_cobertura !== undefined ? 'tipo_cobertura' : 'cobertura');

    await this.inventario.liberarCooldownsVencidos(ctx.correlationId);
    const v = await this.vehicles.findOne({ where: { vehicle_id: vehicleId } });
    if (!v) throw problema(404, 'VEHICLE_NOT_FOUND', `No existe el vehículo ${vehicleId} en la flota.`, { title: 'Vehículo no encontrado' });
    assertReservable(v);

    const desglose = calcularPrecio(Number(v.price_per_day), periodo.dias, cobertura, edad);
    const lugarRecogida = texto(b.pickup_location ?? b.lugar_recogida) || null;
    const lugarDevolucion = texto(b.dropoff_location ?? b.lugar_devolucion) || lugarRecogida;

    let guardada: Order;
    try {
      guardada = await this.ds.transaction(async (m) => {
        // DISPONIBLE -> RESERVADO condicionado: dos reservas simultaneas no se llevan el mismo auto
        const r = await m.createQueryBuilder().update(Vehicle).set({ status: 'RESERVED', wash_until: null })
          .where("vehicle_id = :id AND status = 'AVAILABLE'", { id: v.vehicle_id }).execute();
        if (!r.affected) {
          assertReservable(await m.findOneByOrFail(Vehicle, { vehicle_id: v.vehicle_id }));
          throw problema(409, 'VEHICLE_NOT_AVAILABLE', `El vehículo ${v.vehicle_id} acaba de ser reservado.`, { title: 'Vehículo no disponible' });
        }
        const o = await m.save(m.create(Order, {
          locator: await this.nuevoPnr(m),
          status: 'CONFIRMED',
          vehicle_id: v.vehicle_id,
          owner_sub: ctx.auth.sub,
          payment_reference: texto(b.payment_reference) || null,
          vehicle_details: {
            vehicle_id: v.vehicle_id, make: v.make, model: v.model, year: v.year,
            supplier_id: v.supplier_id, depot_id: v.depot_id, main_image_url: v.main_image_url,
          },
          route_details: {
            pickup: { datetime: iso(periodo.pickup), location: { name: lugarRecogida, depot_id: v.depot_id } },
            dropoff: { datetime: iso(periodo.dropoff), location: { name: lugarDevolucion, depot_id: v.depot_id } },
          },
          driver_details: conductor,
          extras: [],
          total_price: desglose.total,
          currency: 'USD',
          idempotency_key: ctx.idempotencyKey,
          tipo_cobertura: cobertura,
          desglose_precio: desglose,
        }));
        await this.outbox.registrar(m, EVENTOS.ORDEN_CONFIRMADA, {
          order_id: o.order_id, pnr: o.locator, auto_id: v.vehicle_id, total_price: desglose.total,
          tipo_cobertura: cobertura, nuevo_estado_auto: 'RESERVADO',
        }, { subject: o.order_id, correlationId: ctx.correlationId });
        await this.inventario.registrarCambio(m, { vehicle_id: v.vehicle_id, status: 'RESERVED' }, 'order.confirmed', ctx.correlationId, periodo.pickup);
        return o;
      });
    } catch (e) {
      // Reintento concurrente con la misma Idempotency-Key: gana la primera orden
      if (e instanceof QueryFailedError && (e as any).driverError?.code === '23505') {
        const otra = await this.orders.findOne({ where: { idempotency_key: ctx.idempotencyKey } });
        if (otra) return this.repetida(otra, vehicleId);
      }
      throw e;
    }
    this.inventario.notificarStock({ vehicle_id: v.vehicle_id, status: 'RESERVED' }, periodo.pickup);
    return aOrdenV2(guardada, { ...v, status: 'RESERVED' } as Vehicle);
  }

  private async repetida(o: Order, vehicleId: string) {
    if (vehicleId && vehicleId !== o.vehicle_id) {
      throw problema(409, 'IDEMPOTENCY_KEY_REUSED',
        `La Idempotency-Key ya se usó para reservar ${o.vehicle_id}; genere un UUID v4 nuevo para otra reserva.`,
        { title: 'Conflicto de idempotencia' });
    }
    return aOrdenV2(o, await this.vehicles.findOne({ where: { vehicle_id: o.vehicle_id } }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  POST /autos/orders/{orderId}/cancel — compensacion Saga con reembolso 100 %
  // ═══════════════════════════════════════════════════════════════════════════

  async cancelar(ref: string, body: any, ctx: Ctx) {
    const o = await this.buscarOrden(ref, ctx.auth);
    const solicitante = texto(body?.solicitante).toUpperCase() || (ctx.auth.rol === 'CLIENTE' ? 'CLIENTE' : ctx.auth.rol === 'B2B' ? 'SAGA_ORCHESTRATOR' : 'ADMIN');
    if (!['CLIENTE', 'SAGA_ORCHESTRATOR', 'ADMIN'].includes(solicitante)) {
      throw invalido([{ name: 'solicitante', reason: 'Debe ser CLIENTE, SAGA_ORCHESTRATOR o ADMIN' }]);
    }
    const motivo = (texto(body?.motivo ?? body?.reason) || null)?.slice(0, 300) ?? null;

    return this.idem.ejecutar(ctx.idempotencyKey, `cancel:${o.order_id}`, async () => {
      const actual = await this.orders.findOneByOrFail({ order_id: o.order_id });
      if (actual.status === 'CANCELLED') {
        throw problema(409, 'ORDER_ALREADY_CANCELLED', `La orden ${actual.locator} ya estaba cancelada (reembolso ${actual.refund_id ?? 'procesado'}).`);
      }
      if (actual.checkin_devolucion_at || actual.returned_at) {
        throw problema(409, 'CANCELLATION_NOT_ALLOWED', `La orden ${actual.locator} ya fue completada (vehículo devuelto).`);
      }
      if (!actual.checkin_entrega_at && reservaVencida(actual)) {
        throw problema(409, 'ORDER_EXPIRED', `La reserva ${actual.locator} ya venció; no hay nada que reembolsar.`);
      }
      if (actual.checkin_entrega_at) {
        throw problema(409, 'CANCELLATION_NOT_ALLOWED', `El vehículo de la orden ${actual.locator} ya fue entregado; registre el check-in de devolución.`);
      }
      const refundId = `REF-AUTO-${randomBytes(3).toString('hex').toUpperCase()}`;
      let restituido: Vehicle | null = null;
      await this.ds.transaction(async (m) => {
        const r = await m.update(Order, { order_id: actual.order_id, status: 'CONFIRMED' }, {
          status: 'CANCELLED', refund_id: refundId, cancelled_at: new Date(), motivo_cancelacion: motivo,
        });
        if (!r.affected) throw problema(409, 'ORDER_ALREADY_CANCELLED', `La orden ${actual.locator} ya no está confirmada.`);
        // Compensacion LIFO: el auto vuelve a DISPONIBLE si seguia retenido por esta reserva
        const rv = await m.createQueryBuilder().update(Vehicle).set({ status: 'AVAILABLE' })
          .where("vehicle_id = :id AND status IN ('RESERVED', 'READY_FOR_PICKUP')", { id: actual.vehicle_id }).execute();
        if (rv.affected) {
          restituido = await m.findOneBy(Vehicle, { vehicle_id: actual.vehicle_id });
          await this.inventario.registrarCambio(m, { vehicle_id: actual.vehicle_id, status: 'AVAILABLE' }, 'order.cancelled', ctx.correlationId);
        }
        await this.outbox.registrar(m, EVENTOS.ORDEN_CANCELADA, {
          order_id: actual.order_id, pnr: actual.locator, auto_id: actual.vehicle_id, refund_id: refundId,
          refund_amount: Number(actual.total_price), refund_percentage: 100, estado_restituido: rv.affected ? 'DISPONIBLE' : null,
          solicitante, motivo,
        }, { subject: actual.order_id, correlationId: ctx.correlationId });
      });
      if (restituido) this.inventario.notificarStock({ vehicle_id: actual.vehicle_id, status: 'AVAILABLE' });
      const estadoAuto = (restituido as Vehicle | null)?.status;
      return {
        order_id: actual.order_id,
        pnr: actual.locator,
        status: 'CANCELLED',
        auto_id: actual.vehicle_id,
        solicitante,
        refund: { refund_id: refundId, amount: Number(actual.total_price), currency: actual.currency, percentage: 100, status: 'PROCESSED' },
        inventory_restoration: {
          status: estadoAuto ? 'RESTORED' : 'NOT_REQUIRED',
          vehicle_id: actual.vehicle_id,
          new_state: estadoAuto ? 'DISPONIBLE' : null,
        },
        message: 'Orden de renta cancelada exitosamente. Vehículo liberado y reembolso procesado.',
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Check-in 1: digital anticipado (cliente) -> LISTO_PARA_ENTREGAR + voucher QR
  // ═══════════════════════════════════════════════════════════════════════════

  async checkinDigital(ref: string, body: any, ctx: Ctx) {
    const o = await this.buscarOrden(ref, ctx.auth);
    const documento = texto(body?.documento_identidad);
    const licencia = texto(body?.numero_licencia) || documento;
    const vence = texto(body?.fecha_vencimiento_licencia);
    const errores: ParametroInvalido[] = [];
    if (!/^[A-Za-z0-9-]{5,20}$/.test(documento)) errores.push({ name: 'documento_identidad', reason: 'Documento obligatorio (5 a 20 caracteres alfanuméricos)' });
    if (!/^[A-Za-z0-9-]{5,20}$/.test(licencia)) errores.push({ name: 'numero_licencia', reason: 'Número de licencia inválido (5 a 20 caracteres alfanuméricos)' });
    if (vence && (!/^\d{4}-\d{2}-\d{2}$/.test(vence) || isNaN(Date.parse(vence)))) errores.push({ name: 'fecha_vencimiento_licencia', reason: 'Formato YYYY-MM-DD' });
    if (errores.length) throw invalido(errores);
    const fin = String(o.route_details?.dropoff?.datetime ?? '').slice(0, 10);
    if (vence && fin && vence < fin) {
      throw problema(400, 'LICENSE_EXPIRED', `La licencia vence el ${vence}, antes de terminar el alquiler (${fin}).`,
        { title: 'Licencia vencida para el periodo de alquiler', invalid_params: [{ name: 'fecha_vencimiento_licencia', reason: 'Debe estar vigente hasta la devolución' }] });
    }

    return this.idem.ejecutar(ctx.idempotencyKey, `checkin-digital:${o.order_id}`, async () => {
      const actual = await this.orders.findOneByOrFail({ order_id: o.order_id });
      this.exigirConfirmada(actual);
      if (actual.checkin_entrega_at) throw problema(409, 'ORDER_ALREADY_DELIVERED', `La orden ${actual.locator} ya pasó por la entrega en mostrador.`);
      let listo = false;
      if (!actual.checkin_digital_at) {
        await this.ds.transaction(async (m) => {
          await m.update(Order, { order_id: actual.order_id }, { checkin_digital_at: new Date(), licencia_verificada: licencia });
          const r = await m.createQueryBuilder().update(Vehicle).set({ status: 'READY_FOR_PICKUP' })
            .where("vehicle_id = :id AND status = 'RESERVED'", { id: actual.vehicle_id }).execute();
          listo = !!r.affected;
          if (listo) await this.inventario.registrarCambio(m, { vehicle_id: actual.vehicle_id, status: 'READY_FOR_PICKUP' }, 'checkin.digital', ctx.correlationId);
        });
      }
      if (listo) this.inventario.notificarStock({ vehicle_id: actual.vehicle_id, status: 'READY_FOR_PICKUP' });
      const o2 = await this.orders.findOneByOrFail({ order_id: actual.order_id });
      const v = await this.vehicles.findOne({ where: { vehicle_id: o2.vehicle_id } });
      return {
        reserva_id: o2.order_id,
        pnr: o2.locator,
        checkin_status: 'CHECKIN_COMPLETED',
        fast_track_pickup: true,
        estado_vehiculo: v ? aEstadoV2(v.status) : null,
        checkin_digital_at: o2.checkin_digital_at!.toISOString(),
        mensaje: 'Check-in digital exitoso. Presenta tu código QR en el mostrador para retiro express.',
        voucher_qr_data: voucherCheckin(o2),
        requisitos: [
          'Licencia de conducir física (la misma registrada en el check-in digital)',
          'Documento de identidad',
          'Tarjeta de crédito del conductor principal',
        ],
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Check-in 2: entrega en mostrador (agente) -> ENTREGADO, km_salida
  // ═══════════════════════════════════════════════════════════════════════════

  async checkinEntrega(ref: string, body: any, ctx: Ctx) {
    const o = await this.buscarOrden(ref, ctx.auth);
    const licencia = texto(body?.licencia_conducir);
    const km = entero(body?.km_salida);
    const errores: ParametroInvalido[] = [];
    if (!licencia) errores.push({ name: 'licencia_conducir', reason: 'Campo obligatorio' });
    if (!Number.isInteger(km) || km < 0 || km > 2_000_000) errores.push({ name: 'km_salida', reason: 'Lectura del odómetro obligatoria (entero >= 0)' });
    if (errores.length) throw invalido(errores);
    const tecnico = (texto(body?.tecnico_entrega) || ctx.auth.sub).slice(0, 120);

    return this.idem.ejecutar(ctx.idempotencyKey, `checkin-entrega:${o.order_id}`, async () => {
      const actual = await this.orders.findOneByOrFail({ order_id: o.order_id });
      this.exigirConfirmada(actual);
      if (actual.checkin_entrega_at) throw problema(409, 'ORDER_ALREADY_DELIVERED', `Las llaves de la orden ${actual.locator} ya se entregaron (${actual.checkin_entrega_at.toISOString()}).`);
      const esperada = actual.licencia_verificada ?? actual.driver_details?.licencia_conducir;
      if (esperada && normLicencia(String(esperada)) !== normLicencia(licencia)) {
        throw problema(400, 'LICENSE_MISMATCH', 'La licencia física presentada no coincide con la registrada en la reserva.',
          { title: 'Licencia no coincide', invalid_params: [{ name: 'licencia_conducir', reason: 'No coincide con la licencia de la reserva' }] });
      }
      const v = await this.vehicles.findOneByOrFail({ vehicle_id: actual.vehicle_id });
      if (!['RESERVED', 'READY_FOR_PICKUP'].includes(v.status)) {
        throw problema(409, 'VEHICLE_NOT_READY', `El vehículo ${v.vehicle_id} no está reservado para esta orden (estado ${aEstadoV2(v.status)}).`);
      }
      if (km < (v.kilometraje_actual ?? 0)) {
        throw invalido([{ name: 'km_salida', reason: `No puede ser menor que el odómetro registrado (${v.kilometraje_actual} km)` }]);
      }
      await this.ds.transaction(async (m) => {
        await m.update(Order, { order_id: actual.order_id }, {
          checkin_entrega_at: new Date(), km_salida: km, tecnico_entrega: tecnico, licencia_verificada: licencia,
        });
        await m.update(Vehicle, { vehicle_id: v.vehicle_id }, { status: 'DELIVERED', kilometraje_actual: km });
        await this.inventario.registrarCambio(m, { vehicle_id: v.vehicle_id, status: 'DELIVERED' }, 'checkin.entrega', ctx.correlationId);
      });
      this.inventario.notificarStock({ vehicle_id: v.vehicle_id, status: 'DELIVERED' });
      return {
        success: true,
        order_id: actual.order_id,
        pnr: actual.locator,
        estado_orden: 'ENTREGADO',
        estado_vehiculo: 'ENTREGADO',
        km_salida: km,
        licencia_verificada: licencia,
        tecnico_entrega: tecnico,
        checkin_entrega_at: new Date().toISOString(),
        mensaje: 'Llaves entregadas al conductor. Auto en tránsito (Fase ENTREGADO).',
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Check-in 3: devolucion en patio (agente) -> EN_LIMPIEZA 2 h, km_retorno
  // ═══════════════════════════════════════════════════════════════════════════

  async checkinDevolucion(ref: string, body: any, ctx: Ctx) {
    const o = await this.buscarOrden(ref, ctx.auth);
    const km = entero(body?.km_retorno);
    const combustible = body?.nivel_combustible === undefined || body?.nivel_combustible === null ? null : entero(body.nivel_combustible);
    const observaciones = texto(body?.observaciones).slice(0, 1000) || null;
    const errores: ParametroInvalido[] = [];
    if (!Number.isInteger(km) || km < 0 || km > 2_000_000) errores.push({ name: 'km_retorno', reason: 'Lectura del odómetro obligatoria (entero >= 0)' });
    if (combustible !== null && (!Number.isInteger(combustible) || combustible < 0 || combustible > 100)) {
      errores.push({ name: 'nivel_combustible', reason: 'Porcentaje entero de 0 a 100' });
    }
    if (errores.length) throw invalido(errores);

    return this.idem.ejecutar(ctx.idempotencyKey, `checkin-devolucion:${o.order_id}`, async () => {
      const actual = await this.orders.findOneByOrFail({ order_id: o.order_id });
      if (actual.status === 'CANCELLED') throw problema(409, 'ORDER_CANCELLED', `La orden ${actual.locator} está cancelada.`);
      if (actual.checkin_devolucion_at || actual.returned_at) {
        throw problema(409, 'ORDER_ALREADY_RETURNED', `El vehículo de la orden ${actual.locator} ya fue devuelto.`);
      }
      if (!actual.checkin_entrega_at || actual.km_salida == null) {
        throw problema(409, 'ORDER_NOT_DELIVERED', `La orden ${actual.locator} no tiene check-in de entrega: no hay km_salida contra el cual comparar.`);
      }
      if (km < actual.km_salida) {
        throw invalido([{ name: 'km_retorno', reason: `Debe ser mayor o igual que km_salida (${actual.km_salida})` }]);
      }
      const ahora = new Date();
      const disponibleDesde = calcularDisponibleDesde(ahora);
      const recorridos = km - actual.km_salida;
      const v = await this.vehicles.findOneByOrFail({ vehicle_id: actual.vehicle_id });
      const alerta = km >= v.proximo_mantenimiento_km;

      await this.ds.transaction(async (m) => {
        const r = await m.update(Order, { order_id: actual.order_id, checkin_devolucion_at: IsNull() }, {
          checkin_devolucion_at: ahora, km_retorno: km, nivel_combustible_retorno: combustible,
          observaciones_devolucion: observaciones, returned_at: ahora, returned_by_sub: ctx.auth.sub,
        });
        if (!r.affected) throw problema(409, 'ORDER_ALREADY_RETURNED', `El vehículo de la orden ${actual.locator} ya fue devuelto.`);
        await m.update(Vehicle, { vehicle_id: v.vehicle_id }, {
          status: 'WASHING', wash_until: disponibleDesde, kilometraje_actual: km,
          mantenimiento_requerido: alerta || v.mantenimiento_requerido,
        });
        await this.outbox.registrar(m, EVENTOS.COOLDOWN_INICIADO, {
          auto_id: v.vehicle_id, estado: 'EN_LIMPIEZA', cooldown_minutos: 120, disponible_desde: iso(disponibleDesde),
          order_id: actual.order_id, pnr: actual.locator, km_recorridos: recorridos,
        }, { subject: v.vehicle_id, correlationId: ctx.correlationId });
        if (alerta) {
          await this.outbox.registrar(m, EVENTOS.MANTENIMIENTO_ALERTA, {
            auto_id: v.vehicle_id, kilometraje_actual: km, proximo_mantenimiento_km: v.proximo_mantenimiento_km,
            severidad: km - v.proximo_mantenimiento_km >= 1000 ? 'CRITICAL' : 'WARNING', origen: 'checkin-devolucion',
          }, { subject: v.vehicle_id, correlationId: ctx.correlationId });
        }
        await this.inventario.registrarCambio(m, { vehicle_id: v.vehicle_id, status: 'WASHING' }, 'cooldown.started', ctx.correlationId);
      });
      this.inventario.notificarStock({ vehicle_id: v.vehicle_id, status: 'WASHING' });

      return {
        success: true,
        order_id: actual.order_id,
        pnr: actual.locator,
        estado_orden: 'COMPLETADA',
        km_salida: actual.km_salida,
        km_retorno: km,
        km_recorridos: recorridos,
        nivel_combustible: combustible,
        observaciones,
        checkin_devolucion_at: iso(ahora),
        cooldown: aCooldown({ ...v, status: 'WASHING', wash_until: disponibleDesde }),
        mantenimiento_requerido: alerta || v.mantenimiento_requerido,
        alerta_mantenimiento: alerta
          ? `ALERTA PREVENTIVA: el vehículo alcanzó ${km} km y superó el umbral de ${v.proximo_mantenimiento_km} km. Mantenimiento requerido.`
          : `Kilometraje en rango normal. Próximo mantenimiento a los ${v.proximo_mantenimiento_km} km.`,
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Utilidades
  // ═══════════════════════════════════════════════════════════════════════════

  /** Orden por UUID o PNR. Un CLIENTE solo ve las suyas (404 para no revelar que existen). */
  async buscarOrden(ref: string, auth: AuthV2): Promise<Order> {
    const r = texto(ref);
    const o = UUID.test(r)
      ? await this.orders.findOne({ where: { order_id: r } })
      : await this.orders.createQueryBuilder('o').where('UPPER(o.locator) = UPPER(:r)', { r }).getOne();
    if (!o || (!veTodo(auth) && o.owner_sub !== auth.sub)) {
      throw problema(404, 'ORDER_NOT_FOUND', `No existe la orden o reserva ${r}.`, { title: 'Reserva no encontrada' });
    }
    return o;
  }

  private exigirConfirmada(o: Order): void {
    if (o.status !== 'CONFIRMED') throw problema(409, 'ORDER_NOT_CONFIRMED', `La orden ${o.locator} está en estado ${estadoOrdenV2(o)}.`);
    if (o.checkin_devolucion_at || o.returned_at) throw problema(409, 'ORDER_ALREADY_RETURNED', `La orden ${o.locator} ya fue completada.`);
    if (!o.checkin_entrega_at && reservaVencida(o)) {
      throw problema(409, 'ORDER_EXPIRED', `La reserva ${o.locator} venció: su fecha de devolución ya pasó sin retiro del vehículo.`);
    }
  }

  private async vehiculosDe(lista: Order[]): Promise<Map<string, Vehicle>> {
    const ids = [...new Set(lista.map((o) => o.vehicle_id))];
    if (!ids.length) return new Map();
    const vs = await this.vehicles.find({ where: { vehicle_id: In(ids) } });
    return new Map(vs.map((v) => [v.vehicle_id, v]));
  }

  /** PNR de 8 caracteres (RF + 6) sin caracteres ambiguos, unico en orders.locator. */
  private async nuevoPnr(m: EntityManager): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const bytes = randomBytes(6);
      const pnr = 'RF' + Array.from(bytes, (b) => PNR_CHARS[b % PNR_CHARS.length]).join('');
      if (!(await m.exists(Order, { where: { locator: pnr } }))) return pnr;
    }
    return `RF${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
  }
}

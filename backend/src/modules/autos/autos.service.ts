import {
  BadRequestException, ConflictException, Injectable,
  NotFoundException, Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { WebhookDispatcher, WebhookEvent } from './webhook-dispatcher.service';
import { calcularDisponibleDesde, Vehicle } from './entities/vehicle.entity';
import { aEstadoV1 } from './estado-vehiculo.mapper';
import { InventarioService } from '../integracion/inventario.service';
import { OutboxService } from '../integracion/outbox.service';
import { EVENTOS } from '../integracion/nodo';
import { Depot } from './entities/depot.entity';
import { Supplier } from './entities/supplier.entity';
import { VehicleImage } from './entities/vehicle-image.entity';
import { Hold } from './entities/hold.entity';
import { OrderPreview } from './entities/order-preview.entity';
import { Order } from './entities/order.entity';
import { WebhookSubscription } from './entities/webhook.entity';
import {
  CarDetailsRequestDto, CarSearchRequestDto, CarSearchResponseDto, DepotScoresRequestDto,
  DepotsRequestDto, SuppliersRequestDto,
} from './dto/search.dto';
import { AuthContext } from '../../common/guards/oauth2.guard';
import {
  OrderCreateRequestDto, OrderHoldRequestDto, OrderHoldResponseDto,
  OrderModifyRequestDto, OrderPreviewRequestDto, OrderPreviewResponseDto,
  WebhookSubscriptionDto,
} from './dto/orders.dto';

/**
 * Regla de disponibilidad de un vehiculo para un alquiler que empieza en `pickup`:
 * AVAILABLE siempre; WASHING solo si el alquiler empieza cuando ya termino el lavado
 * (pickup >= wash_until); RESERVED (rentado)/MAINTENANCE/INACTIVE nunca.
 * /search aplica la misma regla en SQL (ver AutosService.search).
 */
export function vehicleAvailableFor(
  v: Pick<Vehicle, 'status' | 'wash_until'>, pickup: Date,
): boolean {
  if (v.status === 'AVAILABLE') return true;
  if (v.status === 'WASHING') {
    return !!v.wash_until && pickup.getTime() >= new Date(v.wash_until).getTime();
  }
  return false;
}

/**
 * Servicio principal del dominio autos. Implementa la logica alineada con
 * el contrato autos-openapi.yaml. En Reto 1 la fuente de datos es la BD
 * PostgreSQL local; en el Reto 2 este servicio actuara como orquestador
 * hacia otros microservicios (catalog, booking, reviews).
 */
@Injectable()
export class AutosService {
  private static readonly HOLD_MINUTES = 15;
  private static readonly PREVIEW_MINUTES = 30;
  private static readonly EXTRA_PER_DAY = 5;
  private static readonly TAX_RATE = 0.15;
  private static readonly IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
  private static readonly SEARCH_TOKEN_MAX = 200;
  private static readonly MAX_DIAS = 90;
  private static readonly MS_DIA = 24 * 60 * 60 * 1000;

  /**
   * Respuestas ya emitidas para modify/cancel, por Idempotency-Key: un reintento con la misma
   * clave devuelve el mismo resultado en vez de volver a aplicar la operacion.
   * (create usa la columna orders.idempotency_key). En memoria para Reto 1.
   */
  private readonly idempotent = new Map<string, { expiresAt: number; result: any }>();

  constructor(
    private readonly dispatcher: WebhookDispatcher,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(Depot) private readonly depots: Repository<Depot>,
    @InjectRepository(Supplier) private readonly suppliers: Repository<Supplier>,
    @InjectRepository(VehicleImage) private readonly images: Repository<VehicleImage>,
    @InjectRepository(Hold) private readonly holds: Repository<Hold>,
    @InjectRepository(OrderPreview) private readonly previews: Repository<OrderPreview>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(WebhookSubscription) private readonly webhooks: Repository<WebhookSubscription>,
    // Reto 2: eventos CloudEvents y stock gRPC tambien para las operaciones de /api/v1 (opcionales
    // para que las pruebas unitarias del Reto 1 sigan construyendo el servicio a mano)
    @Optional() private readonly inventario?: InventarioService,
    @Optional() private readonly outbox?: OutboxService,
  ) {}

  // ═════════════════════════════════════════════════════════════════════════
  //  Busqueda y Catalogo
  // ═════════════════════════════════════════════════════════════════════════

  async search(req: CarSearchRequestDto): Promise<CarSearchResponseDto> {
    const pickup = new Date(req.route.pickup.datetime);
    const dropoff = new Date(req.route.dropoff.datetime);
    if (isNaN(pickup.getTime()) || isNaN(dropoff.getTime()) || dropoff <= pickup) {
      throw new BadRequestException({
        type: 'https://api.booking-hub.com/errors/invalid-route',
        title: 'Ruta inválida',
        status: 400,
        detail: 'route.dropoff.datetime debe ser posterior a route.pickup.datetime',
        code: 'VALIDATION_FAILED',
      });
    }
    const totalDays = this.daysBetween(pickup, dropoff);
    await this.releaseFinishedWashes();

    // Misma regla que vehicleAvailableFor: un vehiculo en lavado aparece solo si se recoge
    // cuando el lavado ya termino.
    const qb = this.vehicles.createQueryBuilder('v')
      .leftJoinAndSelect('v.depot', 'd')
      .leftJoinAndSelect('v.supplier', 's')
      .where("(v.status = 'AVAILABLE' OR (v.status = 'WASHING' AND v.wash_until <= :pickup))", { pickup });

    // Excluir vehículos con orden CONFIRMED (ocupados)
    const busyIds = await this.busyVehicleIds();
    if (busyIds.size > 0) qb.andWhere('v.vehicle_id NOT IN (:...busy)', { busy: [...busyIds] });

    const airport = req.route.pickup.location?.airport;
    const cityId = req.route.pickup.location?.city_id;
    if (airport) qb.andWhere('d.airport = :ap', { ap: airport });
    if (cityId) qb.andWhere('d.city_id = :cid', { cid: cityId });

    if (req.filters?.car_types?.length) {
      qb.andWhere('v.car_type IN (:...types)', { types: req.filters.car_types });
    }
    if (req.filters?.transmission?.length) {
      qb.andWhere('v.transmission IN (:...tr)', { tr: req.filters.transmission });
    }

    const limit = req.maximum_results || 100;
    const page = this.parsePage(req.page);
    qb.orderBy('v.price_per_day', 'ASC').addOrderBy('v.vehicle_id', 'ASC')
      .skip((page - 1) * limit).take(limit);
    const [vehicles, total] = await qb.getManyAndCount();

    return {
      request_id: randomUUID(),
      data: vehicles.map((v) => ({
        vehicle_id: v.vehicle_id,
        price: Number((Number(v.price_per_day) * totalDays).toFixed(2)),
        supplier_id: v.supplier_id,
      })),
      metadata: { total_results: total, next_page: page * limit < total ? String(page + 1) : null },
      search_token: this.encodeSearchToken(req),
    };
  }

  async getDetails(req: CarDetailsRequestDto): Promise<any> {
    await this.releaseFinishedWashes();
    const where: any = {};
    if (Array.isArray(req?.vehicle_ids) && req.vehicle_ids.length > 0) where.vehicle_id = In(req.vehicle_ids);
    // last_modified: solo vehículos cambiados desde esa fecha (sincronización incremental)
    if (req?.last_modified) where.updated_at = MoreThanOrEqual(new Date(req.last_modified));
    const { take, skip, page } = this.pageWindow(req);
    const [vehicles, total] = await this.vehicles.findAndCount({
      where,
      relations: ['images', 'depot', 'supplier'],
      order: { vehicle_id: 'ASC' },
      take, skip,
    });
    return {
      request_id: randomUUID(),
      metadata: this.pageMetadata(page, take, total),
      data: vehicles.map((v) => ({
        vehicle_id: v.vehicle_id,
        make: v.make,
        model: v.model,
        year: v.year,
        doors: v.doors,
        seats: v.seats,
        bag_capacity: v.bag_capacity,
        car_type: v.car_type,
        transmission: v.transmission,
        fuel_type: v.fuel_type,
        air_conditioning: v.air_conditioning,
        color: v.color,
        description: v.description,
        main_image_url: v.main_image_url,
        images: (v.images || []).sort((a, b) => a.position - b.position).map((i) => i.url),
        price_per_day: Number(v.price_per_day),
        supplier: v.supplier ? { supplier_id: v.supplier.supplier_id, name: v.supplier.name } : null,
        depot: v.depot ? {
          depot_id: v.depot.depot_id, name: v.depot.name, city: v.depot.city,
          airport: v.depot.airport,
        } : null,
      })),
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  Agencias y Proveedores
  // ═════════════════════════════════════════════════════════════════════════

  async getDepots(req: DepotsRequestDto): Promise<any> {
    const { take, skip, page } = this.pageWindow(req);
    const [depots, total] = await this.depots.findAndCount({
      where: { active: true }, order: { city: 'ASC', name: 'ASC' }, take, skip,
    });
    return {
      request_id: randomUUID(),
      data: depots.map((d) => ({
        depot_id: d.depot_id,
        name: d.name,
        city: d.city,
        address: d.address,
        location: {
          airport: d.airport || undefined,
          city_id: d.city_id || undefined,
          coordinates: (d.latitude && d.longitude)
            ? { latitude: Number(d.latitude), longitude: Number(d.longitude) }
            : undefined,
        },
      })),
      metadata: this.pageMetadata(page, take, total),
    };
  }

  async getDepotScores(req: DepotScoresRequestDto): Promise<any> {
    const { take, skip, page } = this.pageWindow(req);
    const [depots, total] = await this.depots.findAndCount({
      where: { active: true }, order: { depot_id: 'ASC' }, take, skip,
    });
    return {
      request_id: randomUUID(),
      data: depots.map((d) => ({
        depot_id: d.depot_id,
        score: Number(d.score),
      })),
      metadata: this.pageMetadata(page, take, total),
    };
  }

  async getSuppliers(req: SuppliersRequestDto): Promise<any> {
    const { take, skip, page } = this.pageWindow(req);
    // suppliers vacío o ausente => todos (según SuppliersRequest.suppliers)
    const [suppliers, total] = await this.suppliers.findAndCount({
      where: Array.isArray(req?.suppliers) && req.suppliers.length > 0 ? { supplier_id: In(req.suppliers) } : {},
      order: { name: 'ASC' }, take, skip,
    });
    return {
      request_id: randomUUID(),
      metadata: this.pageMetadata(page, take, total),
      data: suppliers.map((s) => ({
        supplier_id: s.supplier_id,
        name: s.name,
        brand: s.brand,
      })),
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  Constantes
  // ═════════════════════════════════════════════════════════════════════════

  async getConstants(req: any): Promise<any> {
    const catalog: Record<string, any> = {
      depot_services: [
        { code: 'AIRPORT', label: 'En aeropuerto' },
        { code: 'DOWNTOWN', label: 'En el centro' },
        { code: 'HOTEL', label: 'En hotel' },
      ],
      fuel_policies: [
        { code: 'FULL_TO_FULL', label: 'Lleno a lleno' },
        { code: 'FULL_TO_EMPTY', label: 'Lleno a vacío' },
      ],
      fuel_types: [
        { code: 'gasolina', label: 'Gasolina' },
        { code: 'diesel', label: 'Diésel' },
        { code: 'hibrido', label: 'Híbrido' },
        { code: 'electrico', label: 'Eléctrico' },
      ],
      transmission: [
        { code: 'manual', label: 'Manual' },
        { code: 'automatica', label: 'Automática' },
      ],
      payment_timings: [
        { code: 'AT_BOOKING', label: 'Al reservar' },
        { code: 'AT_PICKUP', label: 'Al recoger el vehículo' },
      ],
      general: {
        min_driver_age: 18,
        max_driver_age: 99,
        currency_default: 'USD',
      },
    };
    const keys = Array.isArray(req?.constants) && req.constants.length > 0
      ? req.constants : Object.keys(catalog);
    const data: Record<string, any> = {};
    for (const k of keys) if (catalog[k]) data[k] = catalog[k];
    return { request_id: randomUUID(), data };
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  Ordenes: hold / preview / create / get / modify / cancel
  // ═════════════════════════════════════════════════════════════════════════

  async holdOrder(req: OrderHoldRequestDto): Promise<OrderHoldResponseDto> {
    const vehicle = await this.vehicles.findOne({ where: { vehicle_id: req.vehicle_id } });
    if (!vehicle || !['AVAILABLE', 'WASHING'].includes(vehicle.status)) {
      throw this.conflict('CAR_NO_LONGER_AVAILABLE', 'El vehículo ya no está disponible');
    }
    const { route } = this.decodeSearchToken(req.search_token);
    if (!vehicleAvailableFor(vehicle, new Date(route.pickup.datetime))) {
      throw this.conflict('CAR_NO_LONGER_AVAILABLE', 'El vehículo está en lavado en la fecha de recogida');
    }

    const hold_id = `HLD-${randomUUID().slice(0, 8)}`;
    const expires_at = new Date(Date.now() + AutosService.HOLD_MINUTES * 60 * 1000);

    await this.holds.save(this.holds.create({
      hold_id,
      vehicle_id: req.vehicle_id,
      search_token: req.search_token,
      status: 'HELD',
      driver_age: req.driver?.age,
      expires_at,
    }));

    return { hold_id, expires_at: expires_at.toISOString(), status: 'HELD' };
  }

  async previewOrder(req: OrderPreviewRequestDto): Promise<OrderPreviewResponseDto> {
    const vehicle = await this.vehicles.findOne({ where: { vehicle_id: req.vehicle_id } });
    if (!vehicle) throw new NotFoundException(this.problem('CAR_NO_LONGER_AVAILABLE', 'Vehículo no encontrado', 404));

    // La ruta (y por tanto los dias) viaja dentro del search_token emitido por /search
    const search = this.decodeSearchToken(req.search_token);
    const route = search.route;
    this.assertRangoFechas(route.pickup.datetime, route.dropoff.datetime);
    const days = this.daysBetween(new Date(route.pickup.datetime), new Date(route.dropoff.datetime));

    if (req.hold_id) {
      const hold = await this.holds.findOne({ where: { hold_id: req.hold_id } });
      if (!hold) throw new NotFoundException(this.problem('BOOKING_NOT_CONFIRMED', 'Hold no encontrado', 404));
      if (hold.vehicle_id !== req.vehicle_id) {
        throw new BadRequestException(this.problem('VALIDATION_FAILED', 'El hold pertenece a otro vehículo', 400));
      }
      if (hold.expires_at.getTime() < Date.now()) {
        throw this.conflict('CAR_NO_LONGER_AVAILABLE', 'El bloqueo expiró, vuelva a buscar');
      }
    }

    const extras = req.extras || [];
    const breakdown = this.priceBreakdown(Number(vehicle.price_per_day), days, extras.length);
    const currency = search.currency || 'USD';

    const order_preview_id = `PRV-${randomUUID().slice(0, 8)}`;
    const expires_at = new Date(Date.now() + AutosService.PREVIEW_MINUTES * 60 * 1000);

    await this.previews.save(this.previews.create({
      order_preview_id,
      vehicle_id: req.vehicle_id,
      search_token: req.search_token,
      hold_id: req.hold_id,
      route,
      extras,
      total_price: breakdown.total,
      currency,
      total_days: days,
      breakdown: breakdown.detail,
      expires_at,
    }));

    return {
      request_id: randomUUID(),
      data: { order_preview_id, total_price: breakdown.total, currency, breakdown: breakdown.detail },
    };
  }

  async createOrder(req: OrderCreateRequestDto, ownerSub: string, idempotencyKey: string): Promise<any> {
    // Idempotencia: si ya existe una orden con esa key, la devolvemos tal cual (sin duplicar)
    const existing = await this.orders.findOne({ where: { idempotency_key: idempotencyKey } });
    if (existing) return this.toOrderDetail(existing);

    const preview = await this.previews.findOne({ where: { order_preview_id: req.order_preview_id } });
    if (!preview) {
      throw new BadRequestException(this.problem('VALIDATION_FAILED', 'order_preview_id no encontrado', 400));
    }
    if (preview.route?.pickup?.datetime) {
      // Revalida: una preview creada hace tiempo podría tener ya la fecha de inicio en el pasado
      this.assertRangoFechas(preview.route.pickup.datetime, preview.route.dropoff.datetime);
    }
    if (preview.expires_at.getTime() < Date.now()) {
      throw this.conflict('PRICE_CHANGED', 'La previsualizacion expiró, vuelva a solicitar preview');
    }

    const vehicle = await this.vehicles.findOne({ where: { vehicle_id: preview.vehicle_id } });
    const pickup = new Date(preview.route?.pickup?.datetime ?? Date.now());
    if (!vehicle || !vehicleAvailableFor(vehicle, pickup)) {
      throw this.conflict('CAR_NO_LONGER_AVAILABLE', 'El vehículo ya no está disponible');
    }
    if (!req.payment_reference || req.payment_reference.length < 4) {
      throw new BadRequestException(this.problem('PAYMENT_REFERENCE_INVALID', 'payment_reference inválida', 400));
    }

    const order = this.orders.create({
      locator: this.generateLocator(),
      status: 'CONFIRMED',
      vehicle_id: vehicle.vehicle_id,
      owner_sub: ownerSub,
      hold_id: preview.hold_id,
      order_preview_id: preview.order_preview_id,
      payment_reference: req.payment_reference,
      vehicle_details: {
        vehicle_id: vehicle.vehicle_id,
        make: vehicle.make, model: vehicle.model, year: vehicle.year,
        supplier_id: vehicle.supplier_id, depot_id: vehicle.depot_id,
        main_image_url: vehicle.main_image_url,
      },
      route_details: preview.route || {},
      driver_details: req.driver_details,
      extras: preview.extras,
      total_price: preview.total_price,
      currency: preview.currency,
      idempotency_key: idempotencyKey,
    });
    const saved = await this.orders.save(order);
    // Marcamos el vehículo como RESERVADO (si estaba en lavado, la reserva empieza después)
    vehicle.status = 'RESERVED';
    vehicle.wash_until = null;
    await this.vehicles.save(vehicle);

    const detail = this.toOrderDetail(saved);
    this.fireWebhook('CAR_ORDER_CONFIRMED', saved.order_id, detail);
    await this.outbox?.registrar(null, EVENTOS.ORDEN_CONFIRMADA, {
      order_id: saved.order_id, pnr: saved.locator, auto_id: vehicle.vehicle_id,
      total_price: Number(saved.total_price), nuevo_estado_auto: 'RESERVADO', canal: 'api/v1',
    }, { subject: saved.order_id });
    await this.inventario?.registrarCambio(null, vehicle, 'order.confirmed');
    this.inventario?.notificarStock(vehicle);
    return detail;
  }

  /** Órdenes del usuario autenticado (owner_sub = sub del JWT), más recientes primero. */
  async listMyOrders(auth: AuthContext): Promise<any[]> {
    const mine = await this.orders.find({ where: { owner_sub: auth.sub }, order: { creation_date: 'DESC' } });
    return mine.map((o) => this.toOrderDetail(o));
  }

  async getOrder(orderId: string, auth: AuthContext): Promise<any> {
    return this.toOrderDetail(await this.findOwnedOrder(orderId, auth));
  }

  async modifyOrder(orderId: string, req: OrderModifyRequestDto, auth: AuthContext, idempotencyKey: string): Promise<any> {
    return this.once(`modify:${orderId}:${idempotencyKey}`, async () => {
      const order = await this.findOwnedOrder(orderId, auth);
      if (order.status !== 'CONFIRMED') {
        throw this.conflict('BOOKING_NOT_CONFIRMED', `Orden en estado ${order.status}, no se puede modificar`);
      }
      const set = new Set<string>(order.extras || []);
      (req.extras_to_remove || []).forEach((e) => set.delete(e));
      (req.extras_to_add || []).forEach((e) => set.add(e));
      order.extras = Array.from(set);
      if (req.route) {
        this.assertRangoFechas(req.route.pickup.datetime, req.route.dropoff.datetime);
        order.route_details = req.route as any;
      }

      // Recalcular el precio con los extras y la ruta vigentes (misma tarifa que /orders/preview)
      const route = order.route_details;
      if (route?.pickup?.datetime && route?.dropoff?.datetime) {
        const vehicle = await this.vehicles.findOne({ where: { vehicle_id: order.vehicle_id } });
        if (vehicle) {
          const days = this.daysBetween(new Date(route.pickup.datetime), new Date(route.dropoff.datetime));
          order.total_price = this.priceBreakdown(Number(vehicle.price_per_day), days, order.extras.length).total;
        }
      }
      return this.toOrderDetail(await this.orders.save(order));
    });
  }

  async cancelOrder(orderId: string, auth: AuthContext, idempotencyKey: string): Promise<any> {
    return this.once(`cancel:${orderId}:${idempotencyKey}`, async () => {
      const order = await this.findOwnedOrder(orderId, auth);
      if (order.status === 'CANCELLED') {
        throw this.conflict('CANCELLATION_NOT_ALLOWED', 'La orden ya estaba cancelada');
      }
      if (order.checkin_entrega_at && !order.returned_at) {
        // Reto 2: con las llaves entregadas el auto esta en uso; se cierra con el check-in de devolucion
        throw this.conflict('CANCELLATION_NOT_ALLOWED', 'El vehículo ya fue entregado al cliente; registre su devolución');
      }
      order.status = 'CANCELLED';
      await this.orders.save(order);

      // Si ya se devolvio, el vehiculo sigue su propio ciclo (lavado / otra reserva): no se toca.
      const vehicle = order.returned_at
        ? null : await this.vehicles.findOne({ where: { vehicle_id: order.vehicle_id } });
      if (vehicle) {
        vehicle.status = 'AVAILABLE';
        await this.vehicles.save(vehicle);
        await this.inventario?.registrarCambio(null, vehicle, 'order.cancelled');
        this.inventario?.notificarStock(vehicle);
      }
      this.fireWebhook('CAR_ORDER_CANCELLED', order.order_id, { locator: order.locator, status: order.status });
      await this.outbox?.registrar(null, EVENTOS.ORDEN_CANCELADA, {
        order_id: order.order_id, pnr: order.locator, auto_id: order.vehicle_id,
        refund_amount: Number(order.total_price), estado_restituido: vehicle ? 'DISPONIBLE' : null, canal: 'api/v1',
      }, { subject: order.order_id });
      return { status: 'CANCELLED', order_id: order.order_id };
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  Devolucion (BFF admin, fuera del contrato): POST /admin/orders/{id}/return
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Registra la devolucion del vehiculo sin cancelar la orden (sigue CONFIRMED) y deja el
   * vehiculo en WASHING durante el cooldown de 2 h (COOLDOWN_MINUTES). Idempotente: si la orden ya
   * tiene returned_at responde el estado actual sin modificar nada.
   */
  async returnOrder(orderId: string, auth: AuthContext): Promise<any> {
    const order = await this.orders.findOne({ where: { order_id: orderId } });
    if (!order) throw new NotFoundException(this.problem('BOOKING_NOT_CONFIRMED', `No existe la orden ${orderId}`, 404));
    if (order.returned_at) return this.returnResponse(order);
    if (order.status !== 'CONFIRMED') {
      throw this.conflict('BOOKING_NOT_CONFIRMED',
        `Orden en estado ${order.status}: solo se registra la devolución de órdenes CONFIRMED`);
    }
    const vehicle = await this.vehicles.findOne({ where: { vehicle_id: order.vehicle_id } });
    if (!vehicle) {
      throw new NotFoundException(this.problem('CAR_NO_LONGER_AVAILABLE', `No existe el vehículo ${order.vehicle_id}`, 404));
    }

    // Si se devuelve una orden antigua mientras el vehiculo ya esta reservado por otra orden activa,
    // solo se registra la devolucion: pasarlo a WASHING liberaria esa otra reserva (doble reserva).
    const otraReserva = (await this.busyVehicleIds(order.order_id)).has(vehicle.vehicle_id);

    const now = new Date();
    const washUntil = calcularDisponibleDesde(now);
    const enLavado = await this.orders.manager.transaction(async (m) => {
      // UPDATE condicionado a returned_at IS NULL: dos peticiones simultaneas no registran dos devoluciones
      const r = await m.update(Order, { order_id: order.order_id, returned_at: IsNull() },
        { returned_at: now, returned_by_sub: auth.sub });
      if (!r.affected || otraReserva) return false;
      await m.update(Vehicle, { vehicle_id: vehicle.vehicle_id }, { status: 'WASHING', wash_until: washUntil });
      await this.outbox?.registrar(m, EVENTOS.COOLDOWN_INICIADO, {
        auto_id: vehicle.vehicle_id, estado: 'EN_LIMPIEZA', cooldown_minutos: 120,
        disponible_desde: washUntil.toISOString(), order_id: order.order_id, canal: 'api/v1',
      }, { subject: vehicle.vehicle_id });
      await this.inventario?.registrarCambio(m, { vehicle_id: vehicle.vehicle_id, status: 'WASHING' }, 'cooldown.started');
      return true;
    });
    if (enLavado) this.inventario?.notificarStock({ vehicle_id: vehicle.vehicle_id, status: 'WASHING' });
    return this.returnResponse(await this.orders.findOne({ where: { order_id: orderId } }));
  }

  private async returnResponse(order: Order): Promise<any> {
    const v = await this.vehicles.findOne({ where: { vehicle_id: order.vehicle_id } });
    return {
      order: {
        ...this.toOrderDetail(order),
        owner_sub: order.owner_sub,
        returned_at: this.iso(order.returned_at),
        returned_by_sub: order.returned_by_sub,
      },
      // /api/v1 sigue viendo los estados del Reto 1 (las fases nuevas del v2 cuentan como RESERVED)
      vehicle: v ? { vehicle_id: v.vehicle_id, status: aEstadoV1(v.status), wash_until: this.iso(v.wash_until) } : null,
    };
  }

  /**
   * Auto-sanado ademas del worker del outbox (cada 5 s): cada /search y /details devuelve a
   * AVAILABLE los vehiculos cuyo lavado ya termino.
   */
  async releaseFinishedWashes(): Promise<number> {
    // Con la infraestructura del Reto 2 se emiten auto.cooldown.ended y stock.actualizado
    if (this.inventario) return this.inventario.liberarCooldownsVencidos();
    const r = await this.vehicles.createQueryBuilder()
      .update(Vehicle)
      .set({ status: 'AVAILABLE', wash_until: null })
      .where("status = 'WASHING' AND wash_until <= NOW()")
      .execute();
    return r.affected ?? 0;
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  Webhooks
  // ═════════════════════════════════════════════════════════════════════════

  listWebhooks(): Promise<WebhookSubscription[]> {
    return this.webhooks.find();
  }

  async createWebhook(sub: WebhookSubscriptionDto): Promise<WebhookSubscription> {
    return this.webhooks.save(this.webhooks.create({
      url: sub.url, events: sub.events, secret: sub.secret,
    }));
  }

  async deleteWebhook(id: string): Promise<void> {
    const r = await this.webhooks.delete(id);
    if (r.affected === 0) throw new NotFoundException(this.problem('VALIDATION_FAILED', 'Webhook no encontrado', 404));
  }

  private fireWebhook(eventType: WebhookEvent, resourceId: string, data?: Record<string, any>): void {
    this.dispatcher.dispatch(eventType, resourceId, data);
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  Utilidades internas
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * El dueno de la orden se infiere del `sub` del JWT (info.description del contrato).
   * Solo el dueno o un administrador (scope autos:webhooks) pueden verla o alterarla;
   * a cualquier otro se le responde 404 para no revelar que la orden existe.
   */
  private async findOwnedOrder(orderId: string, auth: AuthContext): Promise<Order> {
    const order = await this.orders.findOne({ where: { order_id: orderId } });
    const isAdmin = auth?.scopes?.includes('autos:webhooks');
    if (!order || (!isAdmin && order.owner_sub !== auth?.sub)) {
      throw new NotFoundException(this.problem('BOOKING_NOT_CONFIRMED', 'Orden no encontrada', 404));
    }
    return order;
  }

  /** Ejecuta `fn` una sola vez por clave de idempotencia y reutiliza su resultado en reintentos. */
  private async once<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.idempotent.get(key);
    if (hit && hit.expiresAt > now) return hit.result;
    const result = await fn();
    this.idempotent.set(key, { expiresAt: now + AutosService.IDEMPOTENCY_TTL_MS, result });
    if (this.idempotent.size > 5000) {
      for (const [k, v] of this.idempotent) if (v.expiresAt <= now) this.idempotent.delete(k);
    }
    return result;
  }

  private priceBreakdown(pricePerDay: number, days: number, extrasCount: number) {
    const base = Number((pricePerDay * days).toFixed(2));
    const extras = extrasCount * AutosService.EXTRA_PER_DAY * days;
    const taxes = Number((base * AutosService.TAX_RATE).toFixed(2));
    const total = Number((base + extras + taxes).toFixed(2));
    return { total, detail: { base, extras, taxes, days } };
  }

  private daysBetween(pickup: Date, dropoff: Date): number {
    return Math.max(1, Math.ceil((dropoff.getTime() - pickup.getTime()) / (1000 * 60 * 60 * 24)));
  }

  /**
   * El search_token es opaco para el cliente pero transporta el contexto de la búsqueda
   * (ruta, moneda, edad del conductor) para que /orders/hold y /orders/preview no tengan
   * que pedirlo de nuevo: base64url de un JSON compacto con prefijo "tok-".
   * Debe caber en holds/order_previews.search_token (varchar 200); si las ubicaciones lo
   * exceden se omiten (las fechas, que definen el precio, siempre viajan).
   */
  private encodeSearchToken(req: CarSearchRequestDto): string {
    const enc = (o: object) => `tok-${Buffer.from(JSON.stringify(o)).toString('base64url')}`;
    const ctx: Record<string, any> = {
      n: randomUUID().slice(0, 8),
      p: req.route.pickup.datetime, d: req.route.dropoff.datetime,
      c: req.currency, a: req.driver?.age,
      pl: req.route.pickup.location, dl: req.route.dropoff.location,
    };
    const full = enc(ctx);
    if (full.length <= AutosService.SEARCH_TOKEN_MAX) return full;
    delete ctx.pl; delete ctx.dl;
    return enc(ctx);
  }

  private decodeSearchToken(token: string): { route: any; currency?: string; driver_age?: number } {
    try {
      const t = JSON.parse(Buffer.from(token.replace(/^tok-/, ''), 'base64url').toString('utf8'));
      if (t?.p && t?.d && !isNaN(Date.parse(t.p)) && !isNaN(Date.parse(t.d))) {
        return {
          route: { pickup: { datetime: t.p, location: t.pl ?? {} }, dropoff: { datetime: t.d, location: t.dl ?? {} } },
          currency: t.c, driver_age: t.a,
        };
      }
    } catch { /* cae al error de abajo */ }
    throw new BadRequestException({
      ...this.problem('VALIDATION_FAILED', 'search_token inválido; realice una nueva búsqueda con POST /search', 400),
      invalidParams: [{ name: 'search_token', reason: 'No corresponde a una búsqueda emitida por /search' }],
    });
  }

  private parsePage(page?: string): number {
    const n = Number.parseInt(page ?? '1', 10);
    return Number.isFinite(n) && n >= 1 ? n : 1;
  }

  private pageWindow(req?: { maximum_results?: number; page?: string }) {
    const take = Math.min(Math.max(req?.maximum_results || 100, 1), 500);
    const page = this.parsePage(req?.page);
    return { take, skip: (page - 1) * take, page };
  }

  private pageMetadata(page: number, take: number, total: number) {
    return { total_results: total, next_page: page * take < total ? String(page + 1) : null };
  }

  private async busyVehicleIds(exceptOrderId?: string): Promise<Set<string>> {
    // Un vehículo está ocupado mientras tenga una orden CONFIRMED que aún no termina.
    // Las órdenes ya finalizadas (devolución en el pasado, p. ej. el historial del seed) no lo bloquean.
    // Una orden ya devuelta (returned_at) tampoco lo bloquea: desde ahi manda el lavado.
    const confirmed = await this.orders.find({
      where: { status: 'CONFIRMED', returned_at: IsNull() },
      select: { order_id: true, vehicle_id: true, route_details: true },
    });
    const now = Date.now();
    return new Set(confirmed
      .filter((o) => o.order_id !== exceptOrderId)
      .filter((o) => { const fin = Date.parse(o.route_details?.dropoff?.datetime); return isNaN(fin) || fin >= now; })
      .map((o) => o.vehicle_id));
  }

  /**
   * Reglas de fechas de una reserva (/orders/preview, /orders/create y modify):
   * inicio no anterior a hoy en UTC (con 1 día de tolerancia por zonas horarias),
   * fin posterior al inicio y duración máxima de MAX_DIAS días.
   */
  private assertRangoFechas(pickupIso: string, dropoffIso: string): void {
    const pickup = Date.parse(pickupIso), dropoff = Date.parse(dropoffIso);
    const fallo = (name: string, reason: string) => new BadRequestException({
      ...this.problem('VALIDATION_FAILED', reason, 400),
      title: 'Fechas de alquiler inválidas',
      invalidParams: [{ name, reason }],
    });
    if (isNaN(pickup) || isNaN(dropoff)) throw fallo('route', 'Las fechas de la ruta no son válidas');
    const hoyUtc = new Date(); hoyUtc.setUTCHours(0, 0, 0, 0);
    if (pickup < hoyUtc.getTime() - AutosService.MS_DIA) {
      throw fallo('route.pickup.datetime', 'La fecha de inicio no puede ser en el pasado');
    }
    if (dropoff <= pickup) {
      throw fallo('route.dropoff.datetime', 'La fecha de fin debe ser posterior a la de inicio');
    }
    if (this.daysBetween(new Date(pickup), new Date(dropoff)) > AutosService.MAX_DIAS) {
      throw fallo('route.dropoff.datetime', `El alquiler no puede superar los ${AutosService.MAX_DIAS} días`);
    }
  }

  private generateLocator(): string {
    const base = 'RENTAFACIL-';
    return base + randomUUID().slice(0, 6).toUpperCase();
  }

  private toOrderDetail(o: Order): any {
    const links: Record<string, string> = { self: `/api/v1/orders/${o.order_id}` };
    if (o.status === 'CONFIRMED') {
      links.modify = `/api/v1/orders/${o.order_id}/modify`;
      links.cancel = `/api/v1/orders/${o.order_id}/cancel`;
    }
    return {
      order_id: o.order_id,
      locator: o.locator,
      status: o.status,
      vehicle_details: o.vehicle_details,
      route_details: o.route_details,
      total_price: Number(o.total_price),
      currency: o.currency,
      creation_date: o.creation_date instanceof Date ? o.creation_date.toISOString() : o.creation_date,
      _links: links,
    };
  }

  private iso(d: Date | string | null | undefined): string | null {
    if (!d) return null;
    return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
  }

  private conflict(code: string, detail: string): ConflictException {
    return new ConflictException(this.problem(code, detail, 409));
  }

  private problem(code: string, detail: string, status: number): any {
    return {
      type: `https://api.booking-hub.com/errors/${code.toLowerCase().replace(/_/g, '-')}`,
      title: detail,
      status,
      detail,
      code,
    };
  }
}

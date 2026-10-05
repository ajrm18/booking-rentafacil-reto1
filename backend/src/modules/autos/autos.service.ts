import {
  BadRequestException, ConflictException, Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Vehicle } from './entities/vehicle.entity';
import { Depot } from './entities/depot.entity';
import { Supplier } from './entities/supplier.entity';
import { VehicleImage } from './entities/vehicle-image.entity';
import { Hold } from './entities/hold.entity';
import { OrderPreview } from './entities/order-preview.entity';
import { Order } from './entities/order.entity';
import { WebhookSubscription } from './entities/webhook.entity';
import { CarSearchRequestDto, CarSearchResponseDto } from './dto/search.dto';
import {
  OrderCreateRequestDto, OrderHoldRequestDto, OrderHoldResponseDto,
  OrderModifyRequestDto, OrderPreviewRequestDto, OrderPreviewResponseDto,
  WebhookSubscriptionDto,
} from './dto/orders.dto';

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

  constructor(
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(Depot) private readonly depots: Repository<Depot>,
    @InjectRepository(Supplier) private readonly suppliers: Repository<Supplier>,
    @InjectRepository(VehicleImage) private readonly images: Repository<VehicleImage>,
    @InjectRepository(Hold) private readonly holds: Repository<Hold>,
    @InjectRepository(OrderPreview) private readonly previews: Repository<OrderPreview>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(WebhookSubscription) private readonly webhooks: Repository<WebhookSubscription>,
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
        title: 'Ruta invalida',
        status: 400,
        detail: 'route.dropoff.datetime debe ser posterior a route.pickup.datetime',
        code: 'VALIDATION_FAILED',
      });
    }
    if (req.driver.age < 21) {
      // no error, pero es una restriccion, se refleja en la busqueda vacia posible
    }

    const totalDays = Math.max(1, Math.ceil((dropoff.getTime() - pickup.getTime()) / (1000 * 60 * 60 * 24)));

    const qb = this.vehicles.createQueryBuilder('v')
      .leftJoinAndSelect('v.depot', 'd')
      .leftJoinAndSelect('v.supplier', 's')
      .leftJoinAndSelect('v.images', 'i')
      .where('v.status = :st', { st: 'AVAILABLE' });

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
    qb.take(limit);
    const vehicles = await qb.getMany();

    // Excluir vehiculos con orden CONFIRMED o hold vigente que se solapa
    const busyIds = await this.busyVehicleIds(req.route.pickup.datetime, req.route.dropoff.datetime);
    const available = vehicles.filter((v) => !busyIds.has(v.vehicle_id));

    const search_token = `tok-${randomUUID()}`;

    return {
      request_id: randomUUID(),
      data: available.map((v) => ({
        vehicle_id: v.vehicle_id,
        price: Number((Number(v.price_per_day) * totalDays).toFixed(2)),
        supplier_id: v.supplier_id,
      })),
      metadata: { total_results: available.length, next_page: null },
      search_token,
    };
  }

  async getDetails(req: any): Promise<any> {
    const where: any = {};
    let vehicles: Vehicle[];
    if (Array.isArray(req?.vehicle_ids) && req.vehicle_ids.length > 0) {
      vehicles = await this.vehicles.find({
        where: { vehicle_id: In(req.vehicle_ids) },
        relations: ['images', 'depot', 'supplier'],
      });
    } else {
      vehicles = await this.vehicles.find({
        relations: ['images', 'depot', 'supplier'],
        take: req?.maximum_results || 100,
      });
    }
    return {
      request_id: randomUUID(),
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

  async getDepots(_req: any): Promise<any> {
    const depots = await this.depots.find({ where: { active: true }, order: { city: 'ASC', name: 'ASC' } });
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
      metadata: { total_results: depots.length },
    };
  }

  async getDepotScores(_req: any): Promise<any> {
    const depots = await this.depots.find({ where: { active: true } });
    return {
      request_id: randomUUID(),
      data: depots.map((d) => ({
        depot_id: d.depot_id,
        score: Number(d.score),
      })),
      metadata: { total_results: depots.length },
    };
  }

  async getSuppliers(req: any): Promise<any> {
    let suppliers: Supplier[];
    if (Array.isArray(req?.suppliers) && req.suppliers.length > 0) {
      suppliers = await this.suppliers.find({ where: { supplier_id: In(req.suppliers) } });
    } else {
      suppliers = await this.suppliers.find({ order: { name: 'ASC' } });
    }
    return {
      request_id: randomUUID(),
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
        { code: 'FULL_TO_EMPTY', label: 'Lleno a vacio' },
      ],
      fuel_types: [
        { code: 'gasolina', label: 'Gasolina' },
        { code: 'diesel', label: 'Diesel' },
        { code: 'hibrido', label: 'Hibrido' },
        { code: 'electrico', label: 'Electrico' },
      ],
      transmission: [
        { code: 'manual', label: 'Manual' },
        { code: 'automatica', label: 'Automatica' },
      ],
      payment_timings: [
        { code: 'AT_BOOKING', label: 'Al reservar' },
        { code: 'AT_PICKUP', label: 'Al recoger el vehiculo' },
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
    if (!vehicle || vehicle.status !== 'AVAILABLE') {
      throw this.conflict('CAR_NO_LONGER_AVAILABLE', 'El vehiculo ya no esta disponible');
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
    if (!vehicle) throw new NotFoundException(this.problem('CAR_NO_LONGER_AVAILABLE', 'Vehiculo no encontrado', 404));

    // Recuperamos ruta del hold si se envio, si no asumimos 3 dias por defecto (para demo)
    let route: any = null;
    let days = 3;
    if (req.hold_id) {
      const hold = await this.holds.findOne({ where: { hold_id: req.hold_id } });
      if (!hold) throw new NotFoundException(this.problem('BOOKING_NOT_CONFIRMED', 'Hold no encontrado', 404));
      if (hold.expires_at.getTime() < Date.now()) {
        throw this.conflict('CAR_NO_LONGER_AVAILABLE', 'El bloqueo expiro, vuelva a buscar');
      }
    }

    const extras = req.extras || [];
    const extrasPrice = extras.length * 5; // USD 5 por extra por dia
    const base = Number(vehicle.price_per_day) * days;
    const taxes = Number((base * 0.15).toFixed(2));
    const total = Number((base + extrasPrice * days + taxes).toFixed(2));

    const order_preview_id = `PRV-${randomUUID().slice(0, 8)}`;
    const expires_at = new Date(Date.now() + AutosService.PREVIEW_MINUTES * 60 * 1000);

    await this.previews.save(this.previews.create({
      order_preview_id,
      vehicle_id: req.vehicle_id,
      search_token: req.search_token,
      hold_id: req.hold_id,
      route,
      extras,
      total_price: total,
      currency: 'USD',
      total_days: days,
      breakdown: { base, extras: extrasPrice * days, taxes, days },
      expires_at,
    }));

    return {
      request_id: randomUUID(),
      data: { order_preview_id, total_price: total, currency: 'USD', breakdown: { base, extras: extrasPrice * days, taxes, days } },
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
    if (preview.expires_at.getTime() < Date.now()) {
      throw this.conflict('PRICE_CHANGED', 'La previsualizacion expiro, vuelva a solicitar preview');
    }

    const vehicle = await this.vehicles.findOne({ where: { vehicle_id: preview.vehicle_id } });
    if (!vehicle || vehicle.status !== 'AVAILABLE') {
      throw this.conflict('CAR_NO_LONGER_AVAILABLE', 'El vehiculo ya no esta disponible');
    }
    if (!req.payment_reference || req.payment_reference.length < 4) {
      throw new BadRequestException(this.problem('PAYMENT_REFERENCE_INVALID', 'payment_reference invalida', 400));
    }

    const locator = this.generateLocator();
    const order = this.orders.create({
      locator,
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
    // Marcamos el vehiculo como RESERVADO
    vehicle.status = 'RESERVED';
    await this.vehicles.save(vehicle);

    await this.fireWebhook('CAR_ORDER_CONFIRMED', saved.order_id);

    return this.toOrderDetail(saved);
  }

  async getOrder(orderId: string): Promise<any> {
    const order = await this.orders.findOne({ where: { order_id: orderId } });
    if (!order) throw new NotFoundException(this.problem('BOOKING_NOT_CONFIRMED', 'Orden no encontrada', 404));
    return this.toOrderDetail(order);
  }

  async modifyOrder(orderId: string, req: OrderModifyRequestDto): Promise<any> {
    const order = await this.orders.findOne({ where: { order_id: orderId } });
    if (!order) throw new NotFoundException(this.problem('BOOKING_NOT_CONFIRMED', 'Orden no encontrada', 404));
    if (order.status !== 'CONFIRMED') {
      throw this.conflict('CANCELLATION_NOT_ALLOWED', `Orden en estado ${order.status}, no se puede modificar`);
    }
    const set = new Set<string>(order.extras || []);
    (req.extras_to_remove || []).forEach((e) => set.delete(e));
    (req.extras_to_add || []).forEach((e) => set.add(e));
    order.extras = Array.from(set);
    if (req.route) order.route_details = req.route as any;
    const saved = await this.orders.save(order);
    return this.toOrderDetail(saved);
  }

  async cancelOrder(orderId: string): Promise<void> {
    const order = await this.orders.findOne({ where: { order_id: orderId } });
    if (!order) throw new NotFoundException(this.problem('BOOKING_NOT_CONFIRMED', 'Orden no encontrada', 404));
    if (order.status === 'CANCELLED') {
      throw this.conflict('CANCELLATION_NOT_ALLOWED', 'La orden ya estaba cancelada');
    }
    order.status = 'CANCELLED';
    await this.orders.save(order);

    const vehicle = await this.vehicles.findOne({ where: { vehicle_id: order.vehicle_id } });
    if (vehicle) {
      vehicle.status = 'AVAILABLE';
      await this.vehicles.save(vehicle);
    }
    await this.fireWebhook('CAR_ORDER_CANCELLED', order.order_id);
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

  private async fireWebhook(eventType: string, resourceId: string): Promise<void> {
    // En Reto 1 solo persistimos la intencion; el disparo real llega en Reto 2 (EDA).
    // Aqui simplemente escribimos a consola para dejar constancia del evento.
    console.log(`[webhook] ${eventType} -> ${resourceId}`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  Utilidades internas
  // ═════════════════════════════════════════════════════════════════════════

  private async busyVehicleIds(fechaInicio: string, fechaFin: string): Promise<Set<string>> {
    // Ordenes activas se marcan por status CONFIRMED. Como Reto 1 usa RESERVED en el vehiculo,
    // usamos ese estado como filtro final; ademas podriamos cruzar con order.route_details.
    const active = await this.orders.find({ where: { status: 'CONFIRMED' } });
    return new Set(active.map((o) => o.vehicle_id));
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

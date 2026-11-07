import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { randomUUID } from 'crypto';
import { Vehicle } from '../autos/entities/vehicle.entity';
import { Depot } from '../autos/entities/depot.entity';
import { Order } from '../autos/entities/order.entity';
import { InventarioService } from '../integracion/inventario.service';
import { invalido, problema } from './problema';
import {
  calcularPrecio, categoriasInternas, COBERTURAS, enCooldown, evaluarEdad, parsearPeriodo,
  resolverCiudad, transmisionInterna,
} from './reglas';
import { aVehiculoCard } from './v2.mapper';
import { bloqueaRango, ordenCruzaRango, rangoDeOrden } from '../autos-v3/v3';

/**
 * porRango (solo /api/v3, Ajuste 2): el vehiculo se bloquea por rango de fechas que se cruzan con
 * una orden CONFIRMED/ENTREGADO, no por su estado global. /api/v1 y /api/v2 no lo usan.
 */
export interface OpcionesCatalogo { porRango?: boolean }

/** Estados en los que el vehiculo existe en el catalogo v3 (RESERVADO es por rango, no global). */
const PUBLICABLES = ['AVAILABLE', 'RESERVED', 'READY_FOR_PICKUP', 'DELIVERED'];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const CATEGORIAS = ['ALL', 'ECONOMICO', 'COMPACTO', 'SUV', 'PREMIUM', 'VAN'];
const TRANSMISIONES = ['ALL', 'MANUAL', 'AUTOMATICO'];

/** Catalogo y busqueda de /api/v2 (HU-AUT-01 y HU-AUT-03). */
@Injectable()
export class CatalogoV2Service {
  constructor(
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(Depot) private readonly depots: Repository<Depot>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly inventario: InventarioService,
  ) {}

  /** GET /autos: solo vehiculos DISPONIBLE (excluye RESERVADO, ENTREGADO, EN_MANTENIMIENTO y EN_LIMPIEZA). */
  async listar(q: { category?: string; transmission?: string; limit?: string }, opciones: OpcionesCatalogo = {}) {
    const limit = this.limite(q.limit, 10);
    await this.inventario.liberarCooldownsVencidos();
    const qb = opciones.porRango ? this.publicables() : this.disponibles();
    this.filtros(qb, q.category, q.transmission);
    const [vehiculos, total] = await qb.take(limit).getManyAndCount();
    return { total, limit, data: vehiculos.map((v) => aVehiculoCard(v)) };
  }

  /** POST /autos/search con franjas de 30 min, control etario y exclusion por cooldown. */
  async buscar(body: any, opciones: OpcionesCatalogo = {}) {
    if (!body || typeof body !== 'object') throw invalido([{ name: 'body', reason: 'Se esperaba un objeto JSON' }]);
    const faltantes = ['pickup_location', 'pickup_date', 'pickup_time', 'dropoff_date', 'dropoff_time']
      .filter((k) => body[k] === undefined || body[k] === null || body[k] === '');
    if (faltantes.length) throw invalido(faltantes.map((name) => ({ name, reason: 'Campo obligatorio' })));
    const periodo = parsearPeriodo(body);
    const edad = evaluarEdad(body.driver_age);
    if (body.category && !CATEGORIAS.includes(String(body.category))) throw invalido([{ name: 'category', reason: `Debe ser uno de ${CATEGORIAS.join(', ')}` }]);
    if (body.transmission && !TRANSMISIONES.includes(String(body.transmission))) throw invalido([{ name: 'transmission', reason: `Debe ser uno de ${TRANSMISIONES.join(', ')}` }]);

    await this.inventario.liberarCooldownsVencidos();
    const qb = opciones.porRango ? this.publicables(periodo.pickup) : this.disponibles();
    this.filtros(qb, body.category, body.transmission);
    const ciudades = (await this.depots.createQueryBuilder('d').select('DISTINCT d.city', 'city').where('d.active = true').getRawMany())
      .map((r) => r.city as string);
    const ciudad = resolverCiudad(String(body.pickup_location), ciudades);
    if (ciudad === null) qb.andWhere('1 = 0');
    else if (ciudad) qb.andWhere('LOWER(d.city) = LOWER(:ciudad)', { ciudad });

    const vehiculos = await qb.take(500).getMany();
    const ocupados = opciones.porRango
      ? await this.ocupadosEnRango(periodo.pickup_date, periodo.dropoff_date)
      : await this.ocupados();
    const data = vehiculos.filter((v) => !ocupados.has(v.vehicle_id)).map((v) => {
      const p = calcularPrecio(Number(v.price_per_day), periodo.dias, 'BASICA', edad);
      return aVehiculoCard(v, p.total);
    });
    const recargo = edad.recargo ? calcularPrecio(0, periodo.dias, 'BASICA', edad).recargo_edad : 0;
    return {
      request_id: `req-autos-${randomUUID().slice(0, 8)}`,
      metadata: {
        total_results: data.length,
        surcharge_applied: edad.recargo,
        surcharge_amount: recargo,
        surcharge_reason: edad.motivo,
        pickup_location: body.pickup_location,
        ciudad_resuelta: ciudad ?? null,
        pickup_date: periodo.pickup_date,
        dropoff_date: periodo.dropoff_date,
        pickup_time: periodo.pickup_time,
        dropoff_time: periodo.dropoff_time,
        dias: periodo.dias,
      },
      data,
    };
  }

  /** GET /autos/{id}: ficha tecnica. EN_LIMPIEZA durante el cooldown es invisible (404). */
  async detalle(id: string) {
    await this.inventario.liberarCooldownsVencidos();
    const v = await this.vehiculo(id);
    if (enCooldown(v)) {
      throw problema(404, 'VEHICLE_IN_CLEANING_COOLDOWN',
        `El vehículo ${id} está en limpieza obligatoria y no se publica hasta ${new Date(v.wash_until!).toISOString()}.`,
        { title: 'Vehículo no disponible temporalmente', disponible_desde: new Date(v.wash_until!).toISOString() });
    }
    return aVehiculoCard(v);
  }

  async coberturas(id: string) {
    const v = await this.vehiculo(id);
    return {
      auto_id: v.vehicle_id,
      vehiculo: `${v.make} ${v.model}`,
      moneda: 'USD',
      opciones: (['BASICA', 'TOTAL'] as const).map((tipo) => ({ tipo, ...COBERTURAS[tipo] })),
    };
  }

  async vehiculo(id: string): Promise<Vehicle> {
    const v = await this.vehicles.findOne({ where: { vehicle_id: id }, relations: ['images', 'depot', 'supplier'] });
    if (!v) throw problema(404, 'VEHICLE_NOT_FOUND', `No existe el vehículo ${id} en la flota.`, { title: 'Vehículo no encontrado' });
    return v;
  }

  private disponibles(): SelectQueryBuilder<Vehicle> {
    return this.vehicles.createQueryBuilder('v')
      .leftJoinAndSelect('v.depot', 'd')
      .leftJoinAndSelect('v.supplier', 's')
      .leftJoinAndSelect('v.images', 'i')
      .where("v.status = 'AVAILABLE'")
      .orderBy('v.price_per_day', 'ASC').addOrderBy('v.vehicle_id', 'ASC');
  }

  private filtros(qb: SelectQueryBuilder<Vehicle>, categoria?: string, transmision?: string): void {
    if (categoria && categoria !== 'ALL') {
      if (!CATEGORIAS.includes(categoria)) throw invalido([{ name: 'category', reason: `Debe ser uno de ${CATEGORIAS.join(', ')}` }]);
      qb.andWhere('v.car_type IN (:...cats)', { cats: categoriasInternas(categoria).concat('__ninguna__') });
    }
    if (transmision && transmision !== 'ALL') {
      const t = transmisionInterna(transmision);
      if (!t) throw invalido([{ name: 'transmission', reason: `Debe ser uno de ${TRANSMISIONES.join(', ')}` }]);
      qb.andWhere('v.transmission = :tr', { tr: t });
    }
  }

  /** Vehiculos con una orden CONFIRMED sin devolver y vigente (misma regla que /api/v1/search). */
  private async ocupados(): Promise<Set<string>> {
    const activas = await this.orders.find({
      where: { status: 'CONFIRMED', returned_at: IsNull() },
      select: { vehicle_id: true, route_details: true },
    });
    const ahora = Date.now();
    return new Set(activas
      .filter((o) => { const fin = Date.parse(o.route_details?.dropoff?.datetime); return isNaN(fin) || fin >= ahora; })
      .map((o) => o.vehicle_id));
  }

  /**
   * Vehiculos del catalogo v3: todo lo que no esta en mantenimiento ni en limpieza. Con `desde`
   * (busqueda con fechas), un auto en limpieza cuyo cooldown termina antes de la recogida tambien entra.
   */
  private publicables(desde?: Date): SelectQueryBuilder<Vehicle> {
    const qb = this.vehicles.createQueryBuilder('v')
      .leftJoinAndSelect('v.depot', 'd')
      .leftJoinAndSelect('v.supplier', 's')
      .leftJoinAndSelect('v.images', 'i')
      .orderBy('v.price_per_day', 'ASC').addOrderBy('v.vehicle_id', 'ASC');
    if (desde) {
      qb.where("(v.status IN (:...pub) OR (v.status = 'WASHING' AND v.wash_until IS NOT NULL AND v.wash_until <= :desde))", { pub: PUBLICABLES, desde });
    } else {
      qb.where('v.status IN (:...pub)', { pub: PUBLICABLES });
    }
    return qb;
  }

  /** Ordenes activas (CONFIRMED sin devolver), opcionalmente de un solo vehiculo. */
  private async activas(vehicleId?: string): Promise<Order[]> {
    return this.orders.find({
      where: { status: 'CONFIRMED', returned_at: IsNull(), checkin_devolucion_at: IsNull(), ...(vehicleId && { vehicle_id: vehicleId }) },
      select: { order_id: true, vehicle_id: true, status: true, route_details: true, returned_at: true, checkin_devolucion_at: true },
    });
  }

  /** Vehiculos con una orden activa cuyo rango [pickup, dropoff] se cruza con [desde, hasta]. */
  async ocupadosEnRango(desde: string, hasta: string): Promise<Set<string>> {
    const activas = await this.activas();
    return new Set(activas.filter((o) => ordenCruzaRango(o, desde, hasta)).map((o) => o.vehicle_id));
  }

  /** GET /api/v3/autos/{id}/disponibilidad?pickup_date=YYYY-MM-DD&dropoff_date=YYYY-MM-DD */
  async disponibilidad(id: string, pickupDate?: string, dropoffDate?: string) {
    const errores: { name: string; reason: string }[] = [];
    if (!pickupDate || !FECHA.test(pickupDate) || isNaN(Date.parse(pickupDate))) errores.push({ name: 'pickup_date', reason: 'Fecha obligatoria con formato YYYY-MM-DD' });
    if (!dropoffDate || !FECHA.test(dropoffDate) || isNaN(Date.parse(dropoffDate))) errores.push({ name: 'dropoff_date', reason: 'Fecha obligatoria con formato YYYY-MM-DD' });
    if (!errores.length && dropoffDate! < pickupDate!) errores.push({ name: 'dropoff_date', reason: 'Debe ser igual o posterior a pickup_date' });
    if (errores.length) throw invalido(errores);
    await this.inventario.liberarCooldownsVencidos();
    const v = await this.vehiculo(id);
    const activas = (await this.activas(v.vehicle_id)).filter(bloqueaRango);
    const rangos = activas.map((o) => ({ ...rangoDeOrden(o), cruza: ordenCruzaRango(o, pickupDate!, dropoffDate!) }))
      .sort((a, b) => String(a.pickup_date).localeCompare(String(b.pickup_date)));
    const cruza = rangos.some((r) => r.cruza);
    const limpiezaHasta = v.status === 'WASHING' && v.wash_until ? new Date(v.wash_until) : null;
    const enLimpieza = !!limpiezaHasta && limpiezaHasta.toISOString().slice(0, 10) >= pickupDate!;
    const estado = v.status === 'MAINTENANCE' ? 'EN_MANTENIMIENTO' : enLimpieza ? 'EN_LIMPIEZA' : cruza ? 'RESERVADO' : 'DISPONIBLE';
    const disponible = estado === 'DISPONIBLE';
    return {
      vehicle_id: v.vehicle_id,
      pickup_date: pickupDate,
      dropoff_date: dropoffDate,
      disponible,
      estado,
      status: estado,
      available_units: disponible ? 1 : 0,
      regla: 'Rangos [a1,a2] y [b1,b2] se cruzan cuando a1 <= b2 AND b1 <= a2 (ordenes CONFIRMED o ENTREGADO)',
      rangos_reservados: rangos,
    };
  }

  private limite(valor: string | undefined, porDefecto: number): number {
    if (valor === undefined || valor === '') return porDefecto;
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 1) throw invalido([{ name: 'limit', reason: 'Debe ser un entero mayor que 0' }]);
    return Math.min(n, 500);
  }
}

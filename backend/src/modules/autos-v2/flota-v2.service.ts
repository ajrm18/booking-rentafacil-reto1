import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { calcularDisponibleDesde, INTERVALO_MANTENIMIENTO_KM, Vehicle } from '../autos/entities/vehicle.entity';
import { Order } from '../autos/entities/order.entity';
import { aEstadoV2 } from '../autos/estado-vehiculo.mapper';
import { InventarioService } from '../integracion/inventario.service';
import { OutboxService } from '../integracion/outbox.service';
import { IdempotencyService } from '../integracion/idempotency.service';
import { EVENTOS } from '../integracion/nodo';
import { MantenimientoLog } from './entities/mantenimiento-log.entity';
import { AuthV2 } from './v2-auth.guard';
import { invalido, ParametroInvalido, problema } from './problema';
import { enCooldown } from './reglas';
import { aCooldown, aFlotaItem } from './v2.mapper';

interface Ctx { auth: AuthV2; idempotencyKey: string; correlationId: string }
const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim());
const entero = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

/** Panel de flota, devolucion directa y mantenimiento preventivo de /api/v2. */
@Injectable()
export class FlotaV2Service {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly inventario: InventarioService,
    private readonly outbox: OutboxService,
    private readonly idem: IdempotencyService,
  ) {}

  /** GET /autos/flota: las 6 fases con el conteo regresivo del cooldown y alertas de kilometraje. */
  async flota() {
    await this.inventario.liberarCooldownsVencidos();
    const lista = await this.vehicles.find({ relations: ['depot'], order: { vehicle_id: 'ASC' } });
    const ahora = new Date();
    return lista.map((v) => aFlotaItem(v, ahora));
  }

  /** POST /autos/{id}/devolucion: EN_LIMPIEZA con disponible_desde = NOW() + 2 h. */
  async devolucion(id: string, ctx: Ctx) {
    return this.idem.ejecutar(ctx.idempotencyKey, `devolucion:${id}`, async () => {
      await this.inventario.liberarCooldownsVencidos(ctx.correlationId);
      const v = await this.vehiculo(id);
      if (enCooldown(v)) {
        throw problema(409, 'VEHICLE_IN_CLEANING_COOLDOWN', `El vehículo ${id} ya está en limpieza hasta ${new Date(v.wash_until!).toISOString()}.`,
          { title: 'Vehículo en Cooldown de Limpieza Obligatorio (2 Horas)' });
      }
      if (['MAINTENANCE', 'INACTIVE'].includes(v.status)) {
        throw problema(409, 'VEHICLE_IN_MAINTENANCE', `El vehículo ${id} está en mantenimiento; registre el mantenimiento realizado primero.`);
      }
      if (['RESERVED', 'READY_FOR_PICKUP'].includes(v.status)) {
        throw problema(409, 'VEHICLE_RESERVED', `El vehículo ${id} está reservado y aún no se entregó; cancele la reserva o registre la entrega.`);
      }
      const ahora = new Date();
      const disponibleDesde = calcularDisponibleDesde(ahora);
      // Si el auto estaba ENTREGADO, la devolucion directa tambien cierra su orden en curso
      const enCurso = v.status === 'DELIVERED'
        ? await this.orders.findOne({ where: { vehicle_id: id, status: 'CONFIRMED', checkin_entrega_at: Not(IsNull()), checkin_devolucion_at: IsNull() } })
        : null;
      await this.ds.transaction(async (m) => {
        await m.update(Vehicle, { vehicle_id: id }, { status: 'WASHING', wash_until: disponibleDesde });
        if (enCurso) {
          await m.update(Order, { order_id: enCurso.order_id }, { checkin_devolucion_at: ahora, returned_at: ahora, returned_by_sub: ctx.auth.sub });
        }
        await this.outbox.registrar(m, EVENTOS.COOLDOWN_INICIADO, {
          auto_id: id, estado: 'EN_LIMPIEZA', cooldown_minutos: 120, disponible_desde: disponibleDesde.toISOString(),
          order_id: enCurso?.order_id ?? null, origen: 'devolucion-directa',
        }, { subject: id, correlationId: ctx.correlationId });
        await this.inventario.registrarCambio(m, { vehicle_id: id, status: 'WASHING' }, 'cooldown.started', ctx.correlationId);
      });
      this.inventario.notificarStock({ vehicle_id: id, status: 'WASHING' });
      return { ...aCooldown({ ...v, status: 'WASHING', wash_until: disponibleDesde }), order_id_cerrada: enCurso?.order_id ?? null };
    });
  }

  /** POST /autos/{id}/mantenimiento/registro (RBAC MANTENIMIENTO o ADMIN). */
  async registrarMantenimiento(id: string, body: any, ctx: Ctx) {
    const b = body && typeof body === 'object' ? body : {};
    const km = entero(b.kilometraje_registrado);
    const combustible = entero(b.nivel_combustible);
    const nuevoUmbral = b.nuevo_proximo_mantenimiento_km === undefined || b.nuevo_proximo_mantenimiento_km === null ? null : entero(b.nuevo_proximo_mantenimiento_km);
    const errores: ParametroInvalido[] = [];
    if (!texto(b.tecnico_id)) errores.push({ name: 'tecnico_id', reason: 'Campo obligatorio' });
    if (!Number.isInteger(km) || km < 0 || km > 2_000_000) errores.push({ name: 'kilometraje_registrado', reason: 'Entero >= 0 obligatorio' });
    if (!Number.isInteger(combustible) || combustible < 0 || combustible > 100) errores.push({ name: 'nivel_combustible', reason: 'Porcentaje entero de 0 a 100 obligatorio' });
    if (b.mantenimiento_realizado !== undefined && typeof b.mantenimiento_realizado !== 'boolean') errores.push({ name: 'mantenimiento_realizado', reason: 'Debe ser booleano' });
    if (nuevoUmbral !== null && (!Number.isInteger(nuevoUmbral) || nuevoUmbral <= km)) errores.push({ name: 'nuevo_proximo_mantenimiento_km', reason: 'Debe ser un entero mayor que kilometraje_registrado' });
    if (errores.length) throw invalido(errores);

    return this.idem.ejecutar(ctx.idempotencyKey, `mantenimiento:${id}`, async () => {
      const v = await this.vehiculo(id);
      if (km < (v.kilometraje_actual ?? 0)) {
        throw invalido([{ name: 'kilometraje_registrado', reason: `No puede ser menor que el odómetro registrado (${v.kilometraje_actual} km)` }]);
      }
      const realizado = b.mantenimiento_realizado === true;
      const proximo = realizado ? (nuevoUmbral ?? km + INTERVALO_MANTENIMIENTO_KM) : v.proximo_mantenimiento_km;
      const requerido = !realizado && km >= proximo;
      // Con la alerta activa el auto sale de la oferta (EN_MANTENIMIENTO) si estaba libre; al registrar
      // el mantenimiento realizado vuelve a DISPONIBLE. Un auto reservado o en uso no cambia de fase.
      let estado = v.status;
      if (requerido && v.status === 'AVAILABLE') estado = 'MAINTENANCE';
      if (realizado && v.status === 'MAINTENANCE') estado = 'AVAILABLE';
      const bitacoraId = `BIT-AUTO-${randomBytes(4).toString('hex').toUpperCase()}`;
      const ahora = new Date();

      await this.ds.transaction(async (m) => {
        await m.update(Vehicle, { vehicle_id: id }, {
          kilometraje_actual: km, proximo_mantenimiento_km: proximo, mantenimiento_requerido: requerido, status: estado,
        });
        await m.save(m.create(MantenimientoLog, {
          bitacora_id: bitacoraId, vehicle_id: id, tecnico_id: texto(b.tecnico_id).slice(0, 80), registrado_por: ctx.auth.sub,
          kilometraje_registrado: km, nivel_combustible: combustible,
          condiciones_carroceria: texto(b.condiciones_carroceria).slice(0, 500) || null,
          estado_neumaticos: texto(b.estado_neumaticos).slice(0, 40) || null,
          observaciones: texto(b.observaciones).slice(0, 2000) || null,
          mantenimiento_realizado: realizado, proximo_mantenimiento_km: proximo, alerta_emitida: requerido,
        }));
        if (requerido) {
          await this.outbox.registrar(m, EVENTOS.MANTENIMIENTO_ALERTA, {
            auto_id: id, kilometraje_actual: km, proximo_mantenimiento_km: proximo,
            severidad: km - proximo >= 1000 ? 'CRITICAL' : 'WARNING', bitacora_id: bitacoraId, origen: 'mantenimiento-registro',
          }, { subject: id, correlationId: ctx.correlationId });
        }
        if (estado !== v.status) await this.inventario.registrarCambio(m, { vehicle_id: id, status: estado }, 'mantenimiento', ctx.correlationId);
      });
      if (estado !== v.status) this.inventario.notificarStock({ vehicle_id: id, status: estado });

      return {
        auto_id: id,
        marca_modelo: `${v.make} ${v.model}`,
        kilometraje_actual: km,
        proximo_mantenimiento_km: proximo,
        mantenimiento_requerido: requerido,
        mantenimiento_realizado: realizado,
        estado_operativo: aEstadoV2(estado),
        alerta_preventiva: requerido
          ? `ALERTA PREVENTIVA: El vehículo ha superado el límite de ${proximo} km. Mantenimiento requerido.`
          : realizado
            ? `Mantenimiento registrado. Próximo mantenimiento a los ${proximo} km.`
            : `Kilometraje en rango normal. Próximo mantenimiento a los ${proximo} km.`,
        nivel_combustible: `${combustible}%`,
        bitacora_id: bitacoraId,
        tecnico_id: texto(b.tecnico_id),
        timestamp: ahora.toISOString(),
      };
    });
  }

  async bitacora(id: string) {
    await this.vehiculo(id);
    return this.ds.getRepository(MantenimientoLog).find({ where: { vehicle_id: id }, order: { created_at: 'DESC' }, take: 50 });
  }

  private async vehiculo(id: string): Promise<Vehicle> {
    const v = await this.vehicles.findOne({ where: { vehicle_id: id } });
    if (!v) throw problema(404, 'VEHICLE_NOT_FOUND', `No existe el vehículo ${id} en la flota.`, { title: 'Vehículo no encontrado' });
    return v;
  }
}

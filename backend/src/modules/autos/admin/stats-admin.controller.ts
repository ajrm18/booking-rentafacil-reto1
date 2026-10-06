import { Controller, Get } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Depot } from '../entities/depot.entity';
import { Hold } from '../entities/hold.entity';
import { Order } from '../entities/order.entity';
import { OrderPreview } from '../entities/order-preview.entity';
import { Supplier } from '../entities/supplier.entity';
import { Vehicle } from '../entities/vehicle.entity';
import { VehicleImage } from '../entities/vehicle-image.entity';
import { WebhookSubscription } from '../entities/webhook.entity';
import { User } from '../entities/user.entity';
import { AdminApi } from './admin-api.helpers';

/** Estadísticas agregadas de las 9 tablas para el panel de control. */
@AdminApi('Admin - Dashboard')
@Controller('admin/stats')
export class StatsAdminController {
  constructor(
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(VehicleImage) private readonly images: Repository<VehicleImage>,
    @InjectRepository(Depot) private readonly depots: Repository<Depot>,
    @InjectRepository(Supplier) private readonly suppliers: Repository<Supplier>,
    @InjectRepository(Hold) private readonly holds: Repository<Hold>,
    @InjectRepository(OrderPreview) private readonly previews: Repository<OrderPreview>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(WebhookSubscription) private readonly webhooks: Repository<WebhookSubscription>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Estadísticas agregadas para el panel de control' })
  async stats() {
    const [
      totalVehicles, totalImages, totalDepots, totalSuppliers,
      totalHolds, totalPreviews, totalOrders, totalWebhooks, confirmed, totalUsers, completed,
    ] = await Promise.all([
      this.vehicles.count(),
      this.images.count(),
      this.depots.count(),
      this.suppliers.count(),
      this.holds.count(),
      this.previews.count(),
      this.orders.count(),
      this.webhooks.count(),
      this.orders.count({ where: { status: 'CONFIRMED' } }),
      this.users.count(),
      // Finalizadas: CONFIRMED cuya devolución (route_details.dropoff.datetime) ya pasó
      this.orders.createQueryBuilder('o')
        .where("o.status = 'CONFIRMED'")
        .andWhere("(o.route_details->'dropoff'->>'datetime')::timestamptz < now()")
        .getCount(),
    ]);
    const revenue = await this.orders.sum('total_price', { status: 'CONFIRMED' });
    return {
      total_vehicles: totalVehicles,
      total_vehicle_images: totalImages,
      total_depots: totalDepots,
      total_suppliers: totalSuppliers,
      total_holds: totalHolds,
      total_order_previews: totalPreviews,
      total_orders: totalOrders,
      total_webhooks: totalWebhooks,
      total_users: totalUsers,
      completed_orders: completed,
      confirmed_orders: confirmed,
      total_revenue: Number(Number(revenue ?? 0).toFixed(2)),
    };
  }
}

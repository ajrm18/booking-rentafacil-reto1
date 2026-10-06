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
import { AdminApi } from './admin-api.helpers';

/** Estadisticas agregadas de las 8 tablas para el dashboard admin. */
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
  ) {}

  @Get()
  @ApiOperation({ summary: 'Estadisticas agregadas para el dashboard admin' })
  async stats() {
    const [
      totalVehicles, totalImages, totalDepots, totalSuppliers,
      totalHolds, totalPreviews, totalOrders, totalWebhooks, confirmed,
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
      confirmed_orders: confirmed,
      total_revenue: Number(Number(revenue ?? 0).toFixed(2)),
    };
  }
}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';
import { AutosService } from './autos.service';
import { WebhookDispatcher } from './webhook-dispatcher.service';
import { AutosController } from './autos.controller';
import { AuthDemoController } from './auth-demo.controller';
import { AccountController } from './account.controller';
import { UsersAdminController } from './admin/users-admin.controller';
import { DepotsAdminController } from './admin/depots-admin.controller';
import { HoldsAdminController } from './admin/holds-admin.controller';
import { OrderPreviewsAdminController } from './admin/order-previews-admin.controller';
import { OrdersAdminController } from './admin/orders-admin.controller';
import { StatsAdminController } from './admin/stats-admin.controller';
import { SuppliersAdminController } from './admin/suppliers-admin.controller';
import { VehicleImagesAdminController } from './admin/vehicle-images-admin.controller';
import { VehiclesAdminController } from './admin/vehicles-admin.controller';
import { WebhooksAdminController } from './admin/webhooks-admin.controller';
import { Depot } from './entities/depot.entity';
import { Hold } from './entities/hold.entity';
import { Order } from './entities/order.entity';
import { OrderPreview } from './entities/order-preview.entity';
import { Supplier } from './entities/supplier.entity';
import { Vehicle } from './entities/vehicle.entity';
import { VehicleImage } from './entities/vehicle-image.entity';
import { WebhookSubscription } from './entities/webhook.entity';
import { User } from './entities/user.entity';

@Module({
  imports: [
    CommonModule,
    TypeOrmModule.forFeature([
      Depot, Supplier, Vehicle, VehicleImage,
      Hold, OrderPreview, Order, WebhookSubscription, User,
    ]),
  ],
  controllers: [
    AutosController,
    AuthDemoController,
    AccountController,
    // Administración interna: una API CRUD por cada tabla de la BD (9)
    SuppliersAdminController,
    DepotsAdminController,
    VehiclesAdminController,
    VehicleImagesAdminController,
    HoldsAdminController,
    OrderPreviewsAdminController,
    OrdersAdminController,
    WebhooksAdminController,
    UsersAdminController,
    StatsAdminController,
  ],
  providers: [AutosService, WebhookDispatcher],
})
export class AutosModule {}

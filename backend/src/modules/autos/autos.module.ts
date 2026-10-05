import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';
import { AutosService } from './autos.service';
import { AutosController } from './autos.controller';
import { AdminController } from './admin.controller';
import { AuthDemoController } from './auth-demo.controller';
import { Depot } from './entities/depot.entity';
import { Hold } from './entities/hold.entity';
import { Order } from './entities/order.entity';
import { OrderPreview } from './entities/order-preview.entity';
import { Supplier } from './entities/supplier.entity';
import { Vehicle } from './entities/vehicle.entity';
import { VehicleImage } from './entities/vehicle-image.entity';
import { WebhookSubscription } from './entities/webhook.entity';

@Module({
  imports: [
    CommonModule,
    TypeOrmModule.forFeature([
      Depot, Supplier, Vehicle, VehicleImage,
      Hold, OrderPreview, Order, WebhookSubscription,
    ]),
  ],
  controllers: [AutosController, AdminController, AuthDemoController],
  providers: [AutosService],
})
export class AutosModule {}

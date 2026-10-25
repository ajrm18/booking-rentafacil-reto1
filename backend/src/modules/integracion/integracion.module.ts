import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vehicle } from '../autos/entities/vehicle.entity';
import { OutboxEvent } from './entities/outbox-event.entity';
import { IdempotencyRecord } from './entities/idempotency-record.entity';
import { EventBusService } from './event-bus.service';
import { OutboxService } from './outbox.service';
import { IdempotencyService } from './idempotency.service';
import { InventarioService } from './inventario.service';
import { StockCacheService } from './grpc/stock-cache.service';
import { StockPushClient } from './grpc/stock-push.client';
import { StockGrpcController } from './grpc/stock-grpc.controller';

/**
 * Infraestructura de integracion del Reto 2 compartida por /api/v1 y /api/v2: Transactional
 * Outbox + RabbitMQ (CloudEvents), stock por gRPC (servidor :50051 y cliente hacia el Booking)
 * e idempotencia persistente.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Vehicle, OutboxEvent, IdempotencyRecord])],
  controllers: [StockGrpcController],
  providers: [EventBusService, OutboxService, IdempotencyService, InventarioService, StockCacheService, StockPushClient],
  exports: [EventBusService, OutboxService, IdempotencyService, InventarioService, StockCacheService, StockPushClient],
})
export class IntegracionModule {}

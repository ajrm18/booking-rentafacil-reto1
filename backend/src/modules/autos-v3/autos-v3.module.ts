import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';
import { V3AuthGuard } from '../../common/guards/v3-auth.guard';
import { IntegracionModule } from '../integracion/integracion.module';
import { AutosV2Module } from '../autos-v2/autos-v2.module';
import { ClientesModule } from '../clientes/clientes.module';
import { Vehicle } from '../autos/entities/vehicle.entity';
import { Depot } from '../autos/entities/depot.entity';
import { Supplier } from '../autos/entities/supplier.entity';
import { Order } from '../autos/entities/order.entity';
import { BookingNotification } from './entities/booking-notification.entity';
import { Checkin } from './entities/checkin.entity';
import {
  CatalogoV3Controller, FlotaV3Controller, PromocionesV3Controller, ReservasV3Controller, TelemetriaV3Controller,
} from './autos-v3.controllers';
import { VehiculosV3Controller } from './vehiculos-v3.controller';
import { BookingNotifierService } from './booking-notifier.service';
import { HealthV3Service } from './health-v3.service';
import { ReservasV3Service } from './reservas-v3.service';

/**
 * Contrato v3.0.0 (backend/contracts/autos-openapi-v3.yaml) + requerimiento v3.1 (clientes
 * cross-platform, check-in asistido y notificacion al Booking). Reutiliza los servicios de v2.
 */
@Module({
  imports: [
    CommonModule,
    IntegracionModule,
    AutosV2Module,
    ClientesModule,
    TypeOrmModule.forFeature([Vehicle, Depot, Supplier, Order, BookingNotification, Checkin]),
  ],
  // Rutas fijas antes que /api/v3/autos/:id
  controllers: [TelemetriaV3Controller, VehiculosV3Controller, PromocionesV3Controller, FlotaV3Controller, ReservasV3Controller, CatalogoV3Controller],
  providers: [ReservasV3Service, HealthV3Service, BookingNotifierService, V3AuthGuard],
  exports: [BookingNotifierService],
})
export class AutosV3Module {}

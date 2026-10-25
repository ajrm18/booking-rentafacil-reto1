import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';
import { IntegracionModule } from '../integracion/integracion.module';
import { Vehicle } from '../autos/entities/vehicle.entity';
import { Depot } from '../autos/entities/depot.entity';
import { Order } from '../autos/entities/order.entity';
import { ContratoPromociones } from './entities/contrato-promociones.entity';
import { MantenimientoLog } from './entities/mantenimiento-log.entity';
import {
  CatalogoV2Controller, FlotaV2Controller, PromocionesV2Controller, ReservasV2Controller, TelemetriaV2Controller,
} from './autos-v2.controllers';
import { CatalogoV2Service } from './catalogo-v2.service';
import { ReservasV2Service } from './reservas-v2.service';
import { FlotaV2Service } from './flota-v2.service';
import { PromocionesV2Service } from './promociones-v2.service';
import { HealthV2Service } from './health-v2.service';
import { V2AuthGuard } from './v2-auth.guard';
import { IdempotencyV2Guard } from './idempotency-v2.guard';

/**
 * API de autos v2.0.0 (backend/contracts/autos-openapi-v2.yaml) como proveedor del Booking
 * Prototipo central. Comparte BD y entidades con el v1 (/api/v1 sigue intacto).
 */
@Module({
  imports: [
    CommonModule,
    IntegracionModule,
    TypeOrmModule.forFeature([Vehicle, Depot, Order, ContratoPromociones, MantenimientoLog]),
  ],
  // Orden de registro de rutas: las fijas antes que /api/v2/autos/:id
  controllers: [TelemetriaV2Controller, PromocionesV2Controller, FlotaV2Controller, ReservasV2Controller, CatalogoV2Controller],
  providers: [
    CatalogoV2Service, ReservasV2Service, FlotaV2Service, PromocionesV2Service, HealthV2Service,
    V2AuthGuard, IdempotencyV2Guard,
  ],
})
export class AutosV2Module {}

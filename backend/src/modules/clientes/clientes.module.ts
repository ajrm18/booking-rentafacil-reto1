import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';
import { V3AuthGuard } from '../../common/guards/v3-auth.guard';
import { Cliente } from './cliente.entity';
import { ClientesAdminController, ClientesController } from './clientes.controller';
import { ClientesService } from './clientes.service';

/** ms_identity (db_identity.clientes): clientes cross-platform compartidos con el Booking central. */
@Module({
  imports: [CommonModule, TypeOrmModule.forFeature([Cliente])],
  controllers: [ClientesController, ClientesAdminController],
  providers: [ClientesService, V3AuthGuard],
  exports: [ClientesService],
})
export class ClientesModule {}

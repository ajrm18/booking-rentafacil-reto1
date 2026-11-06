import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from './common/common.module';
import { opcionesBaseDatos } from './common/database';
import { AutosModule } from './modules/autos/autos.module';
import { AutosV2Module } from './modules/autos-v2/autos-v2.module';
import { AutosV3Module } from './modules/autos-v3/autos-v3.module';
import { ClientesModule } from './modules/clientes/clientes.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env', expandVariables: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => opcionesBaseDatos(config),
    }),
    CommonModule,
    AutosModule,     // /api/v1 (Reto 1)
    AutosV2Module,   // /api/v2 (Reto 2)
    ClientesModule,  // /api/v3/clientes (v3.1)
    AutosV3Module,   // /api/v3 (Reto 2 final)
  ],
})
export class AppModule {}

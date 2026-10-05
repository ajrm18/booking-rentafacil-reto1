import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from './common/common.module';
import { AutosModule } from './modules/autos/autos.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        autoLoadEntities: true,
        synchronize: true, // Reto 1: se acepta; en Reto 2 se migran a migrations
        ssl: config.get<string>('NODE_ENV') === 'production'
          ? { rejectUnauthorized: false } : false,
        logging: config.get<string>('NODE_ENV') === 'production'
          ? ['error'] : ['error', 'warn'],
      }),
    }),
    CommonModule,
    AutosModule,
  ],
})
export class AppModule {}

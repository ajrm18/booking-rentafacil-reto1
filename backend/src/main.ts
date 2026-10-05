import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, HttpException, BadRequestException } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Prefijo global: /api/v1 (alineado con servers.url = https://.../autos/v1)
  app.setGlobalPrefix('api/v1');

  app.enableCors({
    origin: [
      config.get<string>('FRONTEND_URL') || 'http://localhost:5173',
      'http://localhost:5173',
      'http://localhost:3000',
      /\.vercel\.app$/,
    ],
    credentials: true,
    exposedHeaders: ['Cache-Control', 'X-API-Deprecation-Date', 'Retry-After'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors) => {
        const invalidParams = errors.map((e) => ({
          name: e.property,
          reason: Object.values(e.constraints || {}).join(', ') || 'Invalid',
        }));
        return new BadRequestException({
          type: 'https://api.booking-hub.com/errors/validation-failed',
          title: 'Petición inválida',
          status: 400,
          code: 'VALIDATION_FAILED',
          invalidParams,
        });
      },
    }),
  );

  app.useGlobalFilters(new ProblemDetailsFilter());

  const swagger = new DocumentBuilder()
    .setTitle('GDS Autos Core API - RentaFacil EC')
    .setDescription(
      'Implementacion del contrato oficial contracts/autos-openapi.yaml para el Reto 1 del proyecto Booking Prototipo. ' +
      'Microservicio centralizado para busqueda, disponibilidad, reservas (ordenes) y postventa de renta de autos. ' +
      'Autor: Anthony Rosero.',
    )
    .setVersion('1.0.0')
    .addBearerAuth({
      type: 'oauth2', flows: {
        clientCredentials: {
          tokenUrl: 'https://auth.booking-hub.com/oauth2/token',
          scopes: {
            'autos:read': 'Leer informacion de autos, catalogos y reservas',
            'autos:book': 'Crear, mantener en hold y alterar reservas',
            'autos:cancel': 'Cancelar reservas',
            'autos:webhooks': 'Gestionar webhooks',
          },
        } as any,
      },
    } as any, 'OAuth2Security')
    .addTag('Búsqueda y Catálogo')
    .addTag('Información de Agencias y Proveedores')
    .addTag('Gestión de Órdenes (Reservas)')
    .addTag('Componentes Comunes')
    .addTag('Webhooks')
    .addTag('Autenticación (demo)', 'Endpoint auxiliar para emitir JWT localmente')
    .addTag('Administracion Interna', 'BFF del panel admin (fuera del contrato publico)')
    .build();
  const document = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      tagsSorter: 'alpha',
    },
    customSiteTitle: 'RentaFacil EC - Autos API Docs',
  });

  const port = config.get<number>('PORT') || 3000;
  await app.listen(port);
  Logger.log(`GDS Autos API - RentaFacil EC corriendo en puerto ${port}`, 'Bootstrap');
  Logger.log(`Swagger: /api/docs`, 'Bootstrap');
}
bootstrap();

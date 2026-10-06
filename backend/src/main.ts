import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, BadRequestException, ValidationError } from '@nestjs/common';
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
        // Aplana errores anidados: { name: 'route.pickup.datetime', reason: '...' }
        const flatten = (errs: ValidationError[], prefix = ''): { name: string; reason: string }[] =>
          errs.flatMap((e) => {
            const name = prefix ? `${prefix}.${e.property}` : e.property;
            const own = e.constraints ? [{ name, reason: Object.values(e.constraints).join(', ') }] : [];
            return [...own, ...flatten(e.children || [], name)];
          });
        const invalidParams = flatten(errors);
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

  // Metadatos y seguridad copiados de contracts/autos-openapi.yaml (info + components.securitySchemes)
  const swagger = new DocumentBuilder()
    .setTitle('GDS Autos Core API')
    .setDescription(
      'Microservicio centralizado para búsqueda, disponibilidad, reservas (órdenes) y postventa de renta de autos. ' +
      'El dueño de la reserva (ownerId) se infiere del sub del token JWT. La lógica de pagos pertenece a otros dominios/APIs.\n\n' +
      'Implementacion de RentaFacil EC (Reto 1 - Booking Prototipo) del contrato contracts/autos-openapi.yaml. ' +
      'Para probar: obtenga un JWT con POST /api/v1/auth/token y peguelo en Authorize > bearer.',
    )
    .setVersion('1.0.0')
    .setContact('Joselyn Cadena', '', 'jlcadenac@puce.edu.ec')
    .addOAuth2({
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: 'https://auth.booking-hub.com/oauth2/authorize',
          tokenUrl: 'https://auth.booking-hub.com/oauth2/token',
          scopes: {
            'autos:read': 'Leer información de autos, catálogos y reservas',
            'autos:book': 'Crear, mantener en hold y alterar reservas',
            'autos:cancel': 'Cancelar reservas',
            'autos:webhooks': 'Gestionar webhooks',
          },
        },
        clientCredentials: {
          tokenUrl: 'https://auth.booking-hub.com/oauth2/token',
          scopes: {
            'autos:read': '(B2B) Leer',
            'autos:book': '(B2B) Comprar',
            'autos:cancel': '(B2B) Cancelar',
            'autos:webhooks': '(B2B) Webhooks',
          },
        },
      },
    }, 'OAuth2Security')
    // JWT emitido localmente por /auth/token (sustituye al Authorization Server en Reto 1)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .addSecurityRequirements('OAuth2Security')
    .addTag('Búsqueda y Catálogo')
    .addTag('Información de Agencias y Proveedores')
    .addTag('Gestión de Órdenes (Reservas)')
    .addTag('Componentes Comunes')
    .addTag('Webhooks')
    .addTag('Autenticación (demo)', 'Endpoint auxiliar para emitir JWT localmente')
    .addTag('Admin - Suppliers', 'CRUD de la tabla suppliers')
    .addTag('Admin - Depots', 'CRUD de la tabla depots')
    .addTag('Admin - Vehiculos', 'CRUD de la tabla vehicles')
    .addTag('Admin - Imagenes de Vehiculos', 'CRUD de la tabla vehicle_images')
    .addTag('Admin - Holds', 'CRUD de la tabla holds')
    .addTag('Admin - Previsualizaciones de Orden', 'CRUD de la tabla order_previews')
    .addTag('Admin - Ordenes', 'CRUD de la tabla orders')
    .addTag('Admin - Webhooks', 'CRUD de la tabla webhook_subscriptions')
    .addTag('Admin - Dashboard', 'Estadisticas agregadas')
    .build();
  const document = SwaggerModule.createDocument(app, swagger);
  // Igual que el contrato: los endpoints publicos (header X-Affiliate-Id) y /auth/token
  // anulan la seguridad global con `security: []`.
  for (const [path, item] of Object.entries(document.paths)) {
    for (const op of Object.values(item) as any[]) {
      const publico = op?.parameters?.some((p: any) => p.in === 'header' && p.name === 'X-Affiliate-Id')
        || path.endsWith('/auth/token');
      if (publico) op.security = [];
    }
  }
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

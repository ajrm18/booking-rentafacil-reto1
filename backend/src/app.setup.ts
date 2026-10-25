import { BadRequestException, INestApplication, RequestMethod, ValidationError, ValidationPipe } from '@nestjs/common';
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ProblemDetailsFilter } from './common/filters/http-exception.filter';
import { CORRELATION_HEADER, correlationMiddleware } from './common/correlation';

/**
 * Origenes del Booking Prototipo central (docs/integracion-booking.md §3.2) + frontend propio.
 */
export function corsOptions(frontendUrl?: string): CorsOptions {
  return {
    origin: [
      frontendUrl || 'http://localhost:5173',
      'https://booking.epn.edu.ec',
      'http://localhost:3000',
      'http://localhost:4000',
      'http://localhost:5173',
      /\.vercel\.app$/,
    ],
    credentials: true,
    exposedHeaders: ['Cache-Control', 'X-API-Deprecation-Date', 'Retry-After', CORRELATION_HEADER],
  };
}

/**
 * Prefijo, validacion y formato de errores comunes a main.ts y a las pruebas e2e,
 * para que los tests levanten la app exactamente como produccion.
 */
export function configureApp(app: INestApplication): void {
  // X-Correlation-Id en todas las respuestas (trazabilidad end-to-end del Reto 2)
  app.use(correlationMiddleware);

  // Prefijo global: /api/v1 (alineado con servers.url = https://.../autos/v1). Los controladores
  // del contrato v2 declaran su ruta completa /api/v2/autos/... y quedan fuera del prefijo.
  app.setGlobalPrefix('api/v1', { exclude: [{ path: 'api/v2/(.*)', method: RequestMethod.ALL }] });

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
}

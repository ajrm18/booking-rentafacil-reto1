import { BadRequestException, INestApplication, ValidationError, ValidationPipe } from '@nestjs/common';
import { ProblemDetailsFilter } from './common/filters/http-exception.filter';

/**
 * Prefijo, validacion y formato de errores comunes a main.ts y a las pruebas e2e,
 * para que los tests levanten la app exactamente como produccion.
 */
export function configureApp(app: INestApplication): void {
  // Prefijo global: /api/v1 (alineado con servers.url = https://.../autos/v1)
  app.setGlobalPrefix('api/v1');

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

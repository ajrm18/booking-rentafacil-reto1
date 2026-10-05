import { Body, Controller, Post, UnauthorizedException } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * Endpoint auxiliar (fuera del contrato) para obtener un JWT local usable
 * como Bearer contra los endpoints protegidos. En produccion se sustituye
 * por el Authorization Server del Booking Hub central.
 */
class TokenDto {
  @IsString() email: string;
  @IsString() password: string;
  @IsOptional() @IsIn(['client', 'admin']) role?: 'client' | 'admin';
}

@ApiTags('Autenticación (demo)')
@Controller('auth')
export class AuthDemoController {
  constructor(private readonly jwt: JwtService) {}

  @Post('token')
  @ApiOperation({ summary: 'Emitir JWT con scopes (demo local, no forma parte del contrato oficial)' })
  @ApiBody({ type: TokenDto })
  async token(@Body() body: TokenDto) {
    // Cuentas demo pre-cargadas por el seed
    const demoUsers: Record<string, { password: string; role: 'client' | 'admin' }> = {
      'admin@rentafacil.ec': { password: 'Admin12345', role: 'admin' },
      'maria@example.com': { password: 'Cliente12345', role: 'client' },
      'carlos@example.com': { password: 'Cliente12345', role: 'client' },
    };
    const u = demoUsers[body.email];
    if (!u || u.password !== body.password) {
      throw new UnauthorizedException({
        type: 'https://api.booking-hub.com/errors/invalid-credentials',
        title: 'Credenciales invalidas',
        status: 401,
        code: 'VALIDATION_FAILED',
      });
    }
    const scopes = u.role === 'admin'
      ? ['autos:read', 'autos:book', 'autos:cancel', 'autos:webhooks']
      : ['autos:read', 'autos:book', 'autos:cancel'];

    const token = await this.jwt.signAsync({ sub: body.email, scopes, role: u.role });
    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: 86400,
      scope: scopes.join(' '),
      user: { email: body.email, role: u.role },
    };
  }
}

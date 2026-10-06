import { Body, Controller, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { verifyPassword } from '../../common/password';
import { User } from './entities/user.entity';

/**
 * Endpoint auxiliar (fuera del contrato) para obtener un JWT local usable
 * como Bearer contra los endpoints protegidos. En producción se sustituye
 * por el Authorization Server del Booking Hub central.
 */
class TokenDto {
  @IsString() email: string;
  @IsString() password: string;
  @IsOptional() @IsIn(['client', 'admin']) role?: 'client' | 'admin';
}

export const SCOPES_POR_ROL = {
  admin: ['autos:read', 'autos:book', 'autos:cancel', 'autos:webhooks'],
  client: ['autos:read', 'autos:book', 'autos:cancel'],
} as const;

@ApiTags('Autenticación (demo)')
@Controller('auth')
export class AuthDemoController {
  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  @Post('token')
  @HttpCode(201)
  @ApiOperation({ summary: 'Emitir JWT con scopes (demo local, no forma parte del contrato oficial)' })
  @ApiBody({ type: TokenDto })
  async token(@Body() body: TokenDto) {
    // Usuarios de la tabla `users` (el seed crea admin, maría y carlos; el admin puede crear más)
    const user = await this.users.createQueryBuilder('u')
      .addSelect('u.password_hash')
      .where('LOWER(u.email) = LOWER(:email)', { email: body.email.trim() })
      .getOne();
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      throw new UnauthorizedException({
        type: 'https://api.booking-hub.com/errors/invalid-credentials',
        title: 'Credenciales inválidas',
        status: 401,
        detail: 'El correo o la contraseña no son correctos.',
        code: 'VALIDATION_FAILED',
      });
    }
    const scopes = [...SCOPES_POR_ROL[user.role]];

    const token = await this.jwt.signAsync({ sub: user.email, scopes, role: user.role });
    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: 86400,
      scope: scopes.join(' '),
      user: { email: user.email, role: user.role, first_name: user.first_name, last_name: user.last_name },
    };
  }
}

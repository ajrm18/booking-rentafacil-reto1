import { Body, Controller, HttpCode, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { hashPassword, verifyPassword } from '../../common/password';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { User } from './entities/user.entity';
import { requireFields } from './admin/admin-api.helpers';
import { validarUsuario } from './user-validaciones';

/**
 * Endpoints auxiliares (fuera del contrato) para registrarse y obtener un JWT local usable
 * como Bearer contra los endpoints protegidos. En producción se sustituye
 * por el Authorization Server del Booking Hub central.
 */
class TokenDto {
  @IsString() email: string;
  @IsString() password: string;
  @IsOptional() @IsIn(['client', 'admin']) role?: 'client' | 'admin';
}

/**
 * Registro público de clientes: los mismos campos y reglas que "Nuevo cliente" del admin,
 * pero sin `role` (forbidNonWhitelisted lo rechaza): quien se registra siempre es cliente.
 */
const OBLIGATORIO = { message: 'Campo obligatorio' };
class RegisterDto {
  @ApiProperty({ example: 'Ana' }) @IsString(OBLIGATORIO) first_name: string;
  @ApiProperty({ example: 'Torres' }) @IsString(OBLIGATORIO) last_name: string;
  @ApiProperty({ example: 'ana@example.com' }) @IsString(OBLIGATORIO) email: string;
  @ApiProperty({ example: '0983563584' }) @IsString(OBLIGATORIO) phone: string;
  @ApiProperty({ example: '1710034065', description: 'Cédula ecuatoriana (10 dígitos)' }) @IsString(OBLIGATORIO) national_id: string;
  @ApiProperty({ minLength: 8, maxLength: 72 }) @IsString(OBLIGATORIO) password: string;
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
    return this.emitirToken(user);
  }

  @Post('register')
  @HttpCode(201)
  @UseGuards(RateLimitGuard)
  @ApiOperation({ summary: 'Registrar un cliente nuevo y devolver su JWT (demo local, no forma parte del contrato oficial)' })
  @ApiBody({ type: RegisterDto })
  async register(@Body() body: RegisterDto) {
    requireFields(body, ['first_name', 'last_name', 'email', 'phone', 'national_id', 'password']);
    const datos = await validarUsuario(this.users, body);
    const { user_id } = await this.users.save(
      this.users.create({ ...datos, role: 'client', password_hash: hashPassword(body.password) }),
    );
    return this.emitirToken(await this.users.findOneByOrFail({ user_id }));
  }

  /** Misma respuesta en login y registro: el cliente recién registrado entra directamente. */
  private async emitirToken(user: User) {
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

import { Controller, Get, NotFoundException, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { AuthContext, OAuth2Guard, RequireScopes } from '../../common/guards/oauth2.guard';
import { AutosService } from './autos.service';

/**
 * Cuenta del usuario autenticado (fuera del contrato). El contrato solo permite consultar una
 * orden por id; para la página "Mis reservas" el cliente necesita listar las suyas, identificadas
 * por el `sub` del JWT igual que en /orders/{orderId}.
 */
@ApiTags('Cuenta (fuera del contrato)')
@ApiBearerAuth()
@Controller('account')
@UseGuards(OAuth2Guard)
@RequireScopes('autos:read')
export class AccountController {
  constructor(
    private readonly autosService: AutosService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  @Get('profile')
  @ApiOperation({ summary: 'Mi perfil (nombre, apellido, correo, teléfono) para autollenar los datos del conductor' })
  async profile(@Req() req: Request) {
    const sub = ((req as any).auth as AuthContext).sub;
    const u = await this.users.findOne({ where: { email: sub } });
    if (!u) {
      throw new NotFoundException({
        type: 'https://api.booking-hub.com/errors/not-found', title: 'Perfil no encontrado', status: 404, code: 'VALIDATION_FAILED',
      });
    }
    return { first_name: u.first_name, last_name: u.last_name, email: u.email, phone: u.phone, role: u.role };
  }

  @Get('orders')
  @ApiOperation({ summary: 'Listar mis órdenes (OrderDetail[]) — dueño = sub del token' })
  myOrders(@Req() req: Request) {
    return this.autosService.listMyOrders((req as any).auth as AuthContext);
  }
}

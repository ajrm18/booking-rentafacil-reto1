import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
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
  constructor(private readonly autosService: AutosService) {}

  @Get('orders')
  @ApiOperation({ summary: 'Listar mis órdenes (OrderDetail[]) — dueño = sub del token' })
  myOrders(@Req() req: Request) {
    return this.autosService.listMyOrders((req as any).auth as AuthContext);
  }
}

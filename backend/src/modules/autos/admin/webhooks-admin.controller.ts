import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WEBHOOK_EVENTS } from '../dto/orders.dto';
import { WebhookSubscription } from '../entities/webhook.entity';
import { AdminApi, deleteOr404, findOr404, requireFields } from './admin-api.helpers';

/** `events` debe ser una lista no vacia de los eventos del contrato (WebhookSubscription.events). */
function assertEvents(events: unknown): void {
  if (events === undefined) return;
  if (!Array.isArray(events) || events.length === 0 || events.some((e) => !WEBHOOK_EVENTS.includes(e))) {
    throw new BadRequestException({
      type: 'https://api.booking-hub.com/errors/validation-failed',
      title: 'Petición inválida',
      status: 400,
      code: 'VALIDATION_FAILED',
      invalidParams: [{ name: 'events', reason: `Debe ser una lista no vacia de: ${WEBHOOK_EVENTS.join(', ')}` }],
    });
  }
}

/**
 * API de la tabla `webhook_subscriptions`. Complementa /webhooks del contrato
 * (que solo lista, crea y borra) con consulta individual y edicion.
 */
@AdminApi('Admin - Webhooks')
@Controller('admin/webhooks')
export class WebhooksAdminController {
  constructor(
    @InjectRepository(WebhookSubscription) private readonly webhooks: Repository<WebhookSubscription>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar suscripciones de webhook' })
  list() {
    return this.webhooks.find({ order: { created_at: 'DESC' } });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una suscripcion' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return findOr404(this.webhooks, { id }, 'Webhook', id);
  }

  @Post()
  @ApiOperation({ summary: 'Crear una suscripcion' })
  create(@Body() body: Partial<WebhookSubscription>) {
    requireFields(body, ['url', 'events']);
    assertEvents(body.events);
    const { id: _id, created_at: _c, ...campos } = body;
    return this.webhooks.save(this.webhooks.create(campos));
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar una suscripcion (url, eventos, activar/desactivar)' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: Partial<WebhookSubscription>) {
    const w = await findOr404(this.webhooks, { id }, 'Webhook', id);
    assertEvents(body.events);
    const { id: _id, created_at: _c, ...campos } = body;
    Object.assign(w, campos);
    return this.webhooks.save(w);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Eliminar una suscripcion' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return deleteOr404(this.webhooks, { id }, 'Webhook', id);
  }
}

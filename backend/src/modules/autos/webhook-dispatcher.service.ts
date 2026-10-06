import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, randomUUID } from 'crypto';
import { WebhookSubscription } from './entities/webhook.entity';

export type WebhookEvent = 'CAR_ORDER_CONFIRMED' | 'CAR_ORDER_CANCELLED' | 'DEPOT_UPDATE';

/**
 * Entrega de eventos a los webhooks suscritos, segun el callback `carEvent` de
 * POST /webhooks en autos-openapi.yaml: POST {url} con un WebhookPayload
 * (eventId, eventType, timestamp, resourceId, data).
 *
 * Si la suscripcion tiene `secret`, se firma el cuerpo con HMAC-SHA256 en la cabecera
 * X-Webhook-Signature para que el receptor valide el origen. La entrega es "fire and forget":
 * un receptor caido nunca bloquea ni hace fallar la operacion de negocio.
 */
@Injectable()
export class WebhookDispatcher {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger('WebhookDispatcher');

  constructor(
    @InjectRepository(WebhookSubscription) private readonly webhooks: Repository<WebhookSubscription>,
  ) {}

  dispatch(eventType: WebhookEvent, resourceId: string, data?: Record<string, any>): void {
    this.deliver(eventType, resourceId, data).catch((e) =>
      this.logger.warn(`No se pudo despachar ${eventType}: ${e?.message}`));
  }

  private async deliver(eventType: WebhookEvent, resourceId: string, data?: Record<string, any>) {
    const subs = (await this.webhooks.find({ where: { active: true } }))
      .filter((s) => Array.isArray(s.events) && s.events.includes(eventType));
    if (subs.length === 0) return;

    const payload = {
      eventId: randomUUID(),
      eventType,
      timestamp: new Date().toISOString(),
      resourceId,
      ...(data && { data }),
    };
    const body = JSON.stringify(payload);

    await Promise.allSettled(subs.map(async (s) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (s.secret) headers['X-Webhook-Signature'] = `sha256=${createHmac('sha256', s.secret).update(body).digest('hex')}`;
      try {
        const r = await fetch(s.url, {
          method: 'POST', headers, body, signal: AbortSignal.timeout(WebhookDispatcher.TIMEOUT_MS),
        });
        this.logger.log(`${eventType} -> ${s.url} (${r.status})`);
      } catch (e: any) {
        this.logger.warn(`${eventType} -> ${s.url} fallo: ${e?.message}`);
      }
    }));
  }
}

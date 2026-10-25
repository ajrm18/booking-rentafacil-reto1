import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { logError } from '../../../common/file-log';
import { inventoryProtoPath, PROTO_LOADER_OPTIONS } from './proto-path';
import { StockUpdateMessage } from './stock-cache.service';

export type EstadoCircuito = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

const DEADLINE_MS = 5000;          // tolerancia perimetral de 5 s del contrato
const FALLOS_PARA_ABRIR = 3;
const ENFRIAMIENTO_MS = 30_000;

/**
 * Cliente gRPC hacia el InventoryStockService del Booking central (BOOKING_GRPC_URL, ej.
 * booking.epn.edu.ec:50051). Con circuit breaker: tras 3 fallos seguidos deja de intentar 30 s.
 * Los fallos se registran en logs/error.log; el evento stock.actualizado sigue saliendo por
 * RabbitMQ (outbox), que es el canal de reintento.
 */
@Injectable()
export class StockPushClient implements OnModuleDestroy {
  private readonly logger = new Logger('StockPush');
  readonly destino = process.env.BOOKING_GRPC_URL?.trim() || '';
  private cliente: any = null;
  private fallos = 0;
  private abiertoHasta = 0;
  private ultimoError: string | null = null;

  get configurado(): boolean {
    return !!this.destino;
  }

  get circuito(): EstadoCircuito {
    if (this.fallos < FALLOS_PARA_ABRIR) return 'CLOSED';
    return Date.now() < this.abiertoHasta ? 'OPEN' : 'HALF_OPEN';
  }

  get error(): string | null {
    return this.ultimoError;
  }

  /** Envia el mensaje; resuelve false (sin lanzar) si no hay destino, el circuito esta abierto o falla. */
  async push(msg: StockUpdateMessage): Promise<boolean> {
    if (!this.configurado || this.circuito === 'OPEN') return false;
    try {
      const ack = await this.llamar(msg);
      this.fallos = 0; this.ultimoError = null;
      return !!ack?.success;
    } catch (e: any) {
      this.fallos++;
      this.ultimoError = e?.message ?? String(e);
      if (this.fallos >= FALLOS_PARA_ABRIR) this.abiertoHasta = Date.now() + ENFRIAMIENTO_MS;
      this.logger.warn(`PushStockUpdate a ${this.destino} fallo (${this.fallos}): ${this.ultimoError}`);
      await logError('grpc.PushStockUpdate', { destino: this.destino, mensaje: msg, error: this.ultimoError });
      return false;
    }
  }

  private llamar(msg: StockUpdateMessage): Promise<any> {
    if (!this.cliente) {
      const def = protoLoader.loadSync(inventoryProtoPath(), PROTO_LOADER_OPTIONS);
      const pkg: any = grpc.loadPackageDefinition(def).inventory;
      const tls = process.env.BOOKING_GRPC_TLS === 'true';
      this.cliente = new pkg.InventoryStockService(
        this.destino, tls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure(),
      );
    }
    return new Promise((resolve, reject) => {
      this.cliente.PushStockUpdate(msg, { deadline: new Date(Date.now() + DEADLINE_MS) },
        (err: Error | null, ack: any) => (err ? reject(err) : resolve(ack)));
    });
  }

  onModuleDestroy(): void {
    this.cliente?.close?.();
  }
}

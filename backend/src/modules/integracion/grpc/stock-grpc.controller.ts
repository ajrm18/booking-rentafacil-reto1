import { Controller, Logger } from '@nestjs/common';
import { GrpcMethod, GrpcStreamMethod } from '@nestjs/microservices';
import { createHash } from 'crypto';
import { Observable, Subject } from 'rxjs';
import { StockCacheService, StockChangeEvent, StockUpdateMessage } from './stock-cache.service';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const FRANJA = /^([01]\d|2[0-3]):(00|30)$/;

/**
 * Servidor gRPC de inventory.InventoryStockService (src/proto/inventory.proto), escuchando en
 * 0.0.0.0:50051 junto al HTTP (main.ts). Ingesta en RAM de los cambios de stock.
 */
@Controller()
export class StockGrpcController {
  private readonly logger = new Logger('StockGrpc');

  constructor(private readonly cache: StockCacheService) {}

  @GrpcMethod('InventoryStockService', 'PushStockUpdate')
  pushStockUpdate(msg: StockUpdateMessage): { success: boolean; message: string; processed_at: number } {
    const error = validar(msg);
    if (error) return { success: false, message: error, processed_at: Date.now() };
    this.cache.upsert({ ...msg, available_units: Math.max(0, Math.trunc(msg.available_units)) });
    return {
      success: true,
      message: `Stock de ${msg.item_id} (${msg.date} ${msg.time_slot}) = ${msg.available_units}`,
      processed_at: Date.now(),
    };
  }

  /** Client streaming (stream StockChangeEvent -> StreamSummary): sincronizacion masiva de flota. */
  @GrpcStreamMethod('InventoryStockService', 'StreamInventoryChanges')
  streamInventoryChanges(eventos: Observable<StockChangeEvent>): Observable<{
    total_events_processed: number; is_synchronized: boolean; last_sync_hash: string;
  }> {
    const resumen = new Subject<any>();
    const hash = createHash('sha256');
    let procesados = 0;
    let rechazados = 0;
    eventos.subscribe({
      next: (e) => {
        if (validar({ ...e, available_units: 0 }) || ![1, -1].includes(Math.trunc(e.delta))) { rechazados++; return; }
        this.cache.aplicarDelta(e);
        hash.update(`${e.event_id}|${e.item_id}|${e.delta};`);
        procesados++;
      },
      error: (err) => resumen.error(err),
      complete: () => {
        if (rechazados) this.logger.warn(`StreamInventoryChanges: ${rechazados} eventos invalidos descartados`);
        resumen.next({ total_events_processed: procesados, is_synchronized: rechazados === 0, last_sync_hash: hash.digest('hex') });
        resumen.complete();
      },
    });
    return resumen.asObservable();
  }
}

function validar(m: Partial<StockUpdateMessage>): string | null {
  if (!m?.service_id) return 'service_id es obligatorio';
  if (!m.item_id) return 'item_id es obligatorio';
  if (!FECHA.test(m.date ?? '')) return 'date debe tener formato YYYY-MM-DD';
  if (!FRANJA.test(m.time_slot ?? '')) return 'time_slot debe ser una franja de 30 minutos (HH:00 o HH:30)';
  return null;
}

import { Injectable } from '@nestjs/common';

/** Campos de inventory.StockUpdateMessage (src/proto/inventory.proto). */
export interface StockUpdateMessage {
  service_id: string;
  item_id: string;
  date: string;
  time_slot: string;
  available_units: number;
  timestamp: number;
}

export interface StockChangeEvent {
  event_id: string;
  service_id: string;
  item_id: string;
  date: string;
  time_slot: string;
  delta: number;
  timestamp: number;
}

interface Entrada extends StockUpdateMessage { expiresAt: number }

export const STOCK_TTL_MS = 60 * 60 * 1000;

/**
 * Inventario en memoria RAM (Map) con TTL de 1 hora por entrada: lo alimentan el servidor gRPC
 * (PushStockUpdate / StreamInventoryChanges) y los cambios de estado propios.
 */
@Injectable()
export class StockCacheService {
  private readonly entradas = new Map<string, Entrada>();
  private readonly ttlMs = STOCK_TTL_MS;

  static clave(m: Pick<StockUpdateMessage, 'service_id' | 'item_id' | 'date' | 'time_slot'>): string {
    return `${m.service_id}|${m.item_id}|${m.date}|${m.time_slot}`;
  }

  upsert(m: StockUpdateMessage, ahora = Date.now()): void {
    this.purgar(ahora);
    this.entradas.set(StockCacheService.clave(m), { ...m, expiresAt: ahora + this.ttlMs });
  }

  /** Aplica un delta (+1 / -1) de StreamInventoryChanges; nunca deja unidades negativas. */
  aplicarDelta(e: StockChangeEvent, ahora = Date.now()): number {
    const actual = this.get(e, ahora)?.available_units ?? 0;
    const unidades = Math.max(0, actual + Math.trunc(e.delta));
    this.upsert({
      service_id: e.service_id, item_id: e.item_id, date: e.date, time_slot: e.time_slot,
      available_units: unidades, timestamp: e.timestamp || ahora,
    }, ahora);
    return unidades;
  }

  get(k: Pick<StockUpdateMessage, 'service_id' | 'item_id' | 'date' | 'time_slot'>, ahora = Date.now()): StockUpdateMessage | undefined {
    const e = this.entradas.get(StockCacheService.clave(k));
    if (!e) return undefined;
    if (e.expiresAt <= ahora) { this.entradas.delete(StockCacheService.clave(k)); return undefined; }
    const { expiresAt: _x, ...m } = e;
    return m;
  }

  size(ahora = Date.now()): number {
    this.purgar(ahora);
    return this.entradas.size;
  }

  private purgar(ahora: number): void {
    for (const [k, v] of this.entradas) if (v.expiresAt <= ahora) this.entradas.delete(k);
  }
}

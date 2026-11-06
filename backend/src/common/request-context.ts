import { AsyncLocalStorage } from 'async_hooks';

/**
 * Contexto por peticion (equivalente a nest-cls) con AsyncLocalStorage nativo de Node: el
 * X-Correlation-Id queda disponible en logs, llamadas HTTP salientes y CloudEvents sin pasarlo
 * a mano por cada funcion.
 */
export interface ContextoPeticion {
  correlationId: string;
  metodo?: string;
  ruta?: string;
}

export const contexto = new AsyncLocalStorage<ContextoPeticion>();

/** Correlation id de la peticion en curso (o undefined fuera de una peticion HTTP). */
export const correlationActual = (): string | undefined => contexto.getStore()?.correlationId;

/** Ejecuta fn con un correlation id fijo (workers, reintentos del outbox). */
export const conCorrelacion = <T>(correlationId: string, fn: () => T): T => contexto.run({ correlationId }, fn);

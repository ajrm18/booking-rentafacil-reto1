import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventBusService } from '../integracion/event-bus.service';
import { StockPushClient } from '../integracion/grpc/stock-push.client';
import { grpcServidor } from '../integracion/grpc/grpc-estado';
import { NODO } from '../integracion/nodo';

/** Presupuesto para la consulta a la BD: el Booking exige respuesta en < 500 ms. */
const TIMEOUT_BD_MS = 400;

export type EstadoNodo = 'HEALTHY' | 'DEGRADED' | 'DOWN';

/**
 * GET /api/v2/autos/health (AutosHealthResponseV2) para el semaforo LED del Booking central.
 * HEALTHY: BD responde, hay vehiculos y RabbitMQ conectado (o deshabilitado a proposito).
 * DEGRADED: el core funciona pero falla una dependencia opcional (broker caido, circuito gRPC abierto, BD lenta).
 * DOWN: no se puede leer la BD o no hay vehiculos cargados.
 */
@Injectable()
export class HealthV2Service {
  private readonly inicio = Date.now();

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly bus: EventBusService,
    private readonly push: StockPushClient,
  ) {}

  async estado(): Promise<Record<string, any> & { status: EstadoNodo }> {
    const t0 = Date.now();
    let fila: { total: number; cooldown: number; pendientes: number } | null = null;
    let errorBd: string | null = null;
    try {
      const [r] = await Promise.race([
        this.ds.query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE status = 'WASHING' AND wash_until > NOW())::int AS cooldown,
                  (SELECT COUNT(*)::int FROM outbox_events WHERE publish_status = 'PENDING') AS pendientes
             FROM vehicles`,
        ),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`BD sin respuesta en ${TIMEOUT_BD_MS} ms`)), TIMEOUT_BD_MS).unref()),
      ]);
      fila = { total: Number(r.total), cooldown: Number(r.cooldown), pendientes: Number(r.pendientes) };
    } catch (e: any) {
      errorBd = e?.message ?? 'error';
    }
    const latencia = Date.now() - t0;
    void this.bus.asegurarConexion();

    const rabbit = this.bus.estado;
    const circuito = this.push.circuito;
    let status: EstadoNodo = 'HEALTHY';
    if (!fila || fila.total === 0) status = 'DOWN';
    else if (rabbit === 'DISCONNECTED' || circuito === 'OPEN') status = 'DEGRADED';

    return {
      status,
      nodo_id: NODO.id,
      nombre_proveedor: NODO.nombre,
      vertical: NODO.vertical,
      version: NODO.version,
      uptime_seconds: Math.floor((Date.now() - this.inicio) / 1000),
      latencia_ms: latencia,
      circuit_breaker_estado: circuito,
      cooldown_activo_count: fila?.cooldown ?? 0,
      total_vehiculos: fila?.total ?? 0,
      timestamp: new Date().toISOString(),
      // Extensiones informativas (el schema del contrato no prohibe propiedades adicionales)
      dependencias: {
        base_datos: fila ? 'UP' : 'DOWN',
        rabbitmq: rabbit === 'DISABLED' ? 'DISABLED' : rabbit === 'CONNECTED' ? 'UP' : 'DOWN',
        grpc_servidor: grpcServidor.escuchando ? `UP ${grpcServidor.escuchando}` : grpcServidor.error ? 'DOWN' : 'DISABLED',
        grpc_push_booking: this.push.configurado ? circuito : 'NOT_CONFIGURED',
      },
      event_bus_modo: rabbit === 'DISABLED' ? 'DEGRADED_LOG_ONLY (sin RABBITMQ_URL: los eventos quedan en el outbox y en el log)' : 'RABBITMQ',
      outbox_pendientes: fila?.pendientes ?? null,
      ...(errorBd && { error: errorBd }),
    };
  }
}

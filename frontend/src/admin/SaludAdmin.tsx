import { useEffect, useState } from 'react';
import { telemetriaV2 } from '../api/clientV2';
import type { AutosHealthResponseV2, CloudEventFeed } from '../types/v2';
import { fechaHoraLocal } from '../utils/v2';

const REFRESCO_MS = 5000;

const LED: Record<string, { color: string; texto: string }> = {
  HEALTHY: { color: '#16a34a', texto: 'Verde — nodo saludable' },
  DEGRADED: { color: '#d97706', texto: 'Ámbar — dependencia opcional caída' },
  DOWN: { color: '#dc2626', texto: 'Rojo — nodo caído' },
};

const PUBLICACION: Record<string, string> = {
  PUBLISHED: 'badge-success', LOGGED: 'badge-muted', PENDING: 'badge-warning', FAILED: 'badge-danger',
};

/**
 * Panel 1 — Semáforo LED con GET /api/v2/autos/health (lo mismo que consulta el Booking central)
 * y el feed Outbox de GET /api/v2/autos/eventos.
 */
export default function SaludAdmin() {
  const [salud, setSalud] = useState<AutosHealthResponseV2 | null>(null);
  const [latenciaCliente, setLatenciaCliente] = useState<number | null>(null);
  const [eventos, setEventos] = useState<CloudEventFeed[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  const cargar = async () => {
    const t0 = performance.now();
    try {
      const h = await telemetriaV2.health();
      setLatenciaCliente(Math.round(performance.now() - t0));
      setSalud(h);
      setError('');
    } catch (e: any) {
      setSalud(null);
      setError(e?.message || 'El nodo no responde');
    }
    telemetriaV2.eventos(25).then((r) => { setEventos([...r.events].reverse()); setTotal(r.metadata.total); }).catch(() => {});
  };

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, REFRESCO_MS);
    return () => clearInterval(t);
  }, []);

  const led = LED[salud?.status ?? 'DOWN'];

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Salud del nodo</h1>
      <div className="card mb-3">
        <div className="card-body" style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div role="img" aria-label={`Semáforo: ${led.texto}`} style={{
            width: 76, height: 76, borderRadius: '50%', background: led.color, flex: '0 0 auto',
            boxShadow: `0 0 0 6px ${led.color}33, 0 0 28px ${led.color}`,
          }} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{salud?.status ?? 'SIN RESPUESTA'}</div>
            <div className="text-muted">{led.texto}</div>
            {error && <div className="alert alert-danger mt-1">{error}</div>}
            {salud && (
              <div className="mt-1" style={{ display: 'grid', gap: '0.15rem 1.5rem', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', fontSize: '0.88rem' }}>
                <div><b>Nodo:</b> <code>{salud.nodo_id}</code></div>
                <div><b>Proveedor:</b> {salud.nombre_proveedor}</div>
                <div><b>Vertical / versión:</b> {salud.vertical} · {salud.version}</div>
                <div><b>Latencia BD:</b> {salud.latencia_ms} ms · ida y vuelta {latenciaCliente ?? '—'} ms</div>
                <div><b>Uptime:</b> {Math.floor(salud.uptime_seconds / 3600)} h {Math.floor((salud.uptime_seconds % 3600) / 60)} min</div>
                <div><b>Vehículos:</b> {salud.total_vehiculos} · <b>en cooldown:</b> {salud.cooldown_activo_count}</div>
                <div><b>Circuit breaker:</b> {salud.circuit_breaker_estado}</div>
                {salud.outbox_pendientes != null && <div><b>Outbox pendientes:</b> {salud.outbox_pendientes}</div>}
              </div>
            )}
          </div>
        </div>
        {salud?.dependencias && (
          <div className="card-body" style={{ borderTop: '1px solid var(--border)', fontSize: '0.85rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            {Object.entries(salud.dependencias).map(([k, v]) => (
              <span key={k}><b>{k.replace(/_/g, ' ')}:</b> <code>{v}</code></span>
            ))}
            {salud.event_bus_modo && <span className="text-muted">{salud.event_bus_modo}</span>}
          </div>
        )}
      </div>

      <div className="flex-between mb-1">
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Feed Outbox (CloudEvents v1.0 → booking.events)</h2>
        <span className="text-muted" style={{ fontSize: '0.8rem' }}>{total} eventos en total</span>
      </div>
      <div className="table-wrapper">
        <table className="table">
          <thead><tr><th>Hora</th><th>Routing key</th><th>Recurso</th><th>Datos</th><th>Publicación</th></tr></thead>
          <tbody>
            {eventos.length === 0 && <tr><td colSpan={5} className="text-muted">Sin eventos todavía.</td></tr>}
            {eventos.map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{fechaHoraLocal(e.time)}</td>
                <td><code style={{ fontSize: '0.8rem' }}>{e.routing_key}</code></td>
                <td style={{ fontSize: '0.8rem' }}><code>{e.subject ?? '—'}</code></td>
                <td style={{ fontSize: '0.75rem', maxWidth: 320 }}>
                  <code style={{ wordBreak: 'break-all' }}>{JSON.stringify(Object.fromEntries(Object.entries(e.data).filter(([k]) => k !== 'nodo_id')))}</code>
                </td>
                <td><span className={`badge ${PUBLICACION[e.publish_status] ?? ''}`} title={e.published_at ? fechaHoraLocal(e.published_at) : undefined}>{e.publish_status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted" style={{ fontSize: '0.8rem' }}>
        LOGGED = sin RABBITMQ_URL el bus está en modo degradado y el evento queda en el outbox y en el log del servidor.
      </p>
    </div>
  );
}

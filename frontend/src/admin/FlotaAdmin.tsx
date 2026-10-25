import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { flotaV2 } from '../api/clientV2';
import type { AutoFlotaItemV2, EstadoVehiculo } from '../types/v2';
import { cronometro, FASE_VEHICULO, km } from '../utils/v2';
import Modal from '../components/Modal';

const REFRESCO_MS = 5000;
const COOLDOWN_S = 2 * 60 * 60;

/**
 * Panel 2 — Flota (GET /api/v2/autos/flota): las 6 fases y el cronómetro del cooldown de 2 h.
 * Se recarga cada 5 s; entre recargas el contador baja cada segundo en el navegador.
 */
export default function FlotaAdmin() {
  const [flota, setFlota] = useState<AutoFlotaItemV2[]>([]);
  const [recibido, setRecibido] = useState(Date.now());
  const [ahora, setAhora] = useState(Date.now());
  const [error, setError] = useState('');
  const [devolver, setDevolver] = useState<AutoFlotaItemV2 | null>(null);
  const [aviso, setAviso] = useState('');

  const cargar = () => flotaV2.flota()
    .then((f) => { setFlota(f); setRecibido(Date.now()); setError(''); })
    .catch((e) => setError(e?.message || 'No se pudo cargar la flota'));

  useEffect(() => {
    cargar();
    const poll = setInterval(cargar, REFRESCO_MS);
    const tick = setInterval(() => setAhora(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, []);

  const transcurrido = Math.floor((ahora - recibido) / 1000);
  const conteo = Object.keys(FASE_VEHICULO).map((f) => [f, flota.filter((v) => v.estado_operativo === f).length] as const);

  return (
    <div>
      <div className="flex-between mb-2" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ margin: 0 }}>Flota en vivo</h1>
        <span className="text-muted" style={{ fontSize: '0.8rem' }} aria-live="polite">Actualiza cada 5 s · cooldown de limpieza: 2 h</span>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      {aviso && <div className="alert alert-success" role="status">{aviso}</div>}

      <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', marginBottom: '1rem' }}>
        {conteo.map(([fase, n]) => (
          <div key={fase} className="card"><div className="card-body" style={{ padding: '0.7rem 0.9rem' }}>
            <div className="text-muted" style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{FASE_VEHICULO[fase as EstadoVehiculo].label}</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{n}</div>
          </div></div>
        ))}
      </div>

      <div className="table-wrapper">
        <table className="table">
          <thead><tr>
            <th>Vehículo</th><th>Estado</th><th>Cooldown</th><th>Odómetro</th><th>Mantenimiento</th><th></th>
          </tr></thead>
          <tbody>
            {flota.map((v) => {
              const fase = FASE_VEHICULO[v.estado_operativo];
              const restante = v.cooldown_activo ? Math.max(0, v.segundos_restantes_cooldown - transcurrido) : 0;
              return (
                <tr key={v.id}>
                  <td>
                    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                      {v.foto_url && <img src={v.foto_url} alt="" width={56} height={38} style={{ objectFit: 'cover', borderRadius: 6 }} />}
                      <div>
                        <b>{v.marca} {v.modelo}</b>
                        <div className="text-muted" style={{ fontSize: '0.75rem' }}><code>{v.id}</code> · {v.placa}</div>
                      </div>
                    </div>
                  </td>
                  <td><span className={`badge ${fase.badge}`}>{fase.label}</span></td>
                  <td style={{ minWidth: 150 }}>
                    {v.cooldown_activo ? (
                      <>
                        <div style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }} aria-label={`Faltan ${cronometro(restante)}`}>{cronometro(restante)}</div>
                        <div role="progressbar" aria-valuemin={0} aria-valuemax={COOLDOWN_S} aria-valuenow={COOLDOWN_S - restante}
                          style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', marginTop: 4 }}>
                          <div style={{ width: `${((COOLDOWN_S - restante) / COOLDOWN_S) * 100}%`, height: '100%', background: 'var(--brand)' }} />
                        </div>
                        <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                          Disponible {v.disponible_estimado_at ? new Date(v.disponible_estimado_at).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) : ''}
                        </div>
                      </>
                    ) : <span className="text-muted">—</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{km(v.kilometraje_actual)}</td>
                  <td style={{ fontSize: '0.85rem' }}>
                    {v.alerta_mantenimiento || v.mantenimiento_requerido
                      ? <span className="badge badge-danger">Requerido</span>
                      : <span className="text-muted">Próximo: {km(v.umbral_mantenimiento_km)}</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {(v.estado_operativo === 'DISPONIBLE' || v.estado_operativo === 'ENTREGADO') && (
                      <button className="btn btn-outline btn-sm" onClick={() => setDevolver(v)}>Devolución directa</button>
                    )}{' '}
                    {(v.alerta_mantenimiento || v.estado_operativo === 'EN_MANTENIMIENTO') && (
                      <Link className="btn btn-outline btn-sm" to={`/admin/mantenimiento?id=${v.id}`}>Mantenimiento</Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {devolver && (
        <DevolucionDirecta vehiculo={devolver} onClose={() => setDevolver(null)}
          onListo={(r) => { setDevolver(null); setAviso(`${r.vehiculo} en limpieza hasta ${new Date(r.disponible_desde).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })}.`); cargar(); }} />
      )}
    </div>
  );
}

function DevolucionDirecta({ vehiculo, onClose, onListo }: { vehiculo: AutoFlotaItemV2; onClose: () => void; onListo: (r: any) => void }) {
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState('');
  const confirmar = async () => {
    setGuardando(true); setErr('');
    try { onListo(await flotaV2.devolucion(vehiculo.id)); }
    catch (e: any) { setErr(e?.message || 'No se pudo registrar la devolución'); }
    finally { setGuardando(false); }
  };
  return (
    <Modal titulo="Devolución directa" onClose={onClose} bloqueado={guardando}>
      <p>El <b>{vehiculo.marca} {vehiculo.modelo}</b> pasa a <b>limpieza durante 2 horas</b> y queda fuera de las búsquedas.</p>
      {vehiculo.estado_operativo === 'ENTREGADO' && (
        <p className="text-muted" style={{ fontSize: '0.88rem' }}>
          Se cierra la orden en curso sin odómetro. Para registrar kilómetros y combustible usa el <Link to="/admin/mostrador">mostrador</Link>.
        </p>
      )}
      {err && <div className="alert alert-danger">{err}</div>}
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <button className="btn btn-outline" onClick={onClose} disabled={guardando}>Volver</button>
        <button className="btn btn-success" onClick={confirmar} disabled={guardando}>{guardando ? 'Registrando…' : 'Iniciar limpieza'}</button>
      </div>
    </Modal>
  );
}

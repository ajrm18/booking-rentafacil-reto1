import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { flotaV2, ordenesV2 } from '../api/clientV2';
import type { AutoOrderResponseV2 } from '../types/v2';
import { useAuth } from '../context/AuthContext';
import FasesCheckin from '../components/FasesCheckin';
import FechaError from '../components/FechaError';
import { estadoOrdenV2, fechaHoraLocal, km } from '../utils/v2';

/**
 * Mostrador y patio: check-in de entrega (licencia física + km_salida -> ENTREGADO) y check-in de
 * devolución (km_retorno + combustible -> EN_LIMPIEZA 2 h). Reemplaza al "Registrar retorno" del Reto 1.
 */
export default function MostradorAdmin() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [ordenes, setOrdenes] = useState<AutoOrderResponseV2[]>([]);
  const [odometros, setOdometros] = useState<Record<string, number>>({});
  const [busqueda, setBusqueda] = useState(params.get('pnr') || '');
  const [seleccion, setSeleccion] = useState<string>(params.get('pnr') || '');
  const [resultado, setResultado] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  const cargar = () => {
    ordenesV2.listar().then(setOrdenes).catch(() => {});
    flotaV2.flota().then((f) => setOdometros(Object.fromEntries(f.map((v) => [v.id, v.kilometraje_actual])))).catch(() => {});
  };
  useEffect(() => { cargar(); }, []);

  const activas = useMemo(() => ordenes.filter((o) => ['CONFIRMED', 'CHECKIN_COMPLETED', 'ENTREGADO'].includes(o.status)), [ordenes]);
  const filtradas = activas.filter((o) => {
    const q = busqueda.trim().toLowerCase();
    return !q || o.pnr.toLowerCase().includes(q) || `${o.vehiculo.marca} ${o.vehiculo.modelo}`.toLowerCase().includes(q)
      || String(o.conductor?.nombre ?? '').toLowerCase().includes(q);
  });
  const orden = ordenes.find((o) => o.pnr.toUpperCase() === seleccion.toUpperCase()) ?? null;

  const listo = (texto: string) => { setResultado({ tipo: 'ok', texto }); cargar(); };
  const fallo = (texto: string) => setResultado({ tipo: 'error', texto });

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Mostrador y patio</h1>
      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'minmax(240px, 1fr) minmax(280px, 1.3fr)' }} className="mostrador-grid">
        <div className="card">
          <div className="card-body">
            <label className="form-label" htmlFor="mos-buscar">Buscar reserva activa (PNR, vehículo o conductor)</label>
            <input id="mos-buscar" className="form-control" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="RF7K2M4Q" />
            <ul style={{ listStyle: 'none', padding: 0, margin: '0.75rem 0 0', display: 'grid', gap: '0.4rem', maxHeight: 460, overflowY: 'auto' }}>
              {filtradas.length === 0 && <li className="text-muted" style={{ fontSize: '0.88rem' }}>No hay reservas activas que coincidan.</li>}
              {filtradas.map((o) => (
                <li key={o.order_id}>
                  <button type="button" onClick={() => { setSeleccion(o.pnr); setResultado(null); }}
                    aria-pressed={seleccion === o.pnr}
                    className="btn btn-outline btn-block" style={{ textAlign: 'left', justifyContent: 'space-between', display: 'flex', borderColor: seleccion === o.pnr ? 'var(--brand)' : undefined }}>
                    <span><code>{o.pnr}</code> · {o.vehiculo.marca} {o.vehiculo.modelo}<br />
                      <span className="text-muted" style={{ fontSize: '0.75rem' }}>{o.conductor?.nombre ?? o.propietario} · {fechaHoraLocal(o.recogida.fecha_hora)}</span>
                    </span>
                    <span className={`badge ${estadoOrdenV2(o).badge}`}>{estadoOrdenV2(o).label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            {resultado && <div className={`alert ${resultado.tipo === 'ok' ? 'alert-success' : 'alert-danger'}`} role="status">{resultado.texto}</div>}
            {!orden ? (
              <div className="text-muted">Selecciona una reserva para registrar la entrega o la devolución.</div>
            ) : (
              <>
                <div className="flex-between">
                  <div>
                    <b>{orden.vehiculo.marca} {orden.vehiculo.modelo}</b> · <code>{orden.auto_id}</code>
                    <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                      PNR <code>{orden.pnr}</code> · conductor {orden.conductor?.nombre ?? '—'} · licencia {orden.checkins.digital.licencia_verificada ?? orden.conductor?.licencia_conducir ?? '—'}
                    </div>
                  </div>
                  <span className={`badge ${estadoOrdenV2(orden).badge}`}>{estadoOrdenV2(orden).label}</span>
                </div>
                <FasesCheckin orden={orden} />
                <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '1rem 0' }} />
                {orden.status === 'COMPLETADA' || orden.status === 'CANCELLED'
                  ? <div className="text-muted">Orden {estadoOrdenV2(orden).label.toLowerCase()}: no hay más check-in pendientes.</div>
                  : orden.status === 'ENTREGADO'
                  ? <FormDevolucion orden={orden} onOk={listo} onError={fallo} />
                  : <FormEntrega orden={orden} kmActual={odometros[orden.auto_id] ?? 0} tecnico={user?.first_name ? `${user.first_name} ${user.last_name ?? ''}`.trim() : user?.email ?? ''} onOk={listo} onError={fallo} />}
              </>
            )}
          </div>
        </div>
      </div>
      <style>{`@media (max-width: 860px) { .mostrador-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

interface FormProps { orden: AutoOrderResponseV2; onOk: (t: string) => void; onError: (t: string) => void }

function FormEntrega({ orden, kmActual, tecnico, onOk, onError }: FormProps & { kmActual: number; tecnico: string }) {
  const [licencia, setLicencia] = useState('');
  const [kmSalida, setKmSalida] = useState(String(kmActual || ''));
  const [agente, setAgente] = useState(tecnico);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { setKmSalida(String(kmActual || '')); setLicencia(''); }, [orden.order_id, kmActual]);

  const kmN = Number(kmSalida);
  const errKm = !kmSalida ? 'Lectura del odómetro obligatoria' : !Number.isInteger(kmN) ? 'Solo números enteros'
    : kmN < kmActual ? `No puede ser menor que el odómetro registrado (${km(kmActual)})` : undefined;
  const errLic = licencia.length < 5 ? 'Ingresa la licencia física presentada' : undefined;

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (errKm || errLic) return;
    setGuardando(true);
    try {
      const r = await ordenesV2.checkinEntrega(orden.pnr, { licencia_conducir: licencia, km_salida: kmN, tecnico_entrega: agente || undefined });
      onOk(`Llaves entregadas (${r.pnr}). Odómetro de salida ${km(r.km_salida)}. Vehículo ENTREGADO.`);
    } catch (ex: any) { onError(ex?.message || 'No se pudo registrar la entrega'); }
    finally { setGuardando(false); }
  };

  return (
    <form onSubmit={enviar} noValidate>
      <h3 style={{ marginTop: 0 }}>Check-in de entrega</h3>
      <div className="form-group">
        <label className="form-label" htmlFor="ent-lic">Licencia física presentada *</label>
        <input id="ent-lic" className="form-control" maxLength={20} value={licencia} onChange={(e) => setLicencia(e.target.value.replace(/[^A-Za-z0-9-]/g, ''))}
          aria-invalid={!!errLic && !!licencia} aria-describedby="ent-lic-err" />
        <FechaError id="ent-lic-err" mensaje={licencia ? errLic : undefined} />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="ent-km">Odómetro de salida (km) *</label>
        <input id="ent-km" className="form-control" inputMode="numeric" value={kmSalida} onChange={(e) => setKmSalida(e.target.value.replace(/\D/g, ''))}
          aria-invalid={!!errKm} aria-describedby="ent-km-err" />
        <FechaError id="ent-km-err" mensaje={errKm} />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="ent-agente">Agente que entrega</label>
        <input id="ent-agente" className="form-control" maxLength={120} value={agente} onChange={(e) => setAgente(e.target.value)} />
      </div>
      <button className="btn btn-primary btn-block" type="submit" disabled={guardando || !!errKm || !!errLic}>
        {guardando ? 'Registrando…' : 'Entregar llaves'}
      </button>
    </form>
  );
}

function FormDevolucion({ orden, onOk, onError }: FormProps) {
  const salida = orden.checkins.entrega.km_salida ?? 0;
  const [kmRetorno, setKmRetorno] = useState('');
  const [combustible, setCombustible] = useState(100);
  const [obs, setObs] = useState('');
  const [guardando, setGuardando] = useState(false);

  const kmN = Number(kmRetorno);
  const errKm = !kmRetorno ? 'Lectura del odómetro obligatoria' : kmN < salida ? `Debe ser mayor o igual que el km de salida (${km(salida)})` : undefined;

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (errKm) return;
    setGuardando(true);
    try {
      const r = await ordenesV2.checkinDevolucion(orden.pnr, { km_retorno: kmN, nivel_combustible: combustible, observaciones: obs.trim() || undefined });
      const hasta = new Date(r.cooldown.disponible_desde).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
      onOk(`Devolución registrada: ${km(r.km_recorridos)} recorridos. Vehículo EN LIMPIEZA hasta las ${hasta} (2 h). ${r.alerta_mantenimiento}`);
    } catch (ex: any) { onError(ex?.message || 'No se pudo registrar la devolución'); }
    finally { setGuardando(false); }
  };

  return (
    <form onSubmit={enviar} noValidate>
      <h3 style={{ marginTop: 0 }}>Check-in de devolución</h3>
      <div className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>Odómetro de salida: <b>{km(salida)}</b></div>
      <div className="form-group">
        <label className="form-label" htmlFor="dev-km">Odómetro de retorno (km) *</label>
        <input id="dev-km" className="form-control" inputMode="numeric" value={kmRetorno} onChange={(e) => setKmRetorno(e.target.value.replace(/\D/g, ''))}
          aria-invalid={!!errKm && !!kmRetorno} aria-describedby="dev-km-err" />
        <FechaError id="dev-km-err" mensaje={kmRetorno ? errKm : undefined} />
        {kmRetorno && !errKm && <div className="text-muted" style={{ fontSize: '0.8rem' }}>Recorrido: {km(kmN - salida)}</div>}
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="dev-comb">Nivel de combustible: {combustible} %</label>
        <input id="dev-comb" type="range" min={0} max={100} step={5} value={combustible} onChange={(e) => setCombustible(Number(e.target.value))} style={{ width: '100%' }} />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="dev-obs">Observaciones de la inspección</label>
        <textarea id="dev-obs" className="form-control" rows={2} maxLength={1000} value={obs} onChange={(e) => setObs(e.target.value)} />
      </div>
      <button className="btn btn-success btn-block" type="submit" disabled={guardando || !!errKm}>
        {guardando ? 'Registrando…' : 'Recibir vehículo e iniciar limpieza (2 h)'}
      </button>
    </form>
  );
}

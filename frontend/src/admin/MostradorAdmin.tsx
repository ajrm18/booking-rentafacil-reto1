import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ordenesV2 } from '../api/clientV2';
import { detectarTipo, EstadoMostrador, mostradorV3, ResultadoBusqueda, TarjetaReserva, TipoBusqueda } from '../api/clientV3';
import Modal from '../components/Modal';
import FechaError from '../components/FechaError';
import { fechaHoraLocal, km } from '../utils/v2';

/** Badge por estado: amarillo pendiente, verde entregado, azul limpieza, rojo cancelada. */
const ESTADO: Record<EstadoMostrador, { label: string; clase: string }> = {
  RESERVADO: { label: 'Reservado · pendiente de entrega', clase: 'mos-badge-amarillo' },
  PENDIENTE_ENTREGA: { label: 'Check-in digital · pendiente de entrega', clase: 'mos-badge-amarillo' },
  CONFIRMADO_ASISTIDO: { label: 'Entregado · confirmado asistido', clase: 'mos-badge-verde' },
  EN_LIMPIEZA: { label: 'En limpieza (2 h)', clase: 'mos-badge-azul' },
  COMPLETADA: { label: 'Completada', clase: 'mos-badge-gris' },
  VENCIDA: { label: 'Vencida', clase: 'mos-badge-gris' },
  CANCELLED: { label: 'Cancelada', clase: 'mos-badge-rojo' },
};

const TIPO_LABEL: Record<TipoBusqueda, string> = { EMAIL: 'Email del cliente', IDENTIFICACION: 'Cédula / identificación', PNR: 'Código de reserva (PNR)' };

const Lupa = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
  </svg>
);
const Llave = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14 9l2 2" />
  </svg>
);

/**
 * Mostrador (evaluacion v3.1): buscador unificado (PNR, cedula o email) con autocompletado y
 * el boton "Confirmar Entrega de Llaves / Check-in", que llama a
 * POST /api/v3/autos/orders/{id}/checkin-entrega y notifica al Booking central.
 */
export default function MostradorAdmin() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || params.get('pnr') || '');
  const [res, setRes] = useState<ResultadoBusqueda | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [pendientes, setPendientes] = useState<{ pnr: string; texto: string }[]>([]);
  const [entrega, setEntrega] = useState<TarjetaReserva | null>(null);
  const [devolucion, setDevolucion] = useState<TarjetaReserva | null>(null);
  const [toast, setToast] = useState<{ tipo: 'ok' | 'error'; titulo: string; texto?: string } | null>(null);
  const control = useRef<AbortController | null>(null);
  const ultimo = useRef('');

  const buscar = useCallback(async (texto: string) => {
    const t = texto.trim();
    ultimo.current = t;
    if (t.length < 2) { setRes(null); setError(''); return; }
    control.current?.abort();
    const c = new AbortController();
    control.current = c;
    setCargando(true); setError('');
    try {
      const r = await mostradorV3.buscar(t, c.signal);
      if (ultimo.current === t) setRes(r);
    } catch (e: any) {
      if (e?.name !== 'CanceledError') setError(e?.message || 'No se pudo buscar');
    } finally {
      if (ultimo.current === t) setCargando(false);
    }
  }, []);

  // Autocompletado con debounce de 300 ms
  useEffect(() => {
    const id = setTimeout(() => { void buscar(q); }, 300);
    return () => clearTimeout(id);
  }, [q, buscar]);

  // Accesos rapidos: reservas confirmadas pendientes de entrega
  const cargarPendientes = () => ordenesV2.listar().then((l) => setPendientes(
    l.filter((o) => o.status === 'CONFIRMED' || o.status === 'CHECKIN_COMPLETED').slice(0, 8)
      .map((o) => ({ pnr: o.pnr, texto: `${o.vehiculo.marca} ${o.vehiculo.modelo}` })),
  )).catch(() => {});
  useEffect(() => { cargarPendientes(); }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(id);
  }, [toast]);

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    setParams(q.trim() ? { q: q.trim() } : {}, { replace: true });
    void buscar(q);
  };

  const refrescar = () => { void buscar(ultimo.current || q); cargarPendientes(); };
  const tipo = q.trim() ? detectarTipo(q) : null;

  return (
    <div className="mostrador">
      <div className="mos-hero">
        <div>
          <div className="eyebrow">Mostrador · Check-in físico</div>
          <h1 style={{ margin: '0.15rem 0 0.25rem' }}>Entrega de llaves</h1>
          <p className="text-muted" style={{ margin: 0 }}>
            Busca la reserva del cliente que llegó al mostrador, verifica su licencia y confirma la entrega. Booking Central es notificado automáticamente.
          </p>
        </div>
      </div>

      <form className="card mos-buscador" onSubmit={enviar} role="search">
        <div className="card-body">
          <label className="form-label" htmlFor="mos-q" style={{ fontSize: '1rem' }}>Código de reserva (PNR), cédula o email del cliente</label>
          <div className="mos-barra">
            <span className="mos-lupa"><Lupa /></span>
            <input id="mos-q" className="form-control mos-input" value={q} autoFocus autoComplete="off"
              onChange={(e) => setQ(e.target.value)} placeholder="Ej. RF7K2M4Q · 1710034065 · juan@example.com"
              aria-describedby="mos-tipo" />
            <button className="btn btn-dark mos-btn-buscar" type="submit"><Lupa /> Buscar</button>
          </div>
          <div id="mos-tipo" className="mos-ayuda">
            {tipo ? <>Buscando por <b>{TIPO_LABEL[tipo]}</b>{cargando && ' …'}</> : 'Se detecta solo: con @ es email, 10 dígitos es cédula, lo demás es PNR.'}
          </div>
          {!q.trim() && pendientes.length > 0 && (
            <div className="mos-chips">
              <span className="text-muted" style={{ fontSize: '0.85rem' }}>Pendientes de entrega:</span>
              {pendientes.map((p) => (
                <button key={p.pnr} type="button" className="mos-chip" onClick={() => setQ(p.pnr)} title={p.texto}><code>{p.pnr}</code></button>
              ))}
            </div>
          )}
        </div>
      </form>

      {error && <div className="alert alert-danger" role="alert">{error}</div>}

      {res && (
        <div className="mos-resumen" aria-live="polite">
          {res.total === 0
            ? <>No se encontraron reservas para <b>{res.q}</b> ({TIPO_LABEL[res.tipo_detectado]}).</>
            : <>{res.total} reserva{res.total === 1 ? '' : 's'} para <b>{res.q}</b> · {TIPO_LABEL[res.tipo_detectado]}</>}
        </div>
      )}

      <div className="mos-grid">
        {res?.resultados.map((r) => (
          <TarjetaMostrador key={r.order_id} r={r} onEntregar={() => setEntrega(r)} onDevolver={() => setDevolucion(r)} />
        ))}
      </div>

      {entrega && (
        <ModalEntrega r={entrega} onClose={() => setEntrega(null)}
          onOk={(d) => {
            setEntrega(null);
            setToast({ tipo: 'ok', titulo: 'Entrega confirmada. Vehículo entregado al cliente.',
              texto: `${d.pnr} · km salida ${km(d.km_salida)} · ${d.notificacion_booking?.status === 'NOT_CONFIGURED' ? 'Booking no configurado' : 'Notificando a Booking Central…'}` });
            refrescar();
            setTimeout(refrescar, 2500); // muestra el acuse del Booking
          }} />
      )}
      {devolucion && (
        <ModalDevolucion r={devolucion} onClose={() => setDevolucion(null)}
          onOk={(t) => { setDevolucion(null); setToast({ tipo: 'ok', titulo: 'Devolución registrada', texto: t }); refrescar(); }} />
      )}

      {toast && (
        <div className={`mos-toast ${toast.tipo === 'ok' ? 'mos-toast-ok' : 'mos-toast-error'}`} role="status" aria-live="assertive">
          <div style={{ fontWeight: 700 }}>{toast.tipo === 'ok' ? '✓ ' : ''}{toast.titulo}</div>
          {toast.texto && <div style={{ fontSize: '0.88rem', opacity: 0.9 }}>{toast.texto}</div>}
          <button type="button" className="mos-toast-x" onClick={() => setToast(null)} aria-label="Cerrar">×</button>
        </div>
      )}

      <style>{CSS}</style>
    </div>
  );
}

function TarjetaMostrador({ r, onEntregar, onDevolver }: { r: TarjetaReserva; onEntregar: () => void; onDevolver: () => void }) {
  const e = ESTADO[r.estado_mostrador] ?? ESTADO.RESERVADO;
  const n = r.notificacion_booking;
  return (
    <article className="card mos-card" aria-label={`Reserva ${r.pnr}`}>
      <div className="card-body">
        <div className="mos-card-top">
          <div>
            <div className="mos-label">Código de reserva</div>
            <div className="mos-pnr">{r.pnr}</div>
          </div>
          <span className={`mos-badge ${e.clase}`}>{e.label}</span>
        </div>

        <div className="mos-vehiculo">
          {r.vehiculo.foto_url
            ? <img src={r.vehiculo.foto_url} alt="" loading="lazy" />
            : <div className="mos-foto-vacia" aria-hidden="true">🚗</div>}
          <div>
            <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{r.vehiculo.marca} {r.vehiculo.modelo} {r.vehiculo.anio ?? ''}</div>
            <div className="text-muted" style={{ fontSize: '0.88rem' }}>
              Placa <b className="mos-placa">{r.vehiculo.placa ?? '—'}</b> · {r.vehiculo.vehicle_id}
            </div>
          </div>
        </div>

        <dl className="mos-datos">
          <div><dt>Cliente</dt><dd>{r.cliente.nombre ?? '—'}</dd></div>
          <div><dt>Cédula / ID</dt><dd>{r.cliente.identificacion ?? '—'}</dd></div>
          <div><dt>Email</dt><dd className="mos-wrap">{r.cliente.email ?? '—'}</dd></div>
          <div><dt>Teléfono</dt><dd>{r.cliente.telefono ?? '—'}</dd></div>
          <div><dt>Retiro</dt><dd>{fechaHoraLocal(r.recogida.fecha_hora)}{r.recogida.lugar ? <span className="text-muted"> · {r.recogida.lugar}</span> : null}</dd></div>
          <div><dt>Devolución</dt><dd>{fechaHoraLocal(r.devolucion.fecha_hora)}</dd></div>
        </dl>

        {r.checkin_entrega && (
          <div className="mos-entregado">
            Entregado {fechaHoraLocal(r.checkin_entrega.at)} · km salida <b>{km(r.checkin_entrega.km_salida)}</b> · por {r.checkin_entrega.admin_id}
            <div style={{ marginTop: 4 }}>
              Booking Central:{' '}
              {!n ? <span className="text-muted">sin notificación</span>
                : n.status === 'SENT' ? <b style={{ color: 'var(--success)' }}>notificado ✓ (HTTP {n.last_status_code})</b>
                  : n.status === 'FAILED' ? <b style={{ color: 'var(--danger)' }}>falló tras {n.attempts} intentos</b>
                    : <b style={{ color: 'var(--warning)' }}>pendiente · reintentando ({n.attempts} intento{n.attempts === 1 ? '' : 's'}{n.last_status_code ? `, último HTTP ${n.last_status_code}` : ''})</b>}
            </div>
          </div>
        )}

        {r.puede_entregar && (
          <button type="button" className="mos-btn-entregar" onClick={onEntregar}>
            <Llave /> Confirmar Entrega de Llaves / Check-in
          </button>
        )}
        {r.puede_devolver && (
          <button type="button" className="btn btn-outline btn-block" style={{ marginTop: '0.75rem' }} onClick={onDevolver}>
            Registrar devolución del vehículo
          </button>
        )}
      </div>
    </article>
  );
}

function ModalEntrega({ r, onClose, onOk }: { r: TarjetaReserva; onClose: () => void; onOk: (d: any) => void }) {
  const [licencia, setLicencia] = useState('');
  const [kmSalida, setKmSalida] = useState(r.vehiculo.kilometraje_actual != null ? String(r.vehiculo.kilometraje_actual) : '');
  const [acepta, setAcepta] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState('');
  const kmN = Number(kmSalida);
  const kmActual = r.vehiculo.kilometraje_actual ?? 0;
  const errKm = kmSalida === '' ? 'Ingresa el odómetro inicial' : !Number.isInteger(kmN) || kmN < 0 ? 'Número entero de kilómetros' : kmN < kmActual ? `No puede ser menor que el registrado (${km(kmActual)})` : undefined;
  const errLic = licencia.trim().length < 5 ? 'Ingresa el número de la licencia física presentada' : undefined;
  const valido = !errKm && !errLic && acepta;

  const confirmar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valido) return;
    setGuardando(true); setErr('');
    try {
      onOk(await mostradorV3.checkinEntrega(r.pnr, { licencia_conducir: licencia.trim(), km_salida: kmN, acepta_contrato: true }));
    } catch (ex: any) {
      setErr(ex?.message || 'No se pudo confirmar la entrega');
    } finally { setGuardando(false); }
  };

  return (
    <Modal titulo={`Confirmar entrega · ${r.pnr}`} onClose={onClose} bloqueado={guardando} ancho={560}>
      <form onSubmit={confirmar} noValidate>
        <div className="mos-modal-resumen">
          <b>{r.vehiculo.marca} {r.vehiculo.modelo}</b> · placa {r.vehiculo.placa ?? '—'}<br />
          <span className="text-muted">{r.cliente.nombre} · {r.cliente.identificacion}</span><br />
          <span className="text-muted" style={{ fontSize: '0.82rem' }}>Licencia registrada en la reserva: <code>{r.cliente.licencia ?? '—'}</code></span>
        </div>
        {err && <div className="alert alert-danger" role="alert">{err}</div>}
        <div className="form-group">
          <label className="form-label" htmlFor="ent-lic">Número de licencia física presentada *</label>
          <input id="ent-lic" className="form-control" value={licencia} onChange={(e) => setLicencia(e.target.value.toUpperCase())}
            placeholder="Ej. 1710034065" aria-invalid={!!errLic && licencia !== ''} aria-describedby="ent-lic-err" />
          <FechaError id="ent-lic-err" mensaje={licencia ? errLic : undefined} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="ent-km">Odómetro inicial · km de salida *</label>
          <input id="ent-km" className="form-control" inputMode="numeric" value={kmSalida}
            onChange={(e) => setKmSalida(e.target.value.replace(/\D/g, ''))} aria-invalid={!!errKm} aria-describedby="ent-km-err" />
          <FechaError id="ent-km-err" mensaje={errKm} />
        </div>
        <label className="mos-check">
          <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} />
          <span>Acepto contrato firmado y licencia válida</span>
        </label>
        <div className="flex" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button type="submit" className="btn btn-success" disabled={!valido || guardando} style={{ padding: '0.75rem 1.25rem', fontWeight: 700 }}>
            {guardando ? 'Confirmando…' : 'Confirmar entrega'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ModalDevolucion({ r, onClose, onOk }: { r: TarjetaReserva; onClose: () => void; onOk: (texto: string) => void }) {
  const salida = r.checkin_entrega?.km_salida ?? 0;
  const [kmRetorno, setKmRetorno] = useState('');
  const [combustible, setCombustible] = useState(100);
  const [obs, setObs] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState('');
  const kmN = Number(kmRetorno);
  const errKm = kmRetorno === '' ? 'Ingresa el odómetro de retorno' : kmN < salida ? `Debe ser ≥ km de salida (${km(salida)})` : undefined;

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (errKm) return;
    setGuardando(true); setErr('');
    try {
      const d = await mostradorV3.checkinDevolucion(r.pnr, { km_retorno: kmN, nivel_combustible: combustible, observaciones: obs.trim() || undefined });
      const hasta = new Date(d.cooldown.disponible_desde).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
      onOk(`${km(d.km_recorridos)} recorridos. En limpieza hasta las ${hasta} (2 h).`);
    } catch (ex: any) { setErr(ex?.message || 'No se pudo registrar la devolución'); }
    finally { setGuardando(false); }
  };

  return (
    <Modal titulo={`Devolución · ${r.pnr}`} onClose={onClose} bloqueado={guardando}>
      <form onSubmit={enviar} noValidate>
        {err && <div className="alert alert-danger" role="alert">{err}</div>}
        <div className="text-muted" style={{ fontSize: '0.88rem', marginBottom: '0.5rem' }}>Odómetro de salida: <b>{km(salida)}</b></div>
        <div className="form-group">
          <label className="form-label" htmlFor="dev-km">Odómetro de retorno (km) *</label>
          <input id="dev-km" className="form-control" inputMode="numeric" value={kmRetorno} onChange={(e) => setKmRetorno(e.target.value.replace(/\D/g, ''))} aria-describedby="dev-km-err" />
          <FechaError id="dev-km-err" mensaje={kmRetorno ? errKm : undefined} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="dev-comb">Nivel de combustible: {combustible} %</label>
          <input id="dev-comb" type="range" min={0} max={100} step={5} value={combustible} onChange={(e) => setCombustible(Number(e.target.value))} style={{ width: '100%' }} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="dev-obs">Observaciones</label>
          <textarea id="dev-obs" className="form-control" rows={2} maxLength={1000} value={obs} onChange={(e) => setObs(e.target.value)} />
        </div>
        <button className="btn btn-dark btn-block" type="submit" disabled={guardando || !!errKm}>
          {guardando ? 'Registrando…' : 'Recibir vehículo e iniciar limpieza (2 h)'}
        </button>
      </form>
    </Modal>
  );
}

const CSS = `
  .mostrador { display: grid; gap: 1rem; }
  .mos-hero { padding: 0.25rem 0; }
  .mos-buscador { border: 2px solid var(--brand-border); }
  .mos-barra { display: flex; gap: 0.5rem; position: relative; }
  .mos-lupa { position: absolute; left: 0.9rem; top: 50%; transform: translateY(-50%); color: var(--text-muted); pointer-events: none; }
  .mos-input { flex: 1; font-size: 1.15rem; padding: 0.85rem 0.9rem 0.85rem 2.6rem; min-height: 54px; }
  .mos-btn-buscar { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0 1.25rem; font-size: 1rem; min-height: 54px; }
  .mos-ayuda { font-size: 0.85rem; color: var(--text-muted); margin-top: 0.5rem; }
  .mos-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; margin-top: 0.75rem; }
  .mos-chip { border: 1px solid var(--border); background: var(--surface-2); color: var(--text); border-radius: 999px; padding: 0.25rem 0.7rem; cursor: pointer; }
  .mos-chip:hover { border-color: var(--brand); }
  .mos-resumen { font-size: 0.95rem; color: var(--text-muted); }
  .mos-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); }
  .mos-card { border-width: 1px; }
  .mos-card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; flex-wrap: wrap; }
  .mos-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
  .mos-pnr { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 2rem; font-weight: 800; letter-spacing: 0.06em; line-height: 1.1; }
  .mos-badge { display: inline-block; padding: 0.35rem 0.7rem; border-radius: 999px; font-size: 0.78rem; font-weight: 700; border: 1px solid transparent; }
  .mos-badge-amarillo { background: #fef3c7; color: #92400e; border-color: #fcd34d; }
  .mos-badge-verde { background: #dcfce7; color: #166534; border-color: #86efac; }
  .mos-badge-azul { background: #dbeafe; color: #1e40af; border-color: #93c5fd; }
  .mos-badge-rojo { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
  .mos-badge-gris { background: var(--surface-2); color: var(--text-muted); border-color: var(--border); }
  .mos-vehiculo { display: flex; gap: 0.75rem; align-items: center; margin: 1rem 0 0.75rem; }
  .mos-vehiculo img, .mos-foto-vacia { width: 96px; height: 64px; object-fit: cover; border-radius: var(--radius-sm); background: var(--media-bg); flex-shrink: 0; }
  .mos-foto-vacia { display: flex; align-items: center; justify-content: center; font-size: 1.8rem; }
  .mos-placa { font-family: ui-monospace, Consolas, monospace; }
  .mos-datos { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 1rem; margin: 0; font-size: 0.9rem; }
  .mos-datos dt { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
  .mos-datos dd { margin: 0; font-weight: 600; }
  .mos-wrap { overflow-wrap: anywhere; }
  .mos-entregado { margin-top: 0.9rem; padding: 0.6rem 0.75rem; border-radius: var(--radius-sm); background: var(--success-bg); border: 1px solid var(--success-border); font-size: 0.85rem; }
  .mos-btn-entregar { margin-top: 1rem; width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.6rem;
    background: #16a34a; color: #fff; border: 0; border-radius: var(--radius); padding: 1.05rem 1rem; font-size: 1.08rem; font-weight: 800;
    cursor: pointer; box-shadow: 0 6px 18px rgba(22, 163, 74, 0.35); transition: transform 0.12s ease, background 0.12s ease; }
  .mos-btn-entregar:hover { background: #15803d; transform: translateY(-1px); }
  .mos-btn-entregar:focus-visible { outline: 3px solid #86efac; outline-offset: 2px; }
  .mos-modal-resumen { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.75rem; margin-bottom: 1rem; }
  .mos-check { display: flex; gap: 0.6rem; align-items: center; font-weight: 600; cursor: pointer; padding: 0.6rem 0.75rem; border: 1px dashed var(--border-strong); border-radius: var(--radius-sm); }
  .mos-check input { width: 20px; height: 20px; accent-color: #16a34a; }
  .mos-toast { position: fixed; right: 1.25rem; bottom: 1.25rem; z-index: 60; max-width: 420px; padding: 0.9rem 2.5rem 0.9rem 1rem; border-radius: var(--radius); box-shadow: var(--shadow-lg); animation: mos-in 0.2s ease-out; }
  .mos-toast-ok { background: #166534; color: #fff; }
  .mos-toast-error { background: #991b1b; color: #fff; }
  .mos-toast-x { position: absolute; right: 0.5rem; top: 0.35rem; background: none; border: 0; color: inherit; font-size: 1.3rem; cursor: pointer; }
  @keyframes mos-in { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
  @media (max-width: 640px) {
    .mos-barra { flex-direction: column; }
    .mos-lupa { top: 27px; }
    .mos-grid { grid-template-columns: 1fr; }
    .mos-pnr { font-size: 1.6rem; }
    .mos-toast { left: 1rem; right: 1rem; }
  }
`;

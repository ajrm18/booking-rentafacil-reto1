import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { flotaV2 } from '../api/clientV2';
import type { AutoFlotaItemV2 } from '../types/v2';
import { useAuth } from '../context/AuthContext';
import FechaError from '../components/FechaError';
import { FASE_VEHICULO, fechaHoraLocal, km } from '../utils/v2';

/**
 * Mantenimiento preventivo (POST /api/v2/autos/{id}/mantenimiento/registro, RBAC MANTENIMIENTO o ADMIN):
 * odómetro, combustible, carrocería y neumáticos; alerta cuando kilometraje_actual >= umbral.
 */
export default function MantenimientoAdmin() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [flota, setFlota] = useState<AutoFlotaItemV2[]>([]);
  const [id, setId] = useState(params.get('id') || '');
  const [bitacora, setBitacora] = useState<any[]>([]);
  const vacio = { km: '', combustible: 100, carroceria: '', neumaticos: 'BUENO', observaciones: '', realizado: false, nuevoUmbral: '' };
  const [form, setForm] = useState(vacio);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);

  const cargarFlota = () => flotaV2.flota().then(setFlota).catch(() => {});
  useEffect(() => { cargarFlota(); }, []);
  useEffect(() => {
    if (!id) { setBitacora([]); return; }
    flotaV2.bitacora(id).then(setBitacora).catch(() => setBitacora([]));
  }, [id]);

  const v = flota.find((x) => x.id === id);
  useEffect(() => { if (v) setForm((f) => ({ ...vacio, km: String(v.kilometraje_actual), combustible: f.combustible })); }, [v?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const kmN = Number(form.km);
  const errKm = !form.km ? 'Odómetro obligatorio' : v && kmN < v.kilometraje_actual ? `No puede ser menor que ${km(v.kilometraje_actual)}` : undefined;
  const errUmbral = form.nuevoUmbral && Number(form.nuevoUmbral) <= kmN ? 'Debe ser mayor que el odómetro registrado' : undefined;

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v || errKm || errUmbral) return;
    setGuardando(true); setResultado(null);
    try {
      const r = await flotaV2.mantenimiento(v.id, {
        tecnico_id: user?.email ?? 'tecnico',
        kilometraje_registrado: kmN,
        nivel_combustible: form.combustible,
        condiciones_carroceria: form.carroceria || undefined,
        estado_neumaticos: form.neumaticos,
        observaciones: form.observaciones || undefined,
        mantenimiento_realizado: form.realizado,
        ...(form.realizado && form.nuevoUmbral ? { nuevo_proximo_mantenimiento_km: Number(form.nuevoUmbral) } : {}),
      });
      setResultado({ ok: !r.mantenimiento_requerido, texto: `${r.alerta_preventiva} (bitácora ${r.bitacora_id}, estado ${FASE_VEHICULO[r.estado_operativo as keyof typeof FASE_VEHICULO]?.label ?? r.estado_operativo})` });
      cargarFlota();
      flotaV2.bitacora(v.id).then(setBitacora).catch(() => {});
    } catch (ex: any) {
      setResultado({ ok: false, texto: ex?.message || 'No se pudo registrar' });
    } finally { setGuardando(false); }
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Mantenimiento preventivo</h1>
      <div className="card mb-3"><div className="card-body">
        <label className="form-label" htmlFor="man-veh">Vehículo</label>
        <select id="man-veh" className="form-control" value={id} onChange={(e) => { setId(e.target.value); setResultado(null); }}>
          <option value="">— Selecciona —</option>
          {flota.map((x) => (
            <option key={x.id} value={x.id}>
              {x.marca} {x.modelo} ({x.id}) · {km(x.kilometraje_actual)} / {km(x.umbral_mantenimiento_km)}{x.alerta_mantenimiento ? ' · ALERTA' : ''}
            </option>
          ))}
        </select>
        {v && (
          <div className="mt-1" style={{ fontSize: '0.88rem' }}>
            Estado: <span className={`badge ${FASE_VEHICULO[v.estado_operativo].badge}`}>{FASE_VEHICULO[v.estado_operativo].label}</span>{' '}
            · Odómetro {km(v.kilometraje_actual)} · Próximo mantenimiento {km(v.umbral_mantenimiento_km)}{' '}
            {v.alerta_mantenimiento && <span className="badge badge-danger">Supera el umbral</span>}
          </div>
        )}
      </div></div>

      {v && (
        <form className="card mb-3" onSubmit={enviar} noValidate>
          <div className="card-body" style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <div>
              <label className="form-label" htmlFor="man-km">Odómetro registrado (km) *</label>
              <input id="man-km" className="form-control" inputMode="numeric" value={form.km} onChange={(e) => setForm({ ...form, km: e.target.value.replace(/\D/g, '') })}
                aria-invalid={!!errKm} aria-describedby="man-km-err" />
              <FechaError id="man-km-err" mensaje={errKm} />
            </div>
            <div>
              <label className="form-label" htmlFor="man-comb">Combustible: {form.combustible} %</label>
              <input id="man-comb" type="range" min={0} max={100} step={5} value={form.combustible} onChange={(e) => setForm({ ...form, combustible: Number(e.target.value) })} style={{ width: '100%' }} />
            </div>
            <div>
              <label className="form-label" htmlFor="man-neu">Estado de neumáticos</label>
              <select id="man-neu" className="form-control" value={form.neumaticos} onChange={(e) => setForm({ ...form, neumaticos: e.target.value })}>
                <option value="BUENO">Bueno</option><option value="REGULAR">Regular</option><option value="MALO">Malo (cambiar)</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="form-label" htmlFor="man-car">Condiciones de carrocería</label>
              <input id="man-car" className="form-control" maxLength={500} value={form.carroceria} onChange={(e) => setForm({ ...form, carroceria: e.target.value })} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="form-label" htmlFor="man-obs">Observaciones</label>
              <textarea id="man-obs" className="form-control" rows={2} maxLength={2000} value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} />
            </div>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input type="checkbox" checked={form.realizado} onChange={(e) => setForm({ ...form, realizado: e.target.checked })} />
              Mantenimiento realizado (reinicia el umbral y libera el vehículo)
            </label>
            {form.realizado && (
              <div>
                <label className="form-label" htmlFor="man-umbral">Próximo mantenimiento (km)</label>
                <input id="man-umbral" className="form-control" inputMode="numeric" placeholder={form.km ? String(kmN + 10000) : ''}
                  value={form.nuevoUmbral} onChange={(e) => setForm({ ...form, nuevoUmbral: e.target.value.replace(/\D/g, '') })}
                  aria-invalid={!!errUmbral} aria-describedby="man-umbral-err" />
                <FechaError id="man-umbral-err" mensaje={errUmbral} />
              </div>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              {resultado && <div className={`alert ${resultado.ok ? 'alert-success' : 'alert-danger'}`} role="status">{resultado.texto}</div>}
              <button className="btn btn-primary" type="submit" disabled={guardando || !!errKm || !!errUmbral}>{guardando ? 'Registrando…' : 'Registrar en bitácora'}</button>
            </div>
          </div>
        </form>
      )}

      {v && (
        <>
          <h2 style={{ fontSize: '1.1rem' }}>Bitácora</h2>
          <div className="table-wrapper">
            <table className="table">
              <thead><tr><th>Fecha</th><th>Bitácora</th><th>Técnico</th><th>Odómetro</th><th>Combustible</th><th>Resultado</th></tr></thead>
              <tbody>
                {bitacora.length === 0 && <tr><td colSpan={6} className="text-muted">Sin registros.</td></tr>}
                {bitacora.map((b) => (
                  <tr key={b.bitacora_id}>
                    <td style={{ fontSize: '0.8rem' }}>{fechaHoraLocal(b.created_at)}</td>
                    <td><code style={{ fontSize: '0.8rem' }}>{b.bitacora_id}</code></td>
                    <td style={{ fontSize: '0.85rem' }}>{b.tecnico_id}</td>
                    <td>{km(b.kilometraje_registrado)}</td>
                    <td>{b.nivel_combustible} %</td>
                    <td>{b.mantenimiento_realizado ? <span className="badge badge-success">Realizado</span> : b.alerta_emitida ? <span className="badge badge-danger">Alerta</span> : <span className="badge badge-muted">Revisión</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

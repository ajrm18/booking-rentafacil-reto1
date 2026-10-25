import { useEffect, useState } from 'react';
import { promocionesV2 } from '../api/clientV2';
import type { ContratoPromociones } from '../types/v2';
import FechaError from '../components/FechaError';
import { fechaHoraLocal } from '../utils/v2';

const CIUDADES = ['Quito', 'Guayaquil', 'Cuenca', 'Manta', 'Loja', 'Ambato', 'Galápagos'];

/** Cuestionario B2B de la Cátedra RDA2 §9 (GET/PUT /api/v2/autos/promociones/contrato). */
export default function PromocionesAdmin() {
  const [contrato, setContrato] = useState<ContratoPromociones | null>(null);
  const [form, setForm] = useState({ permite: true, pct: '15', destinos: [] as string[], vigencia: '', condiciones: '' });
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);

  const aplicar = (c: ContratoPromociones) => {
    setContrato(c);
    setForm({
      permite: c.permite_promociones, pct: String(c.porcentaje_descuento_maximo), destinos: c.destinos_habilitados,
      vigencia: c.vigencia_hasta ?? '', condiciones: c.condiciones_combo ?? '',
    });
  };
  useEffect(() => { promocionesV2.obtener().then(aplicar).catch((e) => setResultado({ ok: false, texto: e?.message || 'No se pudo cargar el contrato' })); }, []);

  const pct = Number(form.pct);
  const errPct = form.pct === '' || !Number.isFinite(pct) || pct < 0 || pct > 100 ? 'Porcentaje entre 0 y 100'
    : !form.permite && pct > 0 ? 'Debe ser 0 si no acepta promociones' : undefined;
  const toggle = (c: string) => setForm({ ...form, destinos: form.destinos.includes(c) ? form.destinos.filter((d) => d !== c) : [...form.destinos, c] });

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (errPct) return;
    setGuardando(true); setResultado(null);
    try {
      const r = await promocionesV2.actualizar({
        permite_promociones: form.permite, porcentaje_descuento_maximo: pct, destinos_habilitados: form.destinos,
        vigencia_hasta: form.vigencia || null, condiciones_combo: form.condiciones || null,
      });
      aplicar(r.contrato);
      setResultado({ ok: true, texto: r.mensaje });
    } catch (ex: any) {
      setResultado({ ok: false, texto: ex?.message || 'No se pudo guardar' });
    } finally { setGuardando(false); }
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Promociones B2B</h1>
      <p className="text-muted" style={{ marginTop: 0 }}>
        Acuerdo con el Booking Prototipo para armar combos (auto + hotel + vuelo). Cátedra RDA2 §9: se responde una sola vez y se puede actualizar.
      </p>
      {contrato && (
        <div className="text-muted mb-2" style={{ fontSize: '0.85rem' }}>
          Proveedor <code>{contrato.proveedor_codigo}</code> · {contrato.nombre_socio} · {contrato.vertical} ·{' '}
          <span className={`badge ${contrato.vigente ? 'badge-success' : 'badge-muted'}`}>{contrato.vigente ? 'Vigente' : 'No vigente'}</span>
          {contrato.updated_at && <> · actualizado {fechaHoraLocal(contrato.updated_at)}{contrato.actualizado_por ? ` por ${contrato.actualizado_por}` : ''}</>}
        </div>
      )}
      <form className="card" onSubmit={guardar} noValidate>
        <div className="card-body" style={{ display: 'grid', gap: '1rem' }}>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="form-label">1. ¿Acepta participar en promociones y combos turísticos? *</legend>
            <label style={{ marginRight: '1.25rem' }}><input type="radio" name="permite" checked={form.permite} onChange={() => setForm({ ...form, permite: true })} /> Sí</label>
            <label><input type="radio" name="permite" checked={!form.permite} onChange={() => setForm({ ...form, permite: false, pct: '0' })} /> No</label>
          </fieldset>
          <div style={{ maxWidth: 260 }}>
            <label className="form-label" htmlFor="pro-pct">2. Porcentaje máximo de descuento (%) *</label>
            <input id="pro-pct" className="form-control" inputMode="decimal" value={form.pct} disabled={!form.permite}
              onChange={(e) => setForm({ ...form, pct: e.target.value.replace(/[^0-9.]/g, '') })}
              aria-invalid={!!errPct} aria-describedby="pro-pct-err" />
            <FechaError id="pro-pct-err" mensaje={errPct} />
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="form-label">3. Destinos habilitados para el retiro en promoción</legend>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem' }}>
              {[...new Set([...CIUDADES, ...form.destinos])].map((c) => (
                <label key={c}><input type="checkbox" checked={form.destinos.includes(c)} onChange={() => toggle(c)} /> {c}</label>
              ))}
            </div>
          </fieldset>
          <div style={{ maxWidth: 260 }}>
            <label className="form-label" htmlFor="pro-vig">4. Vigencia del acuerdo hasta</label>
            <input id="pro-vig" type="date" className="form-control" value={form.vigencia} onChange={(e) => setForm({ ...form, vigencia: e.target.value })} />
          </div>
          <div>
            <label className="form-label" htmlFor="pro-cond">5. Condiciones del combo</label>
            <textarea id="pro-cond" className="form-control" rows={3} maxLength={500} value={form.condiciones} onChange={(e) => setForm({ ...form, condiciones: e.target.value })} />
          </div>
          {resultado && <div className={`alert ${resultado.ok ? 'alert-success' : 'alert-danger'}`} role="status">{resultado.texto}</div>}
          <div><button className="btn btn-primary" type="submit" disabled={guardando || !!errPct}>{guardando ? 'Guardando…' : 'Formalizar acuerdo'}</button></div>
        </div>
      </form>
    </div>
  );
}

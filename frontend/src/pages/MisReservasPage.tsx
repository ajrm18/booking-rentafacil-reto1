import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ordenesV2 } from '../api/clientV2';
import type { AutoOrderResponseV2 } from '../types/v2';
import { fechaCorta } from '../utils/reservas';
import { estadoOrdenV2 } from '../utils/v2';
import Modal from '../components/Modal';
import FasesCheckin from '../components/FasesCheckin';
import VoucherQR from '../components/VoucherQR';
import FechaError from '../components/FechaError';

/** Mis reservas sobre GET /api/v2/autos/orders: fases de check-in, check-in digital, voucher QR y cancelación Saga. */
export default function MisReservasPage() {
  const [lista, setLista] = useState<AutoOrderResponseV2[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [checkin, setCheckin] = useState<AutoOrderResponseV2 | null>(null);
  const [cancelar, setCancelar] = useState<AutoOrderResponseV2 | null>(null);
  const [voucher, setVoucher] = useState<AutoOrderResponseV2 | null>(null);

  const cargar = () => {
    setLoading(true);
    ordenesV2.listar()
      .then(setLista)
      .catch((e) => setError(e?.message || 'No se pudieron cargar tus reservas'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, []);

  return (
    <div className="container" style={{ padding: '2rem 1rem' }}>
      <h1 style={{ marginTop: 0 }}>Mis reservas</h1>
      {error && <div className="alert alert-danger">{error}</div>}
      {aviso && <div className="alert alert-success" role="status">{aviso}</div>}

      {loading ? (
        <div className="text-muted">Cargando...</div>
      ) : lista.length === 0 ? (
        <div className="card"><div className="card-body text-center">
          <div className="text-muted mb-2">Aún no tienes reservas.</div>
          <Link to="/catalogo" className="btn btn-primary">Buscar vehículos</Link>
        </div></div>
      ) : (
        <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {lista.map((r) => {
            const est = estadoOrdenV2(r);
            const puedeCheckin = r.status === 'CONFIRMED';
            const puedeCancelar = r.status === 'CONFIRMED' || r.status === 'CHECKIN_COMPLETED';
            return (
              <div key={r.order_id} className="card">
                <div className="card-body">
                  <div className="flex-between">
                    <div>
                      <div style={{ fontWeight: 700 }}>{r.vehiculo.marca} {r.vehiculo.modelo}</div>
                      <div className="text-muted" style={{ fontSize: '0.85rem' }}><code>{r.pnr}</code></div>
                    </div>
                    <span className={`badge ${est.badge}`}>{est.label}</span>
                  </div>
                  <div className="mt-2" style={{ display: 'grid', gap: '0.25rem', fontSize: '0.9rem' }}>
                    {r.recogida.fecha_hora && (
                      <div><b>Fechas:</b> {fechaCorta(r.recogida.fecha_hora)} – {fechaCorta(r.devolucion.fecha_hora ?? undefined)}</div>
                    )}
                    <div><b>Total:</b> ${Number(r.total_price.total).toFixed(2)} {r.total_price.currency} · cobertura {r.tipo_cobertura === 'TOTAL' ? 'total' : 'básica'}</div>
                    {r.refund && <div><b>Reembolso:</b> {r.refund.refund_id} (100 %, ${Number(r.refund.amount).toFixed(2)})</div>}
                  </div>
                  {r.status !== 'CANCELLED' && <FasesCheckin orden={r} />}
                  <div className="flex mt-2" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                    <Link to={`/reserva/${r.order_id}`} className="btn btn-outline btn-sm">Ver</Link>
                    {r.status !== 'CANCELLED' && r.status !== 'COMPLETADA' && (
                      <button className="btn btn-outline btn-sm" onClick={() => setVoucher(r)}>Voucher QR</button>
                    )}
                    {puedeCheckin && <button className="btn btn-primary btn-sm" onClick={() => setCheckin(r)}>Check-in digital</button>}
                    {puedeCancelar && <button className="btn btn-danger btn-sm" onClick={() => setCancelar(r)}>Cancelar</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {checkin && (
        <CheckinDigitalModal orden={checkin} onClose={() => setCheckin(null)}
          onListo={(r) => { setCheckin(null); setAviso(`Check-in digital listo para ${r.pnr}. Presenta tu código QR en el mostrador.`); cargar(); }} />
      )}
      {cancelar && (
        <CancelarModal orden={cancelar} onClose={() => setCancelar(null)}
          onListo={(r) => { setCancelar(null); setAviso(`Reserva ${r.pnr} cancelada. Reembolso ${r.refund.refund_id} del 100 % ($${Number(r.refund.amount).toFixed(2)}).`); cargar(); }} />
      )}
      {voucher && (
        <Modal titulo={`Voucher ${voucher.pnr}`} onClose={() => setVoucher(null)} ancho={380}>
          <VoucherQR data={voucher.voucher_qr_data} size={220} />
          <p className="text-muted" style={{ fontSize: '0.85rem' }}>
            {voucher.checkins.digital.completado ? 'Check-in digital hecho: retiro express (fast-track).' : 'Haz el check-in digital para el retiro express.'}
          </p>
          <button className="btn btn-outline btn-block" onClick={() => setVoucher(null)}>Cerrar</button>
        </Modal>
      )}
    </div>
  );
}

function CheckinDigitalModal({ orden, onClose, onListo }: { orden: AutoOrderResponseV2; onClose: () => void; onListo: (r: any) => void }) {
  const [form, setForm] = useState({
    documento_identidad: '', numero_licencia: orden.conductor?.licencia_conducir ?? '', fecha_vencimiento_licencia: '',
  });
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState('');
  const errores: Record<string, string | undefined> = {
    documento_identidad: /^[A-Za-z0-9-]{5,20}$/.test(form.documento_identidad) ? undefined : 'Documento de 5 a 20 caracteres',
    numero_licencia: /^[A-Za-z0-9-]{5,20}$/.test(form.numero_licencia) ? undefined : 'Licencia de 5 a 20 caracteres',
    fecha_vencimiento_licencia: form.fecha_vencimiento_licencia ? undefined : 'Indica la fecha de vencimiento',
  };
  const valido = Object.values(errores).every((e) => !e);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valido) return;
    setGuardando(true); setErr('');
    try { onListo(await ordenesV2.checkinDigital(orden.pnr, form)); }
    catch (ex: any) { setErr(ex?.message || 'No se pudo completar el check-in'); }
    finally { setGuardando(false); }
  };

  return (
    <Modal titulo={`Check-in digital · ${orden.pnr}`} onClose={onClose} bloqueado={guardando}>
      <form onSubmit={enviar} noValidate>
        <p className="text-muted" style={{ fontSize: '0.88rem', marginTop: 0 }}>
          Valida tu licencia antes de llegar y retira las llaves por la vía rápida. El vehículo queda <b>listo para entregar</b>.
        </p>
        {([
          ['documento_identidad', 'Documento de identidad *', 'text'],
          ['numero_licencia', 'Número de licencia *', 'text'],
          ['fecha_vencimiento_licencia', 'Vencimiento de la licencia *', 'date'],
        ] as const).map(([k, label, tipo]) => (
          <div className="form-group" key={k}>
            <label className="form-label" htmlFor={`chk-${k}`}>{label}</label>
            <input id={`chk-${k}`} type={tipo} className="form-control" value={form[k]}
              aria-invalid={!!errores[k] && !!form[k]} aria-describedby={errores[k] && form[k] ? `chk-${k}-err` : undefined}
              onChange={(e) => setForm({ ...form, [k]: tipo === 'date' ? e.target.value : e.target.value.replace(/[^A-Za-z0-9-]/g, '') })} />
            <FechaError id={`chk-${k}-err`} mensaje={form[k] ? errores[k] : undefined} />
          </div>
        ))}
        {err && <div className="alert alert-danger">{err}</div>}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={guardando}>Volver</button>
          <button type="submit" className="btn btn-primary" disabled={!valido || guardando}>{guardando ? 'Validando…' : 'Hacer check-in'}</button>
        </div>
      </form>
    </Modal>
  );
}

function CancelarModal({ orden, onClose, onListo }: { orden: AutoOrderResponseV2; onClose: () => void; onListo: (r: any) => void }) {
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState('');
  const confirmar = async () => {
    setGuardando(true); setErr('');
    try { onListo(await ordenesV2.cancelar(orden.pnr, motivo.trim() || undefined)); }
    catch (ex: any) { setErr(ex?.message || 'No se pudo cancelar'); }
    finally { setGuardando(false); }
  };
  return (
    <Modal titulo={`Cancelar ${orden.pnr}`} onClose={onClose} bloqueado={guardando}>
      <p>¿Cancelar la reserva del <b>{orden.vehiculo.marca} {orden.vehiculo.modelo}</b>? Se reembolsa el <b>100 %</b> (${Number(orden.total_price.total).toFixed(2)}).</p>
      <div className="form-group">
        <label className="form-label" htmlFor="cancel-motivo">Motivo (opcional)</label>
        <input id="cancel-motivo" className="form-control" maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </div>
      {err && <div className="alert alert-danger">{err}</div>}
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <button className="btn btn-outline" onClick={onClose} disabled={guardando}>Volver</button>
        <button className="btn btn-danger" onClick={confirmar} disabled={guardando}>{guardando ? 'Cancelando…' : 'Cancelar reserva'}</button>
      </div>
    </Modal>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { catalog, orders } from '../api';
import type { OrderPreviewResponse, VehicleDetail } from '../types';
import { useAuth } from '../context/AuthContext';

const EXTRAS_DISPONIBLES = [
  { code: 'GPS', label: 'GPS ($5/dia)' },
  { code: 'SILLA_BEBE', label: 'Silla de bebe ($5/dia)' },
  { code: 'CONDUCTOR_ADICIONAL', label: 'Conductor adicional ($5/dia)' },
];

const HOY = new Date().toISOString().slice(0, 10);
const TRES = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

export default function VehiculoDetallePage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { user } = useAuth();

  const [v, setV] = useState<VehicleDetail | null>(null);
  const [imgActiva, setImgActiva] = useState(0);
  const [ini, setIni] = useState(params.get('ini') || HOY);
  const [fin, setFin] = useState(params.get('fin') || TRES);
  const [edad, setEdad] = useState(Number(params.get('edad') || 25));
  const [extras, setExtras] = useState<string[]>([]);
  const [searchToken, setSearchToken] = useState(params.get('token') || '');

  const [preview, setPreview] = useState<OrderPreviewResponse | null>(null);
  const [driver, setDriver] = useState({ first_name: '', last_name: '', email: '', phone_number: '' });
  const [paymentRef, setPaymentRef] = useState('PAY-' + Math.random().toString(36).slice(2, 10).toUpperCase());
  const [step, setStep] = useState<'form' | 'preview' | 'creating'>('form');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    catalog.details([id]).then((r) => {
      const d = r.data[0];
      if (d) setV(d);
    }).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (user && !driver.email) {
      setDriver({ ...driver, email: user.email });
    }
  }, [user]);

  const imagenes = (v?.images && v.images.length > 0) ? v.images : [v?.main_image_url || ''];

  const dias = (() => {
    if (!ini || !fin) return 0;
    const d = Math.ceil((new Date(fin).getTime() - new Date(ini).getTime()) / 86400000);
    return d > 0 ? d : 0;
  })();
  const precioEstimado = v ? dias * Number(v.price_per_day) + extras.length * 5 * dias : 0;

  const toggleExtra = (code: string) => {
    setExtras(extras.includes(code) ? extras.filter((e) => e !== code) : [...extras, code]);
  };

  const asegurarSearchToken = async (): Promise<string> => {
    if (searchToken) return searchToken;
    if (!v) throw new Error('Vehiculo no disponible');
    const res = await catalog.search({
      booker: { country: 'ec' }, currency: 'USD', driver: { age: edad },
      route: {
        pickup: { datetime: `${ini}T10:00:00Z`, location: {} },
        dropoff: { datetime: `${fin}T10:00:00Z`, location: {} },
      },
    });
    setSearchToken(res.search_token);
    return res.search_token;
  };

  const previsualizar = async () => {
    setError(''); setLoading(true);
    try {
      if (!user) { nav('/login'); return; }
      if (!v) return;
      const tok = await asegurarSearchToken();
      const hold = await orders.hold(v.vehicle_id, tok, edad);
      const prev = await orders.preview(v.vehicle_id, tok, hold.hold_id, extras);
      setPreview(prev);
      setStep('preview');
    } catch (e: any) {
      setError(e?.message || 'Error al preparar la reserva');
    } finally { setLoading(false); }
  };

  const confirmar = async () => {
    if (!preview) return;
    setError(''); setLoading(true); setStep('creating');
    try {
      const orden = await orders.create(preview.data.order_preview_id, paymentRef, driver);
      // Guardar order_id en localStorage para que MisReservas del cliente lo recupere
      const prev: string[] = JSON.parse(localStorage.getItem('rf_myorders') || '[]');
      if (!prev.includes(orden.order_id)) prev.unshift(orden.order_id);
      localStorage.setItem('rf_myorders', JSON.stringify(prev.slice(0, 50)));
      nav(`/reserva/${orden.order_id}`);
    } catch (e: any) {
      setError(e?.message || 'Error al crear la reserva');
      setStep('preview');
    } finally { setLoading(false); }
  };

  if (!v) return <div className="container" style={{ padding: '2rem 1rem' }}>Cargando...</div>;

  return (
    <div className="container" style={{ padding: '2rem 1rem' }}>
      <button className="btn btn-ghost btn-sm mb-2" onClick={() => nav(-1)}>&larr; Volver</button>

      <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'minmax(280px, 1.4fr) minmax(260px, 1fr)' }} className="detalle-grid">
        {/* Galeria + Info */}
        <div>
          <div style={{ aspectRatio: '16 / 10', borderRadius: 'var(--radius)', overflow: 'hidden', background: '#f1f5f9' }}>
            <img src={imagenes[imgActiva]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          {imagenes.length > 1 && (
            <div style={{
              display: 'grid', gap: '0.5rem', marginTop: '0.5rem',
              gridTemplateColumns: `repeat(${Math.min(imagenes.length, 5)}, 1fr)`,
            }}>
              {imagenes.map((img, i) => (
                <button key={i} onClick={() => setImgActiva(i)} style={{
                  aspectRatio: '4 / 3', borderRadius: 8, overflow: 'hidden',
                  border: imgActiva === i ? '2px solid var(--brand)' : '1px solid var(--border)',
                  padding: 0, cursor: 'pointer',
                }}>
                  <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </button>
              ))}
            </div>
          )}

          <div style={{ marginTop: '1.5rem' }}>
            <h1 style={{ margin: 0 }}>{v.make} {v.model}</h1>
            <div className="text-muted">
              {v.year} &middot; {v.color} &middot; {v.car_type}
            </div>

            <div className="mt-2" style={{
              display: 'grid', gap: '0.5rem',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            }}>
              <Feature label="Pasajeros" value={String(v.seats)} />
              <Feature label="Puertas" value={String(v.doors)} />
              <Feature label="Maletas" value={String(v.bag_capacity)} />
              <Feature label="Transmision" value={v.transmission} />
              <Feature label="Combustible" value={v.fuel_type} />
              <Feature label="AC" value={v.air_conditioning ? 'Si' : 'No'} />
            </div>

            {v.description && (
              <div className="mt-3">
                <h3>Descripcion</h3>
                <p className="text-muted" style={{ lineHeight: 1.6 }}>{v.description}</p>
              </div>
            )}

            {v.supplier && (
              <div className="mt-2">
                <h3>Proveedor</h3>
                <div>{v.supplier.name}</div>
              </div>
            )}
            {v.depot && (
              <div className="mt-2">
                <h3>Recogida</h3>
                <div>{v.depot.name}</div>
                <div className="text-muted">{v.depot.city}</div>
              </div>
            )}
          </div>
        </div>

        {/* Reserva */}
        <aside>
          <div className="card" style={{ position: 'sticky', top: '80px' }}>
            <div className="card-body">
              {step === 'form' && (
                <>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
                    <span style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--brand)' }}>
                      ${Number(v.price_per_day).toFixed(2)}
                    </span>
                    <span className="text-muted">/ dia</span>
                  </div>

                  {error && <div className="alert alert-danger mt-2">{error}</div>}

                  <div className="form-group mt-2">
                    <label className="form-label">Fecha inicio</label>
                    <input type="date" className="form-control" min={HOY}
                      value={ini} onChange={(e) => { setIni(e.target.value); setSearchToken(''); }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Fecha fin</label>
                    <input type="date" className="form-control" min={ini}
                      value={fin} onChange={(e) => { setFin(e.target.value); setSearchToken(''); }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Edad del conductor</label>
                    <input type="number" className="form-control" min={18} max={99}
                      value={edad} onChange={(e) => { setEdad(Number(e.target.value)); setSearchToken(''); }} />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Extras</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {EXTRAS_DISPONIBLES.map((ex) => (
                        <label key={ex.code} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.9rem' }}>
                          <input type="checkbox" checked={extras.includes(ex.code)}
                            onChange={() => toggleExtra(ex.code)} />
                          {ex.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  {dias > 0 && (
                    <div style={{
                      background: 'var(--brand-light)', padding: '0.75rem',
                      borderRadius: 'var(--radius-sm)', marginBottom: '1rem',
                    }}>
                      <div className="flex-between"><span>Dias</span><span>{dias}</span></div>
                      <div className="flex-between"><span>Vehiculo</span><span>${(dias * Number(v.price_per_day)).toFixed(2)}</span></div>
                      {extras.length > 0 && (
                        <div className="flex-between"><span>Extras ({extras.length})</span><span>${(extras.length * 5 * dias).toFixed(2)}</span></div>
                      )}
                      <div className="flex-between" style={{
                        fontWeight: 700, borderTop: '1px solid #bfdbfe',
                        paddingTop: '0.4rem', marginTop: '0.4rem',
                      }}>
                        <span>Subtotal</span><span>${precioEstimado.toFixed(2)}</span>
                      </div>
                      <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                        (impuestos calculados en el paso de previsualizacion)
                      </div>
                    </div>
                  )}

                  <button className="btn btn-primary btn-block" onClick={previsualizar} disabled={loading || dias <= 0}>
                    {loading ? 'Bloqueando...' : user ? 'Continuar' : 'Ingresar para reservar'}
                  </button>
                </>
              )}

              {(step === 'preview' || step === 'creating') && preview && (
                <>
                  <h3 style={{ marginTop: 0 }}>Confirmar reserva</h3>
                  <div className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                    Preview ID: <code>{preview.data.order_preview_id}</code>
                  </div>

                  {error && <div className="alert alert-danger">{error}</div>}

                  <div style={{
                    background: 'var(--brand-light)', padding: '0.75rem',
                    borderRadius: 'var(--radius-sm)', marginBottom: '1rem',
                  }}>
                    {Object.entries(preview.data.breakdown).map(([k, val]) => (
                      <div key={k} className="flex-between">
                        <span>{k}</span><span>{typeof val === 'number' ? `$${Number(val).toFixed(2)}` : String(val)}</span>
                      </div>
                    ))}
                    <div className="flex-between" style={{
                      fontWeight: 700, borderTop: '1px solid #bfdbfe',
                      paddingTop: '0.4rem', marginTop: '0.4rem',
                    }}>
                      <span>Total</span><span>${preview.data.total_price.toFixed(2)} {preview.data.currency}</span>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Nombre</label>
                    <input className="form-control" required value={driver.first_name}
                      onChange={(e) => setDriver({ ...driver, first_name: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Apellido</label>
                    <input className="form-control" required value={driver.last_name}
                      onChange={(e) => setDriver({ ...driver, last_name: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email</label>
                    <input type="email" className="form-control" required value={driver.email}
                      onChange={(e) => setDriver({ ...driver, email: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Telefono</label>
                    <input className="form-control" value={driver.phone_number}
                      onChange={(e) => setDriver({ ...driver, phone_number: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Referencia de pago</label>
                    <input className="form-control" required value={paymentRef}
                      onChange={(e) => setPaymentRef(e.target.value)} />
                  </div>

                  <button className="btn btn-primary btn-block" onClick={confirmar}
                    disabled={loading || !driver.first_name || !driver.last_name || !driver.email}>
                    {loading ? 'Procesando...' : 'Confirmar reserva'}
                  </button>
                  <button className="btn btn-outline btn-block mt-1" onClick={() => setStep('form')}>
                    Volver
                  </button>
                </>
              )}
            </div>
          </div>
        </aside>
      </div>

      <style>{`
        @media (max-width: 820px) {
          .detalle-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function Feature({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: '#f8fafc', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)', padding: '0.6rem 0.85rem',
    }}>
      <div className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: '0.95rem', textTransform: 'capitalize' }}>{value}</div>
    </div>
  );
}

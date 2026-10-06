import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { catalog, orders } from '../api';
import type { OrderPreviewResponse, VehicleDetail } from '../types';
import { useAuth } from '../context/AuthContext';
import { PHOTO_CREDITS } from '../data/photoCredits';
import { ETIQUETA_CATEGORIA } from '../components/VehiculoCard';
import PaymentSimulatorModal from '../components/PaymentSimulatorModal';

/** El contrato exige driver.age; la UI no lo solicita y se envia un valor estandar. */
const EDAD_CONDUCTOR = 25;

const EXTRAS_DISPONIBLES = [
  { code: 'GPS', label: 'GPS ($5/día)' },
  { code: 'SILLA_BEBE', label: 'Silla de bebé ($5/día)' },
  { code: 'CONDUCTOR_ADICIONAL', label: 'Conductor adicional ($5/día)' },
];

const ETIQUETAS_DESGLOSE: Record<string, string> = {
  base: 'Alquiler', extras: 'Extras', taxes: 'Impuestos', days: 'Días', price_per_day: 'Precio por día',
};

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
  const [extras, setExtras] = useState<string[]>([]);
  const [searchToken, setSearchToken] = useState(params.get('token') || '');
  // El search_token lleva las fechas de la busqueda que lo emitio: si el usuario cambia las
  // fechas aqui hay que pedir uno nuevo, o el preview cobraria los dias anteriores.
  const fechasDelToken = useRef({ ini, fin });
  useEffect(() => {
    if (ini !== fechasDelToken.current.ini || fin !== fechasDelToken.current.fin) setSearchToken('');
  }, [ini, fin]);

  const [preview, setPreview] = useState<OrderPreviewResponse | null>(null);
  const [driver, setDriver] = useState({ first_name: '', last_name: '', email: '', phone_number: '' });
  // preview -> payment (modal simulador) -> creating (POST /orders/create) -> /reserva/:id
  const [step, setStep] = useState<'form' | 'preview' | 'payment' | 'creating'>('form');
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
      booker: { country: 'ec' }, currency: 'USD', driver: { age: EDAD_CONDUCTOR },
      route: {
        pickup: { datetime: `${ini}T10:00:00Z`, location: {} },
        dropoff: { datetime: `${fin}T10:00:00Z`, location: {} },
      },
    });
    fechasDelToken.current = { ini, fin };
    setSearchToken(res.search_token);
    return res.search_token;
  };

  const previsualizar = async () => {
    setError(''); setLoading(true);
    try {
      if (!user) { nav('/login'); return; }
      if (!v) return;
      const tok = await asegurarSearchToken();
      const hold = await orders.hold(v.vehicle_id, tok, EDAD_CONDUCTOR);
      const prev = await orders.preview(v.vehicle_id, tok, hold.hold_id, extras);
      setPreview(prev);
      setStep('preview');
    } catch (e: any) {
      setError(e?.message || 'Error al preparar la reserva');
    } finally { setLoading(false); }
  };

  /** "Confirmar reserva" abre el simulador de pago; la orden se crea al pagar. */
  const abrirPago = () => { setError(''); setStep('payment'); };

  /** Llamado por el simulador con un payment_reference valido. Si falla, el modal muestra el error. */
  const pagarYCrear = async (paymentReference: string) => {
    if (!preview) return;
    setStep('creating');
    try {
      const orden = await orders.create(preview.data.order_preview_id, paymentReference, driver);
      // Guardar order_id en localStorage para que MisReservas del cliente lo recupere
      const prev: string[] = JSON.parse(localStorage.getItem('rf_myorders') || '[]');
      if (!prev.includes(orden.order_id)) prev.unshift(orden.order_id);
      localStorage.setItem('rf_myorders', JSON.stringify(prev.slice(0, 50)));
      nav(`/reserva/${orden.order_id}`);
    } catch (e: any) {
      setStep('payment');
      throw new Error(e?.message || 'Error al crear la reserva');
    }
  };

  if (!v) return <div className="container" style={{ padding: '2rem 1rem' }}>Cargando...</div>;

  return (
    <div className="container" style={{ padding: '2rem 1rem' }}>
      <button className="btn btn-ghost btn-sm mb-2" onClick={() => nav(-1)}>&larr; Volver</button>

      <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'minmax(280px, 1.4fr) minmax(260px, 1fr)' }} className="detalle-grid">
        {/* Galeria + Info */}
        <div>
          <div style={{ aspectRatio: '16 / 10', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--media-bg)' }}>
            <img src={imagenes[imgActiva]} alt={`${v.make} ${v.model}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          {PHOTO_CREDITS[imagenes[imgActiva]] && (
            <div className="text-muted" style={{ fontSize: '0.72rem', marginTop: '0.35rem', textAlign: 'right' }}>
              Foto: {PHOTO_CREDITS[imagenes[imgActiva]].author} &middot;{' '}
              <a href={PHOTO_CREDITS[imagenes[imgActiva]].source} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
                {PHOTO_CREDITS[imagenes[imgActiva]].license}
              </a>, Wikimedia Commons
            </div>
          )}
          {imagenes.length > 1 && (
            <div style={{
              display: 'grid', gap: '0.5rem', marginTop: '0.5rem',
              gridTemplateColumns: 'repeat(5, 1fr)',
            }}>
              {imagenes.map((img, i) => (
                <button key={i} type="button" onClick={() => setImgActiva(i)}
                  aria-label={`Ver foto ${i + 1} de ${imagenes.length}`} aria-pressed={imgActiva === i} style={{
                  aspectRatio: '4 / 3', borderRadius: 8, overflow: 'hidden',
                  border: imgActiva === i ? '2px solid var(--strong)' : '1px solid var(--border)', opacity: imgActiva === i ? 1 : 0.75,
                  padding: 0, cursor: 'pointer',
                }}>
                  <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </button>
              ))}
            </div>
          )}

          <div style={{ marginTop: '1.5rem' }}>
            <div className="eyebrow">{ETIQUETA_CATEGORIA[v.car_type] || v.car_type}</div>
            <h1 style={{ margin: '0.25rem 0 0' }}>{v.make} {v.model}</h1>
            <div className="text-muted">
              {v.year} &middot; {v.color}
            </div>

            <div className="mt-2" style={{
              display: 'grid', gap: '0.5rem',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            }}>
              <Feature label="Pasajeros" value={String(v.seats)} />
              <Feature label="Puertas" value={String(v.doors)} />
              <Feature label="Maletas" value={String(v.bag_capacity)} />
              <Feature label="Transmisión" value={v.transmission === 'automatica' ? 'Automática' : v.transmission} />
              <Feature label="Combustible" value={v.fuel_type === 'hibrido' ? 'Híbrido' : v.fuel_type === 'diesel' ? 'Diésel' : v.fuel_type} />
              <Feature label="AC" value={v.air_conditioning ? 'Sí' : 'No'} />
            </div>

            {v.description && (
              <div className="mt-3">
                <h3>Descripción</h3>
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
          <div className="card" style={{ position: 'sticky', top: '84px', borderTop: '3px solid var(--brand)' }}>
            <div className="card-body">
              {step === 'form' && (
                <>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
                    <span className="price" style={{ fontSize: '1.9rem' }}>
                      ${Number(v.price_per_day).toFixed(2)}
                    </span>
                    <span className="text-muted">/ día</span>
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
                    <div className="summary">
                      <div className="flex-between"><span>Días</span><span>{dias}</span></div>
                      <div className="flex-between"><span>Vehículo</span><span>${(dias * Number(v.price_per_day)).toFixed(2)}</span></div>
                      {extras.length > 0 && (
                        <div className="flex-between"><span>Extras ({extras.length})</span><span>${(extras.length * 5 * dias).toFixed(2)}</span></div>
                      )}
                      <div className="flex-between summary-total">
                        <span>Subtotal</span><span>${precioEstimado.toFixed(2)}</span>
                      </div>
                      <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                        (impuestos calculados en el siguiente paso)
                      </div>
                    </div>
                  )}

                  <button className="btn btn-primary btn-block" onClick={previsualizar} disabled={loading || dias <= 0}>
                    {loading ? 'Bloqueando...' : user ? 'Continuar' : 'Ingresar para reservar'}
                  </button>
                </>
              )}

              {step !== 'form' && preview && (
                <>
                  <h3 style={{ marginTop: 0 }}>Confirmar reserva</h3>
                  <div className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                    Preview ID: <code>{preview.data.order_preview_id}</code>
                  </div>

                  {error && <div className="alert alert-danger">{error}</div>}

                  <div className="summary">
                    {Object.entries(preview.data.breakdown).map(([k, val]) => (
                      <div key={k} className="flex-between">
                        <span>{ETIQUETAS_DESGLOSE[k] || k}</span><span>{k === 'days' ? String(val) : typeof val === 'number' ? `$${Number(val).toFixed(2)}` : String(val)}</span>
                      </div>
                    ))}
                    <div className="flex-between summary-total">
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
                    <label className="form-label">Teléfono</label>
                    <input className="form-control" value={driver.phone_number}
                      onChange={(e) => setDriver({ ...driver, phone_number: e.target.value })} />
                  </div>
                  <button className="btn btn-primary btn-block" onClick={abrirPago}
                    disabled={step !== 'preview' || !driver.first_name || !driver.last_name || !driver.email}>
                    Confirmar reserva
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

      {(step === 'payment' || step === 'creating') && preview && (
        <PaymentSimulatorModal
          total={preview.data.total_price}
          currency={preview.data.currency}
          onPay={pagarYCrear}
          onClose={() => setStep('preview')}
        />
      )}

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
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)', padding: '0.6rem 0.85rem',
    }}>
      <div className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: '0.95rem', textTransform: 'capitalize' }}>{value}</div>
    </div>
  );
}

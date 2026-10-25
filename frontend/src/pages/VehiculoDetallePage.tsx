import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { account, catalog } from '../api';
import { autosV2, FRANJAS_30_MIN, ordenesV2, uuidv4 } from '../api/clientV2';
import { filtrarDigitos, filtrarEmail, filtrarNombre, filtrarTelefono, msgEmail, msgNombre, msgTelefono, sinErrores } from '../utils/validaciones';
import type { VehicleDetail } from '../types';
import type { CoberturaOpcion, TipoCobertura } from '../types/v2';
import { useAuth } from '../context/AuthContext';
import { PHOTO_CREDITS } from '../data/photoCredits';
import { ETIQUETA_CATEGORIA } from '../components/VehiculoCard';
import PaymentSimulatorModal from '../components/PaymentSimulatorModal';
import FechaError from '../components/FechaError';
import { enDias, etiqueta, hayErrores, hoy, validarFechas } from '../utils/reservas';
import { useFranjaVigente } from '../utils/v2';

/** Recargo del contrato v2 para conductores menores de 25 o mayores de 70 años (USD por día). */
const RECARGO_EDAD_DIARIO = 10;

/** Coberturas por defecto mientras responde GET /api/v2/autos/{id}/coberturas. */
const COBERTURAS_DEFECTO: CoberturaOpcion[] = [
  { tipo: 'BASICA', nombre: 'Protección Básica (Incluida)', costo_adicional_diario: 0, franquicia: 1200, deposito_garantia: 500, descripcion: '', beneficios: [] },
  { tipo: 'TOTAL', nombre: 'Cobertura Total / Protección Premium', costo_adicional_diario: 18, franquicia: 0, deposito_garantia: 0, descripcion: '', beneficios: [] },
];

/** Días facturados igual que el backend: bloques de 24 h desde la franja de recogida, redondeando hacia arriba. */
function diasFacturados(ini: string, hIni: string, fin: string, hFin: string): number {
  const a = Date.parse(`${ini}T${hIni}:00-05:00`), b = Date.parse(`${fin}T${hFin}:00-05:00`);
  if (isNaN(a) || isNaN(b) || b <= a) return 0;
  return Math.max(1, Math.ceil((b - a) / 86_400_000));
}

function msgEdad(v: string): string | undefined {
  if (!v) return 'La edad es obligatoria';
  const n = Number(v);
  if (!Number.isInteger(n) || n > 99) return 'Ingresa una edad válida';
  if (n < 18) return 'La edad mínima para rentar es 18 años';
  return undefined;
}

const soloLicencia = (x: string) => x.replace(/[^A-Za-z0-9-]/g, '');
const soloEdad = (x: string) => filtrarDigitos(x, 2);

/** Campos del formulario del conductor: [clave, etiqueta, autocomplete, maxLength, filtro, type]. */
const CAMPOS_CONDUCTOR = [
  ['first_name', 'Nombre *', 'given-name', 60, filtrarNombre, 'text'],
  ['last_name', 'Apellido *', 'family-name', 60, filtrarNombre, 'text'],
  ['email', 'Correo electrónico *', 'email', 160, filtrarEmail, 'email'],
  ['phone_number', 'Teléfono *', 'tel', 20, filtrarTelefono, 'tel'],
  ['licencia', 'Licencia de conducir *', 'off', 20, soloLicencia, 'text'],
  ['edad', 'Edad del conductor *', 'off', 2, soloEdad, 'text'],
] as const;

export default function VehiculoDetallePage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { user } = useAuth();

  const [v, setV] = useState<VehicleDetail | null>(null);
  const [imgActiva, setImgActiva] = useState(0);
  const [ini, setIni] = useState(params.get('ini') || hoy());
  const [fin, setFin] = useState(params.get('fin') || enDias(3));
  const [horaIni, setHoraIni] = useState(params.get('hIni') || '10:00');
  const [horaFin, setHoraFin] = useState(params.get('hFin') || '10:00');
  const [coberturas, setCoberturas] = useState<CoberturaOpcion[]>(COBERTURAS_DEFECTO);
  const [cobertura, setCobertura] = useState<TipoCobertura>('BASICA');

  const [driver, setDriver] = useState({ first_name: '', last_name: '', email: '', phone_number: '', licencia: '', edad: '' });
  // form -> datos (conductor) -> payment (modal simulador) -> creating (POST /api/v2/autos/orders/create) -> /reserva/:id
  const [step, setStep] = useState<'form' | 'datos' | 'payment' | 'creating'>('form');
  const [error, setError] = useState('');
  // Una Idempotency-Key por intento de compra: si la red falla y el cliente reintenta, no se duplica la reserva
  const claveCompra = useRef(uuidv4());

  useEffect(() => {
    if (!id) return;
    catalog.details([id]).then((r) => {
      const d = r.data[0];
      if (d) setV(d);
    }).catch(() => {});
    autosV2.coberturas(id).then((r) => setCoberturas(r.opciones)).catch(() => {});
  }, [id]);

  // Autollenado: los datos del conductor se toman del perfil del usuario (siguen siendo editables).
  // Solo se completan los campos vacíos, para no pisar lo que el usuario ya haya escrito.
  const [autollenado, setAutollenado] = useState(false);
  useEffect(() => {
    if (!user) return;
    account.profile().then((p) => {
      setDriver((d) => ({
        ...d,
        first_name: d.first_name || p.first_name || '',
        last_name: d.last_name || p.last_name || '',
        email: d.email || p.email || user.email,
        phone_number: d.phone_number || p.phone || '',
      }));
      setAutollenado(true);
    }).catch(() => setDriver((d) => ({ ...d, email: d.email || user.email })));
  }, [user]);

  // Validación del formulario del conductor (mismas reglas que el backend)
  const errDriver: Record<string, string | undefined> = {
    first_name: msgNombre(driver.first_name, 'El nombre'),
    last_name: msgNombre(driver.last_name, 'El apellido'),
    email: msgEmail(driver.email),
    phone_number: msgTelefono(driver.phone_number, true),
    licencia: /^[A-Za-z0-9-]{5,20}$/.test(driver.licencia) ? undefined : 'Número de licencia de 5 a 20 caracteres',
    edad: msgEdad(driver.edad),
  };
  const driverValido = sinErrores(errDriver);
  const [tocado, setTocado] = useState<Record<string, boolean>>({});
  const tocar = (k: string) => setTocado((t) => ({ ...t, [k]: true }));

  const imagenes = (v?.images && v.images.length > 0) ? v.images : [v?.main_image_url || ''];

  const franjasIni = useFranjaVigente(ini, horaIni, setHoraIni);
  const errFechas = validarFechas(ini, fin);
  if (!errFechas.ini && franjasIni.length === 0) errFechas.ini = 'Ya no quedan franjas de recogida hoy; elige otra fecha';
  const dias = hayErrores(errFechas) ? 0 : diasFacturados(ini, horaIni, fin, horaFin);
  const fechasInvalidas = dias === 0;
  const opcion = coberturas.find((c) => c.tipo === cobertura);
  const edadNum = Number(driver.edad);
  const recargo = driver.edad && !errDriver.edad && (edadNum < 25 || edadNum > 70) ? RECARGO_EDAD_DIARIO * dias : 0;
  const base = v ? dias * Number(v.price_per_day) : 0;
  const costoCobertura = (opcion?.costo_adicional_diario ?? 0) * dias;
  const total = base + costoCobertura + recargo;

  const continuar = () => {
    setError('');
    if (!user) { nav('/login', { state: { from: window.location.pathname + window.location.search } }); return; }
    if (!v || fechasInvalidas) return;
    setStep('datos');
  };

  /** "Confirmar reserva" abre el simulador de pago; la orden se crea al pagar. */
  const abrirPago = () => {
    setTocado({ first_name: true, last_name: true, email: true, phone_number: true, licencia: true, edad: true });
    if (!driverValido) return;
    setError(''); setStep('payment');
  };

  /** Llamado por el simulador con un payment_reference valido. Si falla, el modal muestra el error. */
  const pagarYCrear = async (paymentReference: string) => {
    if (!v) return;
    setStep('creating');
    try {
      const orden = await ordenesV2.crear({
        vehicle_id: v.vehicle_id,
        pickup_date: ini, dropoff_date: fin, hora_recogida: horaIni, hora_devolucion: horaFin,
        tipo_cobertura: cobertura,
        pickup_location: v.depot?.name,
        payment_reference: paymentReference,
        conductor: {
          nombre: `${driver.first_name} ${driver.last_name}`.trim(),
          email: driver.email, telefono: driver.phone_number, licencia_conducir: driver.licencia, edad: edadNum,
        },
      }, claveCompra.current);
      nav(`/reserva/${orden.order_id}`);
    } catch (e: any) {
      setStep('payment');
      // Rechazo de negocio (409 auto tomado o en limpieza, 422 edad): la siguiente compra usa otra clave
      if (e?.response?.status && e.response.status < 500) claveCompra.current = uuidv4();
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
              <Feature label="Transmisión" value={etiqueta(v.transmission)} />
              <Feature label="Combustible" value={etiqueta(v.fuel_type)} />
              <Feature label="Aire acondicionado" value={v.air_conditioning ? 'Sí' : 'No'} />
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

        {/* Reserva (contrato v2: franjas de 30 min + cobertura) */}
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

                  <div className="mt-2" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '0.5rem' }}>
                    <div>
                      <label className="form-label" htmlFor="det-ini">Recogida</label>
                      <input id="det-ini" type="date" className="form-control" min={hoy()}
                        value={ini} onChange={(e) => setIni(e.target.value)}
                        aria-invalid={!!errFechas.ini} aria-describedby={errFechas.ini ? 'det-ini-err' : undefined} />
                    </div>
                    <div>
                      <label className="form-label" htmlFor="det-hini">Hora</label>
                      <select id="det-hini" className="form-control" value={horaIni} onChange={(e) => setHoraIni(e.target.value)}>
                        {franjasIni.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  </div>
                  <FechaError id="det-ini-err" mensaje={errFechas.ini} />
                  <div className="mt-1" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '0.5rem' }}>
                    <div>
                      <label className="form-label" htmlFor="det-fin">Devolución</label>
                      <input id="det-fin" type="date" className="form-control" min={ini || hoy()}
                        max={ini ? enDias(90, new Date(`${ini}T00:00:00`)) : undefined}
                        value={fin} onChange={(e) => setFin(e.target.value)}
                        aria-invalid={!!errFechas.fin} aria-describedby={errFechas.fin ? 'det-fin-err' : undefined} />
                    </div>
                    <div>
                      <label className="form-label" htmlFor="det-hfin">Hora</label>
                      <select id="det-hfin" className="form-control" value={horaFin} onChange={(e) => setHoraFin(e.target.value)}>
                        {FRANJAS_30_MIN.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  </div>
                  <FechaError id="det-fin-err" mensaje={errFechas.fin} />
                  <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                    Horarios en franjas de 30 minutos (hora de Ecuador).
                  </div>

                  <fieldset style={{ border: 0, padding: 0, margin: '1rem 0' }}>
                    <legend className="form-label">Cobertura</legend>
                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                      {coberturas.map((c) => (
                        <label key={c.tipo} style={{
                          display: 'flex', gap: '0.6rem', alignItems: 'flex-start', cursor: 'pointer', fontSize: '0.88rem',
                          border: cobertura === c.tipo ? '2px solid var(--brand)' : '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)', padding: '0.6rem 0.75rem',
                        }}>
                          <input type="radio" name="cobertura" value={c.tipo} checked={cobertura === c.tipo}
                            onChange={() => setCobertura(c.tipo)} style={{ marginTop: 3 }} />
                          <span>
                            <b>{c.nombre}</b>{' '}
                            <span className="text-muted">{c.costo_adicional_diario > 0 ? `+$${c.costo_adicional_diario.toFixed(2)}/día` : 'incluida ($0)'}</span>
                            <span className="text-muted" style={{ display: 'block', fontSize: '0.78rem' }}>
                              Franquicia ${c.franquicia.toFixed(2)} · Depósito ${c.deposito_garantia.toFixed(2)}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  {dias > 0 && (
                    <div className="summary">
                      <div className="flex-between"><span>Días</span><span>{dias}</span></div>
                      <div className="flex-between"><span>Vehículo</span><span>${base.toFixed(2)}</span></div>
                      {costoCobertura > 0 && <div className="flex-between"><span>Cobertura total</span><span>${costoCobertura.toFixed(2)}</span></div>}
                      <div className="flex-between summary-total">
                        <span>Total estimado</span><span>${(base + costoCobertura).toFixed(2)}</span>
                      </div>
                      <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                        Impuestos incluidos. Conductores menores de 25 o mayores de 70 años pagan ${RECARGO_EDAD_DIARIO}/día de recargo.
                      </div>
                    </div>
                  )}

                  <button className="btn btn-primary btn-block" onClick={continuar} disabled={fechasInvalidas}>
                    {user ? 'Continuar' : 'Ingresar para reservar'}
                  </button>
                </>
              )}

              {step !== 'form' && (
                <>
                  <h3 style={{ marginTop: 0 }}>Datos del conductor</h3>
                  {error && <div className="alert alert-danger">{error}</div>}
                  {autollenado && (
                    <div className="text-muted" style={{ fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                      Datos tomados de tu cuenta; puedes editarlos si reservas para otra persona.
                    </div>
                  )}
                  {CAMPOS_CONDUCTOR.map(([k, label, auto, max, filtro, tipo]) => (
                    <div className="form-group" key={k}>
                      <label className="form-label" htmlFor={`drv-${k}`}>{label}</label>
                      <input id={`drv-${k}`} type={tipo} className="form-control" value={driver[k]} autoComplete={auto} maxLength={max}
                        inputMode={k === 'edad' ? 'numeric' : undefined}
                        onBlur={() => tocar(k)}
                        aria-invalid={tocado[k] && !!errDriver[k]} aria-describedby={tocado[k] && errDriver[k] ? `drv-${k}-err` : undefined}
                        onChange={(e) => setDriver({ ...driver, [k]: filtro(e.target.value) })} />
                      <FechaError id={`drv-${k}-err`} mensaje={tocado[k] ? errDriver[k] : undefined} />
                    </div>
                  ))}

                  <div className="summary">
                    <div className="flex-between"><span>Vehículo ({dias} {dias === 1 ? 'día' : 'días'})</span><span>${base.toFixed(2)}</span></div>
                    <div className="flex-between"><span>{opcion?.nombre ?? cobertura}</span><span>${costoCobertura.toFixed(2)}</span></div>
                    {recargo > 0 && <div className="flex-between"><span>Recargo por edad</span><span>${recargo.toFixed(2)}</span></div>}
                    <div className="flex-between summary-total"><span>Total</span><span>${total.toFixed(2)} USD</span></div>
                    {opcion && opcion.deposito_garantia > 0 && (
                      <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                        Depósito de garantía retenido en mostrador: ${opcion.deposito_garantia.toFixed(2)}
                      </div>
                    )}
                  </div>
                  <button className="btn btn-primary btn-block" onClick={abrirPago} disabled={step !== 'datos'}>
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

      {(step === 'payment' || step === 'creating') && (
        <PaymentSimulatorModal
          total={Number(total.toFixed(2))}
          currency="USD"
          onPay={pagarYCrear}
          onClose={() => setStep('datos')}
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

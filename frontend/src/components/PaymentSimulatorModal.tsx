import { useEffect, useId, useRef, useState } from 'react';

/**
 * Simulador de pago previo a POST /orders/create.
 * El contrato (info.description) deja la logica de pagos a otros dominios: aqui solo se
 * valida la tarjeta en el cliente (Luhn, expiracion, CVV) y se genera un payment_reference
 * "PAY-SIM-xxxxxxxxxx". Nunca se envian los datos de la tarjeta al backend.
 */

export const TARJETA_PRUEBA = { numero: '4111 1111 1111 1111', titular: 'MARIA PRUEBA', expiracion: '12/30', cvv: '123' };
const PROCESAMIENTO_MS = 2000;

interface Props {
  total: number;
  currency: string;
  /** Crea la orden con la referencia dada; si lanza, el error se muestra en el modal. */
  onPay: (paymentReference: string) => Promise<void>;
  onClose: () => void;
}

type Errores = Partial<Record<'numero' | 'titular' | 'expiracion' | 'cvv', string>>;

/** Algoritmo de Luhn (mod 10) sobre los digitos de la tarjeta. */
export function luhnValido(digitos: string): boolean {
  if (!/^\d+$/.test(digitos)) return false;
  let suma = 0;
  for (let i = 0; i < digitos.length; i++) {
    let d = Number(digitos[digitos.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    suma += d;
  }
  return suma % 10 === 0;
}

/** MM/AA valida y no vencida (la tarjeta vale hasta el ultimo dia de ese mes). */
export function expiracionValida(valor: string, hoy = new Date()): boolean {
  const m = /^(\d{2})\/(\d{2})$/.exec(valor);
  if (!m) return false;
  const mes = Number(m[1]), anio = 2000 + Number(m[2]);
  if (mes < 1 || mes > 12) return false;
  return new Date(anio, mes, 1) > hoy; // primer dia del mes siguiente
}

const mascaraTarjeta = (v: string) => v.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
const mascaraExpiracion = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};
const referenciaSimulada = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return 'PAY-SIM-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
};

export default function PaymentSimulatorModal({ total, currency, onPay, onClose }: Props) {
  const uid = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const primerCampoRef = useRef<HTMLInputElement>(null);
  const [numero, setNumero] = useState('');
  const [titular, setTitular] = useState('');
  const [expiracion, setExpiracion] = useState('');
  const [cvv, setCvv] = useState('');
  const [errores, setErrores] = useState<Errores>({});
  const [errorPago, setErrorPago] = useState('');
  const [procesando, setProcesando] = useState(false);

  // Al abrir: foco al primer campo, bloquear el scroll del fondo y, al cerrar,
  // devolver el foco al elemento que abrio el modal.
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    primerCampoRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; previo?.focus?.(); };
  }, []);

  // Escape cierra (salvo mientras se procesa) y Tab no sale del modal (focus trap)
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!procesando) onClose();
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    if (focusables.length === 0) { e.preventDefault(); return; }
    const primero = focusables[0], ultimo = focusables[focusables.length - 1];
    if (e.shiftKey && (document.activeElement === primero || !dialogRef.current.contains(document.activeElement))) {
      e.preventDefault(); ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault(); primero.focus();
    }
  };

  const validar = (): Errores => {
    const err: Errores = {};
    const digitos = numero.replace(/\s/g, '');
    if (digitos.length !== 16) err.numero = 'Debe tener 16 dígitos';
    else if (!luhnValido(digitos)) err.numero = 'Número de tarjeta inválido';
    if (titular.trim().length < 3) err.titular = 'Mínimo 3 caracteres';
    if (!/^\d{2}\/\d{2}$/.test(expiracion)) err.expiracion = 'Formato MM/AA';
    else if (!expiracionValida(expiracion)) err.expiracion = 'Fecha inválida o vencida';
    if (!/^\d{3}$/.test(cvv)) err.cvv = 'Deben ser 3 dígitos';
    return err;
  };

  const pagar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorPago('');
    const err = validar();
    setErrores(err);
    if (Object.keys(err).length > 0) {
      // Llevar el foco al primer campo con error una vez React pinte aria-invalid
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setProcesando(true);
    try {
      await new Promise((r) => setTimeout(r, PROCESAMIENTO_MS));
      await onPay(referenciaSimulada());
    } catch (ex: any) {
      setErrorPago(ex?.message || 'No se pudo completar el pago. Intente de nuevo.');
      setProcesando(false);
    }
  };

  const usarPrueba = () => {
    setNumero(TARJETA_PRUEBA.numero); setTitular(TARJETA_PRUEBA.titular);
    setExpiracion(TARJETA_PRUEBA.expiracion); setCvv(TARJETA_PRUEBA.cvv);
    setErrores({});
  };

  const campo = (
    key: keyof Errores, label: string, input: React.ReactElement,
  ) => (
    <div className="form-group" style={{ marginBottom: '0.85rem' }}>
      <label className="form-label" htmlFor={`${uid}-${key}`}>{label}</label>
      {input}
      {errores[key] && (
        <div id={`${uid}-${key}-err`} className="pay-err" role="alert">{errores[key]}</div>
      )}
    </div>
  );
  const a11y = (key: keyof Errores) => ({
    id: `${uid}-${key}`,
    'aria-invalid': errores[key] ? true : undefined,
    'aria-describedby': errores[key] ? `${uid}-${key}-err` : undefined,
    disabled: procesando,
  });

  return (
    <div className="pay-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !procesando) onClose(); }}>
      <div ref={dialogRef} className="pay-dialog card" role="dialog" aria-modal="true"
        aria-labelledby={`${uid}-titulo`} onKeyDown={onKeyDown}>
        <form onSubmit={pagar} noValidate className="card-body">
          <div id={`${uid}-titulo`} className="eyebrow">Pago de la reserva</div>
          <div className="pay-total">Pagar ${total.toFixed(2)} {currency}</div>

          <div className="pay-banner" role="note">
            ⚠️ Modo simulador — ningún cargo real se procesa. Para pruebas use: 4111 1111 1111 1111 / 12/30 / CVV 123
          </div>
          <button type="button" className="btn btn-outline btn-sm mb-2" onClick={usarPrueba} disabled={procesando}>
            Usar tarjeta de prueba
          </button>

          {campo('numero', 'Número de tarjeta',
            <input ref={primerCampoRef} className="form-control" inputMode="numeric" autoComplete="cc-number"
              placeholder="0000 0000 0000 0000" value={numero}
              onChange={(e) => setNumero(mascaraTarjeta(e.target.value))} {...a11y('numero')} />)}
          {campo('titular', 'Nombre del titular',
            <input className="form-control" autoComplete="cc-name" placeholder="Como aparece en la tarjeta"
              value={titular} onChange={(e) => setTitular(e.target.value)} {...a11y('titular')} />)}
          <div className="pay-row">
            {campo('expiracion', 'Fecha de expiración',
              <input className="form-control" inputMode="numeric" autoComplete="cc-exp" placeholder="MM/AA"
                value={expiracion} onChange={(e) => setExpiracion(mascaraExpiracion(e.target.value))} {...a11y('expiracion')} />)}
            {campo('cvv', 'CVV',
              <input className="form-control" inputMode="numeric" autoComplete="cc-csc" placeholder="123"
                type="password" value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, 3))} {...a11y('cvv')} />)}
          </div>

          {errorPago && <div className="alert alert-danger" role="alert">{errorPago}</div>}

          <div aria-live="polite">
            {procesando && (
              <div className="pay-processing"><span className="pay-spinner" aria-hidden="true" /> Procesando pago...</div>
            )}
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={procesando}>
            {procesando ? 'Procesando pago...' : 'Pagar ahora'}
          </button>
          <button type="button" className="btn btn-outline btn-block mt-1" onClick={onClose} disabled={procesando}>
            Cancelar
          </button>
        </form>
      </div>

      <style>{`
        .pay-backdrop {
          position: fixed; inset: 0; z-index: 50; background: rgba(11, 13, 16, 0.7);
          display: flex; align-items: center; justify-content: center; padding: 1rem;
          overflow-y: auto;
        }
        .pay-dialog { width: 100%; max-width: 440px; box-shadow: var(--shadow-lg); margin: auto; }
        .pay-total { font-size: 1.9rem; font-weight: 800; letter-spacing: -0.02em; color: var(--strong); margin: 0.2rem 0 0.9rem; }
        .pay-banner {
          background: var(--warning-bg); color: var(--warning); border: 1px solid var(--brand-border);
          border-radius: var(--radius-sm); padding: 0.65rem 0.8rem; font-size: 0.82rem; margin-bottom: 0.6rem;
        }
        .pay-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
        .pay-err { color: var(--danger); font-size: 0.8rem; margin-top: 0.3rem; }
        .form-control[aria-invalid="true"] { border-color: var(--danger); }
        .pay-processing { display: flex; align-items: center; gap: 0.6rem; justify-content: center; margin-bottom: 0.75rem; font-weight: 600; }
        .pay-spinner {
          width: 18px; height: 18px; border-radius: 50%;
          border: 3px solid var(--border); border-top-color: var(--brand);
          animation: pay-spin 0.8s linear infinite;
        }
        @keyframes pay-spin { to { transform: rotate(360deg); } }
        @media (max-width: 640px) {
          .pay-backdrop { padding: 0.5rem; }
          .pay-dialog { width: 95%; max-width: none; }
          .pay-total { font-size: 1.6rem; }
        }
      `}</style>
    </div>
  );
}

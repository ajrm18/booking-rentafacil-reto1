import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  filtrarDigitos, filtrarEmail, filtrarNombre, filtrarTelefono, msgCedula, msgEmail, msgNombre, msgTelefono,
} from '../utils/validaciones';

const MIN_PASSWORD = 8;

const vacio = { first_name: '', last_name: '', email: '', phone: '', national_id: '', password: '', password2: '' };
type Form = typeof vacio;
type Errores = Partial<Record<keyof Form, string>>;

/**
 * Registro público de clientes (POST /auth/register): mismos campos y reglas que "Nuevo cliente"
 * del panel de administración, sin elegir rol. Al terminar, la sesión queda iniciada.
 */
export default function RegistroPage() {
  const { register } = useAuth();
  const nav = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [form, setForm] = useState<Form>(vacio);
  const [errores, setErrores] = useState<Errores>({});
  const [errorApi, setErrorApi] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [verPassword, setVerPassword] = useState(false);

  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const validar = (): Errores => {
    const e: Errores = {};
    e.first_name = msgNombre(form.first_name, 'El nombre');
    e.last_name = msgNombre(form.last_name, 'El apellido');
    e.email = msgEmail(form.email);
    e.phone = msgTelefono(form.phone, true);
    e.national_id = msgCedula(form.national_id, true);
    if (form.password.length < MIN_PASSWORD) e.password = `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`;
    else if (form.password.length > 72) e.password = 'La contraseña no puede superar los 72 caracteres';
    if (!e.password && form.password2 !== form.password) e.password2 = 'Las contraseñas no coinciden';
    (Object.keys(e) as (keyof Errores)[]).forEach((k) => { if (!e[k]) delete e[k]; });
    return e;
  };

  const enviar = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErrorApi('');
    const e = validar(); setErrores(e);
    const primero = Object.keys(e)[0];
    if (primero) { document.getElementById(`reg-${primero}`)?.focus(); return; }
    setGuardando(true);
    try {
      await register({
        first_name: form.first_name.trim(), last_name: form.last_name.trim(), email: form.email.trim(),
        phone: form.phone.trim(), national_id: form.national_id.trim(), password: form.password,
      });
      nav(from || '/catalogo');
    } catch (err: any) {
      setErrorApi(err?.message || 'No se pudo completar el registro');
    } finally { setGuardando(false); }
  };

  const campo = (k: keyof Form, label: string, input: React.ReactElement, ayuda?: string) => (
    <div className="form-group" style={{ marginBottom: '0.8rem' }}>
      <label className="form-label" htmlFor={`reg-${k}`}>{label}</label>
      {input}
      {ayuda && !errores[k] && <div className="text-muted" style={{ fontSize: '0.78rem', marginTop: '0.25rem' }}>{ayuda}</div>}
      {errores[k] && <div id={`reg-${k}-err`} role="alert" style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '0.3rem' }}>{errores[k]}</div>}
    </div>
  );
  const attrs = (k: keyof Form) => ({
    id: `reg-${k}`, className: 'form-control', disabled: guardando,
    'aria-invalid': errores[k] ? true : undefined,
    'aria-describedby': errores[k] ? `reg-${k}-err` : undefined,
  });

  return (
    <div className="container" style={{ padding: '3rem 1rem', maxWidth: 560 }}>
      <div className="card" style={{ borderTop: '3px solid var(--brand)' }}>
        <div className="card-body" style={{ padding: '1.75rem' }}>
          <div className="eyebrow">Mi cuenta</div>
          <h1 style={{ margin: '0.3rem 0 0.5rem' }}>Crear cuenta</h1>
          <p className="text-muted" style={{ marginTop: 0 }}>Regístrate para reservar tu auto. Los campos con * son obligatorios.</p>
          <form onSubmit={enviar} noValidate>
            {errorApi && <div className="alert alert-danger" role="alert">{errorApi}</div>}
            <div className="reg-row">
              {campo('first_name', 'Nombre *', <input {...attrs('first_name')} autoComplete="given-name" maxLength={60} value={form.first_name} onChange={(e) => set('first_name', filtrarNombre(e.target.value))} />)}
              {campo('last_name', 'Apellido *', <input {...attrs('last_name')} autoComplete="family-name" maxLength={60} value={form.last_name} onChange={(e) => set('last_name', filtrarNombre(e.target.value))} />)}
            </div>
            {campo('email', 'Correo electrónico *', <input {...attrs('email')} type="email" autoComplete="email" maxLength={160} value={form.email} onChange={(e) => set('email', filtrarEmail(e.target.value))} />)}
            <div className="reg-row">
              {campo('phone', 'Teléfono *', <input {...attrs('phone')} type="tel" inputMode="tel" autoComplete="tel" placeholder="0983563584" maxLength={20} value={form.phone} onChange={(e) => set('phone', filtrarTelefono(e.target.value))} />)}
              {campo('national_id', 'Cédula *', <input {...attrs('national_id')} inputMode="numeric" placeholder="10 dígitos" value={form.national_id} onChange={(e) => set('national_id', filtrarDigitos(e.target.value, 10))} />)}
            </div>
            {campo('password', 'Contraseña *', (
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <input {...attrs('password')} type={verPassword ? 'text' : 'password'} autoComplete="new-password"
                  maxLength={72} value={form.password} onChange={(e) => set('password', e.target.value)} />
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setVerPassword((v) => !v)}
                  aria-pressed={verPassword} disabled={guardando}>{verPassword ? 'Ocultar' : 'Mostrar'}</button>
              </div>
            ), `Mínimo ${MIN_PASSWORD} caracteres.`)}
            {campo('password2', 'Confirmar contraseña *', (
              <input {...attrs('password2')} type={verPassword ? 'text' : 'password'} autoComplete="new-password"
                maxLength={72} value={form.password2} onChange={(e) => set('password2', e.target.value)} />
            ))}
            <button type="submit" className="btn btn-primary btn-block" disabled={guardando}>
              {guardando ? 'Creando cuenta...' : 'Crear cuenta'}
            </button>
          </form>
          <p className="text-muted mt-2" style={{ fontSize: '0.9rem', textAlign: 'center', marginBottom: 0 }}>
            ¿Ya eres cliente? <Link to="/login" state={{ from }}>Ingresa aquí</Link>
          </p>
          <style>{`
            .reg-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
            @media (max-width: 520px) { .reg-row { grid-template-columns: 1fr; } }
          `}</style>
        </div>
      </div>
    </div>
  );
}

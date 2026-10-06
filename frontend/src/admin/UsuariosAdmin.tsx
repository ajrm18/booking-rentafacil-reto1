import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminUsers } from '../api';
import type { AdminUser, AdminUserInput } from '../types';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/Modal';

const ROLES: Record<AdminUser['role'], string> = { client: 'Cliente', admin: 'Administrador' };
const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const vacio = { first_name: '', last_name: '', email: '', phone: '', national_id: '', role: 'client' as AdminUser['role'], password: '' };
type Form = typeof vacio;
type Errores = Partial<Record<keyof Form, string>>;

/** Contraseña fuerte de 14 caracteres con mayúscula, minúscula, dígito y símbolo garantizados. */
export function generarPassword(largo = 14): string {
  const grupos = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%&*?-_'];
  const todos = grupos.join('');
  const rnd = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const chars = grupos.map((g) => g[rnd(g.length)]);
  while (chars.length < largo) chars.push(todos[rnd(todos.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = rnd(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

async function copiar(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true; } catch { /* sin permiso: alternativa */ }
  const ta = document.createElement('textarea');
  ta.value = texto; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

export default function UsuariosAdmin() {
  const { user: yo } = useAuth();
  const [params, setParams] = useSearchParams();
  const [lista, setLista] = useState<AdminUser[]>([]);
  const [error, setError] = useState('');
  const [editando, setEditando] = useState<AdminUser | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState<Form>(vacio);
  const [errores, setErrores] = useState<Errores>({});
  const [errorApi, setErrorApi] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [verPassword, setVerPassword] = useState(false);
  const [creado, setCreado] = useState<{ email: string; password: string } | null>(null);
  const [copiado, setCopiado] = useState('');

  const cargar = () => adminUsers.list().then(setLista).catch((e) => setError(e?.message || 'Error al cargar usuarios'));
  useEffect(() => { cargar(); }, []);

  // /admin/usuarios?nuevo=1 (botón "+ Nuevo cliente" del panel de control) abre el formulario
  useEffect(() => {
    if (params.get('nuevo') === '1') { abrirNuevo(); setParams({}, { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abrirNuevo = () => {
    setEditando(null); setForm(vacio); setErrores({}); setErrorApi(''); setCreado(null); setCopiado('');
    setVerPassword(false); setAbierto(true);
  };
  const abrirEditar = (u: AdminUser) => {
    setEditando(u);
    setForm({ first_name: u.first_name, last_name: u.last_name, email: u.email, phone: u.phone || '',
      national_id: u.national_id || '', role: u.role, password: '' });
    setErrores({}); setErrorApi(''); setCreado(null); setVerPassword(false); setAbierto(true);
  };
  const cerrar = () => { setAbierto(false); setCreado(null); };
  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const validar = (): Errores => {
    const e: Errores = {};
    if (form.first_name.trim().length < 2) e.first_name = 'El nombre es obligatorio (mínimo 2 caracteres)';
    if (form.last_name.trim().length < 2) e.last_name = 'El apellido es obligatorio (mínimo 2 caracteres)';
    if (!EMAIL_RE.test(form.email.trim())) e.email = 'Ingresa un correo electrónico válido';
    if (form.national_id && !/^\d{10}$/.test(form.national_id.trim())) e.national_id = 'La cédula debe tener 10 dígitos';
    if (!editando && form.password.length < MIN_PASSWORD) e.password = `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`;
    if (editando && form.password && form.password.length < MIN_PASSWORD) e.password = `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`;
    return e;
  };

  const guardar = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErrorApi('');
    const e = validar(); setErrores(e);
    if (Object.keys(e).length > 0) return;
    const datos: AdminUserInput = {
      first_name: form.first_name.trim(), last_name: form.last_name.trim(), email: form.email.trim(),
      phone: form.phone.trim() || null, national_id: form.national_id.trim() || null, role: form.role,
      ...(form.password && { password: form.password }),
    };
    setGuardando(true);
    try {
      if (editando) {
        await adminUsers.update(editando.user_id, datos);
        setAbierto(false);
      } else {
        const u = await adminUsers.create(datos);
        setCreado({ email: u.email, password: form.password }); // se muestran una sola vez
      }
      cargar();
    } catch (err: any) {
      setErrorApi(err?.message || 'No se pudo guardar el usuario');
    } finally { setGuardando(false); }
  };

  const eliminar = async (u: AdminUser) => {
    if (!confirm(`¿Eliminar a ${u.first_name} ${u.last_name} (${u.email})?`)) return;
    try { await adminUsers.remove(u.user_id); cargar(); }
    catch (e: any) { alert(e?.message || 'Error'); }
  };

  const copiarCredenciales = async () => {
    if (!creado) return;
    const ok = await copiar(`Email: ${creado.email}\nContraseña: ${creado.password}`);
    setCopiado(ok ? 'Credenciales copiadas al portapapeles' : 'No se pudo copiar; cópialas manualmente');
  };

  const campo = (k: keyof Form, label: string, input: React.ReactElement, ayuda?: string) => (
    <div className="form-group" style={{ marginBottom: '0.8rem' }}>
      <label className="form-label" htmlFor={`usr-${k}`}>{label}</label>
      {input}
      {ayuda && !errores[k] && <div className="text-muted" style={{ fontSize: '0.78rem', marginTop: '0.25rem' }}>{ayuda}</div>}
      {errores[k] && <div id={`usr-${k}-err`} role="alert" style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '0.3rem' }}>{errores[k]}</div>}
    </div>
  );
  const attrs = (k: keyof Form) => ({
    id: `usr-${k}`, className: 'form-control', disabled: guardando,
    'aria-invalid': errores[k] ? true : undefined,
    'aria-describedby': errores[k] ? `usr-${k}-err` : undefined,
  });

  return (
    <div>
      <div className="flex-between mb-2">
        <h1 style={{ margin: 0 }}>Usuarios</h1>
        <button className="btn btn-primary" onClick={abrirNuevo}>+ Nuevo cliente</button>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="table-wrapper">
        <table className="table">
          <thead><tr>
            <th>Nombre</th><th>Apellido</th><th>Correo electrónico</th><th>Rol</th><th>Teléfono</th><th>Fecha de creación</th><th>Acciones</th>
          </tr></thead>
          <tbody>
            {lista.map((u) => (
              <tr key={u.user_id}>
                <td><b>{u.first_name}</b></td>
                <td>{u.last_name}</td>
                <td>{u.email}</td>
                <td><span className={`badge ${u.role === 'admin' ? '' : 'badge-muted'}`}>{ROLES[u.role]}</span></td>
                <td>{u.phone || '—'}</td>
                <td>{new Date(u.created_at).toLocaleDateString('es-EC')}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => abrirEditar(u)}>Editar</button>{' '}
                  <button className="btn btn-danger btn-sm" onClick={() => eliminar(u)}
                    disabled={u.email === yo?.email} title={u.email === yo?.email ? 'No puedes eliminar tu propia cuenta' : undefined}>
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {abierto && (
        <Modal titulo={creado ? 'Cliente creado' : editando ? 'Editar usuario' : 'Nuevo cliente'} onClose={cerrar} bloqueado={guardando}>
          {creado ? (
            <div>
              <div className="alert alert-success">El usuario se creó correctamente. Comparte estas credenciales con el cliente:</div>
              <div className="summary" style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '0.95rem' }}>
                <div>Email: <b>{creado.email}</b></div>
                <div>Contraseña: <b>{creado.password}</b></div>
              </div>
              <div aria-live="polite" className="text-muted mb-1" style={{ fontSize: '0.85rem', minHeight: '1.2em' }}>{copiado}</div>
              <button type="button" className="btn btn-primary btn-block" onClick={copiarCredenciales}>Copiar credenciales</button>
              <button type="button" className="btn btn-outline btn-block mt-1" onClick={cerrar}>Cerrar</button>
            </div>
          ) : (
            <form onSubmit={guardar} noValidate>
              {errorApi && <div className="alert alert-danger" role="alert">{errorApi}</div>}
              <div className="usr-row">
                {campo('first_name', 'Nombre *', <input {...attrs('first_name')} autoComplete="off" value={form.first_name} onChange={(e) => set('first_name', e.target.value)} />)}
                {campo('last_name', 'Apellido *', <input {...attrs('last_name')} autoComplete="off" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />)}
              </div>
              {campo('email', 'Correo electrónico *', <input {...attrs('email')} type="email" autoComplete="off" value={form.email} onChange={(e) => set('email', e.target.value)} />)}
              <div className="usr-row">
                {campo('phone', 'Teléfono', <input {...attrs('phone')} inputMode="tel" placeholder="+593 99 000 0000" value={form.phone} onChange={(e) => set('phone', e.target.value)} />)}
                {campo('national_id', 'Cédula', <input {...attrs('national_id')} inputMode="numeric" placeholder="10 dígitos" value={form.national_id} onChange={(e) => set('national_id', e.target.value.replace(/\D/g, '').slice(0, 10))} />)}
              </div>
              {campo('role', 'Rol', (
                <select {...attrs('role')} value={form.role} onChange={(e) => set('role', e.target.value)}>
                  <option value="client">Cliente</option>
                  <option value="admin">Administrador</option>
                </select>
              ))}
              {campo('password', editando ? 'Nueva contraseña' : 'Contraseña *', (
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <input {...attrs('password')} type={verPassword ? 'text' : 'password'} autoComplete="new-password"
                    value={form.password} onChange={(e) => set('password', e.target.value)} />
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setVerPassword((v) => !v)}
                    aria-pressed={verPassword} disabled={guardando}>{verPassword ? 'Ocultar' : 'Mostrar'}</button>
                </div>
              ), editando ? 'Déjala vacía para no cambiarla. Mínimo 8 caracteres.' : 'Mínimo 8 caracteres.')}
              <button type="button" className="btn btn-outline btn-sm mb-2" disabled={guardando}
                onClick={() => { set('password', generarPassword()); setVerPassword(true); }}>
                Generar contraseña aleatoria
              </button>
              <button type="submit" className="btn btn-primary btn-block" disabled={guardando}>
                {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear cliente'}
              </button>
              <button type="button" className="btn btn-outline btn-block mt-1" onClick={cerrar} disabled={guardando}>Cancelar</button>
            </form>
          )}
          <style>{`
            .usr-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
            @media (max-width: 520px) { .usr-row { grid-template-columns: 1fr; } }
          `}</style>
        </Modal>
      )}
    </div>
  );
}

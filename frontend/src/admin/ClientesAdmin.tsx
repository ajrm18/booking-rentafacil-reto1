import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cliente, clientesV3 } from '../api/clientV3';
import Modal from '../components/Modal';
import { useAuth } from '../context/AuthContext';
import { fechaHoraLocal } from '../utils/v2';

const ORIGEN: Record<string, string> = { BOOKING: 'badge-warning', WEB: 'badge-success', LOCAL: 'badge-muted' };
const vacio = { nombre: '', email: '', identificacion: '', telefono: '', licencia: '' };

/**
 * Clientes cross-platform (db_identity.clientes): listar, buscar, ver, crear y editar. Al crear se
 * usa POST /api/v3/clientes, que devuelve el existente si el email o la cédula ya estaban.
 */
export default function ClientesAdmin() {
  const { user } = useAuth();
  const esAdmin = user?.role === 'admin';
  const [q, setQ] = useState('');
  const [lista, setLista] = useState<Cliente[]>([]);
  const [total, setTotal] = useState(0);
  const [ver, setVer] = useState<Cliente | null>(null);
  const [form, setForm] = useState<typeof vacio | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = (texto = q) => clientesV3.listar(texto).then((r) => { setLista(r.data); setTotal(r.total); }).catch((e) => setMsg({ tipo: 'error', texto: e.message }));
  useEffect(() => { const id = setTimeout(() => cargar(q), 300); return () => clearTimeout(id); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setGuardando(true);
    try {
      const datos = { ...form, telefono: form.telefono || undefined, licencia: form.licencia || undefined };
      if (editId) {
        await clientesV3.actualizar(editId, datos as any);
        setMsg({ tipo: 'ok', texto: 'Cliente actualizado.' });
      } else {
        const r = await clientesV3.crear(datos);
        setMsg(r.status === 201
          ? { tipo: 'ok', texto: `Cliente creado (client_id ${r.data.client_id}).` }
          : { tipo: 'ok', texto: `Ya existía un cliente con ese email o cédula: se reutilizó ${r.data.nombre} (sin duplicar).` });
      }
      setForm(null); setEditId(null); cargar();
    } catch (ex: any) {
      setMsg({ tipo: 'error', texto: ex?.message || 'No se pudo guardar' });
    } finally { setGuardando(false); }
  };

  return (
    <div>
      <div className="flex-between">
        <div>
          <h1 style={{ margin: 0 }}>Clientes</h1>
          <p className="text-muted" style={{ margin: '0.25rem 0 0' }}>Cross-platform con Booking Central: un cliente se reconoce por email o cédula y nunca se duplica.</p>
        </div>
        {esAdmin && <button className="btn btn-primary" onClick={() => { setForm(vacio); setEditId(null); }}>+ Nuevo cliente</button>}
      </div>

      {msg && <div className={`alert ${msg.tipo === 'ok' ? 'alert-success' : 'alert-danger'} mt-2`} role="status">{msg.texto}</div>}

      <div className="card mt-2">
        <div className="card-body">
          <label className="form-label" htmlFor="cli-q">Buscar por nombre, email o cédula</label>
          <input id="cli-q" className="form-control" value={q} onChange={(e) => setQ(e.target.value)} placeholder="juan@example.com · 1710034065 · Juan" />
          <div className="text-muted mt-1" style={{ fontSize: '0.85rem' }}>{total} cliente{total === 1 ? '' : 's'}</div>
        </div>
      </div>

      <div className="table-wrapper mt-2">
        <table className="table">
          <thead><tr><th>Nombre</th><th>Cédula / ID</th><th>Email</th><th>Teléfono</th><th>Origen</th><th>Alta</th><th /></tr></thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={7} className="text-muted">Sin clientes que coincidan.</td></tr>}
            {lista.map((c) => (
              <tr key={c.client_id}>
                <td><b>{c.nombre}</b></td>
                <td><code>{c.identificacion}</code></td>
                <td style={{ overflowWrap: 'anywhere' }}>{c.email}</td>
                <td>{c.telefono ?? '—'}</td>
                <td><span className={`badge ${ORIGEN[c.origen] ?? 'badge-muted'}`}>{c.origen}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>{fechaHoraLocal(c.created_at)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => setVer(c)}>Ver</button>
                  <Link className="btn btn-sm btn-ghost" to={`/admin/mostrador?q=${encodeURIComponent(c.identificacion)}`}>Reservas</Link>
                  {esAdmin && <button className="btn btn-sm btn-outline" onClick={() => {
                    setForm({ nombre: c.nombre, email: c.email, identificacion: c.identificacion, telefono: c.telefono ?? '', licencia: c.licencia ?? '' });
                    setEditId(c.client_id);
                  }}>Editar</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ver && (
        <Modal titulo={ver.nombre} onClose={() => setVer(null)}>
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.4rem 1rem', margin: 0 }}>
            <dt className="text-muted">client_id</dt><dd style={{ margin: 0 }}><code style={{ fontSize: '0.8rem' }}>{ver.client_id}</code></dd>
            <dt className="text-muted">Email</dt><dd style={{ margin: 0 }}>{ver.email}</dd>
            <dt className="text-muted">Cédula / ID</dt><dd style={{ margin: 0 }}>{ver.identificacion}</dd>
            <dt className="text-muted">Teléfono</dt><dd style={{ margin: 0 }}>{ver.telefono ?? '—'}</dd>
            <dt className="text-muted">Licencia</dt><dd style={{ margin: 0 }}>{ver.licencia ?? '—'}</dd>
            <dt className="text-muted">Origen</dt><dd style={{ margin: 0 }}>{ver.origen}</dd>
            <dt className="text-muted">Creado</dt><dd style={{ margin: 0 }}>{fechaHoraLocal(ver.created_at)}</dd>
          </dl>
          <div className="flex mt-2" style={{ justifyContent: 'flex-end' }}>
            <Link className="btn btn-dark" to={`/admin/mostrador?q=${encodeURIComponent(ver.identificacion)}`}>Ver sus reservas en mostrador</Link>
          </div>
        </Modal>
      )}

      {form && (
        <Modal titulo={editId ? 'Editar cliente' : 'Nuevo cliente'} onClose={() => setForm(null)} bloqueado={guardando}>
          <form onSubmit={guardar} noValidate>
            {(['nombre', 'email', 'identificacion', 'telefono', 'licencia'] as const).map((k) => (
              <div className="form-group" key={k}>
                <label className="form-label" htmlFor={`cli-${k}`}>{{ nombre: 'Nombre completo *', email: 'Email *', identificacion: 'Cédula o pasaporte *', telefono: 'Teléfono', licencia: 'Licencia de conducir' }[k]}</label>
                <input id={`cli-${k}`} className="form-control" value={form[k]} type={k === 'email' ? 'email' : 'text'}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </div>
            ))}
            <button className="btn btn-primary btn-block" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

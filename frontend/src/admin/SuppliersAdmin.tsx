import { useEffect, useState } from 'react';
import { admin } from '../api';

export default function SuppliersAdmin() {
  const [lista, setLista] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ name: '', brand: '', description: '' });
  const [editId, setEditId] = useState<number | null>(null);
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');

  const cargar = () => admin.listSuppliers().then(setLista);
  useEffect(() => { cargar(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    try {
      if (editId) await admin.updateSupplier(editId, form);
      else await admin.createSupplier(form);
      setShow(false); cargar();
    } catch (e: any) { setErr(e?.message || 'Error'); }
  };

  const editar = (s: any) => { setForm(s); setEditId(s.supplier_id); setShow(true); };
  const eliminar = async (id: number) => {
    if (!confirm('¿Eliminar este proveedor?')) return;
    try { await admin.deleteSupplier(id); cargar(); }
    catch (e: any) { alert(e?.message || 'Error'); }
  };

  return (
    <div>
      <div className="flex-between mb-2">
        <h1 style={{ margin: 0 }}>Proveedores</h1>
        <button className="btn btn-primary" onClick={() => { setForm({ name: '', brand: '', description: '' }); setEditId(null); setShow(true); }}>+ Nuevo</button>
      </div>

      {show && (
        <div className="card mb-3"><div className="card-body">
          <h3 style={{ marginTop: 0 }}>{editId ? 'Editar' : 'Nuevo'} proveedor</h3>
          {err && <div className="alert alert-danger">{err}</div>}
          <form onSubmit={submit}>
            <div className="form-group">
              <label className="form-label">Nombre</label>
              <input className="form-control" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Marca</label>
              <input className="form-control" value={form.brand || ''} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Descripción</label>
              <textarea className="form-control" rows={2} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-primary" type="submit">{editId ? 'Guardar' : 'Crear'}</button>
              <button className="btn btn-outline" type="button" onClick={() => setShow(false)}>Cancelar</button>
            </div>
          </form>
        </div></div>
      )}

      <div className="table-wrapper">
        <table className="table">
          <thead><tr><th>ID</th><th>Nombre</th><th>Marca</th><th>Descripción</th><th></th></tr></thead>
          <tbody>
            {lista.map((s) => (
              <tr key={s.supplier_id}>
                <td>{s.supplier_id}</td><td><b>{s.name}</b></td>
                <td>{s.brand || '-'}</td><td className="text-muted">{s.description}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => editar(s)}>Editar</button>{' '}
                  <button className="btn btn-danger btn-sm" onClick={() => eliminar(s.supplier_id)}>Eliminar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

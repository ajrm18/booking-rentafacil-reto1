import { useEffect, useState } from 'react';
import { admin } from '../api';

export default function DepotsAdmin() {
  const [lista, setLista] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ name: '', city: '', address: '', airport: '', score: 4.5, active: true });
  const [editId, setEditId] = useState<number | null>(null);
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');

  const cargar = () => admin.listDepots().then(setLista);
  useEffect(() => { cargar(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    try {
      const data = { ...form, score: Number(form.score) };
      if (data.latitude) data.latitude = Number(data.latitude);
      if (data.longitude) data.longitude = Number(data.longitude);
      if (data.city_id) data.city_id = Number(data.city_id);
      if (editId) await admin.updateDepot(editId, data);
      else await admin.createDepot(data);
      setShow(false); cargar();
    } catch (e: any) { setErr(e?.message || 'Error'); }
  };

  const editar = (d: any) => { setForm(d); setEditId(d.depot_id); setShow(true); };
  const eliminar = async (id: number) => {
    if (!confirm('Eliminar agencia?')) return;
    try { await admin.deleteDepot(id); cargar(); }
    catch (e: any) { alert(e?.message || 'Error'); }
  };

  return (
    <div>
      <div className="flex-between mb-2">
        <h1 style={{ margin: 0 }}>Agencias (Depots)</h1>
        <button className="btn btn-primary" onClick={() => { setForm({ name: '', city: '', address: '', airport: '', score: 4.5, active: true }); setEditId(null); setShow(true); }}>+ Nueva</button>
      </div>

      {show && (
        <div className="card mb-3"><div className="card-body">
          <h3 style={{ marginTop: 0 }}>{editId ? 'Editar' : 'Nueva'} agencia</h3>
          {err && <div className="alert alert-danger">{err}</div>}
          <form onSubmit={submit} style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Nombre</label>
              <input className="form-control" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Ciudad</label>
              <input className="form-control" required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
              <label className="form-label">Direccion</label>
              <input className="form-control" value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">IATA (opcional)</label>
              <input className="form-control" value={form.airport || ''} onChange={(e) => setForm({ ...form, airport: e.target.value })} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Score</label>
              <input type="number" step="0.1" min="0" max="5" className="form-control" value={form.score} onChange={(e) => setForm({ ...form, score: e.target.value })} />
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-primary" type="submit">{editId ? 'Guardar' : 'Crear'}</button>
              <button className="btn btn-outline" type="button" onClick={() => setShow(false)}>Cancelar</button>
            </div>
          </form>
        </div></div>
      )}

      <div className="table-wrapper">
        <table className="table">
          <thead><tr><th>ID</th><th>Nombre</th><th>Ciudad</th><th>IATA</th><th>Score</th><th></th></tr></thead>
          <tbody>
            {lista.map((d) => (
              <tr key={d.depot_id}>
                <td>{d.depot_id}</td><td><b>{d.name}</b></td>
                <td>{d.city}</td><td>{d.airport || '-'}</td><td>{d.score}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => editar(d)}>Editar</button>{' '}
                  <button className="btn btn-danger btn-sm" onClick={() => eliminar(d.depot_id)}>Eliminar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

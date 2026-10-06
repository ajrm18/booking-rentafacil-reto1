import { useEffect, useState } from 'react';
import { admin } from '../api';

/** Etiquetas visibles; los valores (AVAILABLE, Sedan...) son los que guarda la API. */
const ESTADOS_VEHICULO: Record<string, string> = {
  AVAILABLE: 'Disponible', RESERVED: 'Reservado', MAINTENANCE: 'En mantenimiento', INACTIVE: 'Inactivo',
};
const ETIQUETA_CATEGORIA_ADMIN: Record<string, string> = { Sedan: 'Sedán' };

const vacio = {
  vehicle_id: '', make: '', model: '', year: new Date().getFullYear(), plate: '', color: '',
  seats: 5, doors: 4, bag_capacity: 3, transmission: 'manual', fuel_type: 'gasolina',
  car_type: 'Compacto', air_conditioning: true, price_per_day: 30, description: '',
  main_image_url: '', status: 'AVAILABLE', depot_id: undefined, supplier_id: undefined,
};

export default function VehiculosAdmin() {
  const [lista, setLista] = useState<any[]>([]);
  const [depots, setDepots] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [form, setForm] = useState<any>(vacio);
  const [editId, setEditId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [err, setErr] = useState('');

  const cargar = () => admin.listVehicles().then(setLista);

  useEffect(() => {
    cargar();
    admin.listDepots().then(setDepots);
    admin.listSuppliers().then(setSuppliers);
  }, []);

  const abrirNuevo = () => { setForm(vacio); setEditId(null); setShowForm(true); setErr(''); };
  const abrirEditar = (v: any) => {
    setForm({ ...v, depot_id: v.depot_id || v.depot?.depot_id, supplier_id: v.supplier_id || v.supplier?.supplier_id });
    setEditId(v.vehicle_id); setShowForm(true); setErr('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    try {
      const data = { ...form,
        year: Number(form.year), seats: Number(form.seats),
        doors: Number(form.doors), bag_capacity: Number(form.bag_capacity),
        price_per_day: Number(form.price_per_day),
        depot_id: Number(form.depot_id), supplier_id: Number(form.supplier_id),
      };
      if (editId) await admin.updateVehicle(editId, data);
      else await admin.createVehicle(data);
      setShowForm(false); cargar();
    } catch (e: any) { setErr(e?.message || 'Error'); }
  };

  const eliminar = async (id: string) => {
    if (!confirm('¿Eliminar este vehículo?')) return;
    try { await admin.deleteVehicle(id); cargar(); }
    catch (e: any) { alert(e?.message || 'Error'); }
  };

  const set = (k: string, v: any) => setForm({ ...form, [k]: v });

  return (
    <div>
      <div className="flex-between mb-2">
        <h1 style={{ margin: 0 }}>Vehículos</h1>
        <button className="btn btn-primary" onClick={abrirNuevo}>+ Nuevo vehículo</button>
      </div>

      {showForm && (
        <div className="card mb-3"><div className="card-body">
          <h3 style={{ marginTop: 0 }}>{editId ? 'Editar vehículo' : 'Nuevo vehículo'}</h3>
          {err && <div className="alert alert-danger">{err}</div>}
          <form onSubmit={submit} style={{
            display: 'grid', gap: '0.5rem',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          }}>
            <F l="ID del vehículo (VEH-...)"><input className="form-control" required disabled={!!editId}
              value={form.vehicle_id} onChange={(e) => set('vehicle_id', e.target.value)} /></F>
            <F l="Marca"><input className="form-control" required value={form.make} onChange={(e) => set('make', e.target.value)} /></F>
            <F l="Modelo"><input className="form-control" required value={form.model} onChange={(e) => set('model', e.target.value)} /></F>
            <F l="Año"><input type="number" className="form-control" required value={form.year} onChange={(e) => set('year', e.target.value)} /></F>
            <F l="Placa"><input className="form-control" required value={form.plate} onChange={(e) => set('plate', e.target.value)} /></F>
            <F l="Color"><input className="form-control" value={form.color || ''} onChange={(e) => set('color', e.target.value)} /></F>
            <F l="Pasajeros"><input type="number" className="form-control" value={form.seats} onChange={(e) => set('seats', e.target.value)} /></F>
            <F l="Puertas"><input type="number" className="form-control" value={form.doors} onChange={(e) => set('doors', e.target.value)} /></F>
            <F l="Maletas"><input type="number" className="form-control" value={form.bag_capacity} onChange={(e) => set('bag_capacity', e.target.value)} /></F>
            <F l="Precio por día"><input type="number" step="0.01" className="form-control" required value={form.price_per_day} onChange={(e) => set('price_per_day', e.target.value)} /></F>
            <F l="Transmisión">
              <select className="form-control" value={form.transmission} onChange={(e) => set('transmission', e.target.value)}>
                <option value="manual">Manual</option><option value="automatica">Automática</option>
              </select>
            </F>
            <F l="Combustible">
              <select className="form-control" value={form.fuel_type} onChange={(e) => set('fuel_type', e.target.value)}>
                <option value="gasolina">Gasolina</option><option value="diesel">Diésel</option>
                <option value="hibrido">Híbrido</option><option value="electrico">Eléctrico</option>
              </select>
            </F>
            <F l="Categoría">
              <select className="form-control" value={form.car_type} onChange={(e) => set('car_type', e.target.value)}>
                <option value="Compacto">Compacto</option><option value="Sedan">Sedán</option>
                <option value="SUV">SUV</option><option value="Camioneta">Camioneta</option>
                <option value="Lujo">Lujo</option>
              </select>
            </F>
            <F l="Agencia">
              <select className="form-control" required value={form.depot_id || ''} onChange={(e) => set('depot_id', e.target.value)}>
                <option value="">— Selecciona —</option>
                {depots.map((d) => <option key={d.depot_id} value={d.depot_id}>{d.name}</option>)}
              </select>
            </F>
            <F l="Proveedor">
              <select className="form-control" required value={form.supplier_id || ''} onChange={(e) => set('supplier_id', e.target.value)}>
                <option value="">— Selecciona —</option>
                {suppliers.map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>)}
              </select>
            </F>
            <F l="Estado">
              <select className="form-control" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {Object.entries(ESTADOS_VEHICULO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </F>
            <F l="Imagen principal (URL)" full>
              <input className="form-control" value={form.main_image_url || ''} onChange={(e) => set('main_image_url', e.target.value)} />
            </F>
            <F l="Descripción" full>
              <textarea className="form-control" rows={2} value={form.description || ''} onChange={(e) => set('description', e.target.value)} />
            </F>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-primary" type="submit">{editId ? 'Guardar' : 'Crear'}</button>
              <button className="btn btn-outline" type="button" onClick={() => setShowForm(false)}>Cancelar</button>
            </div>
          </form>
        </div></div>
      )}

      <div className="table-wrapper">
        <table className="table">
          <thead><tr>
            <th>ID</th><th>Vehículo</th><th>Categoría</th><th>Agencia</th>
            <th>Precio por día</th><th>Estado</th><th></th>
          </tr></thead>
          <tbody>
            {lista.map((v) => (
              <tr key={v.vehicle_id}>
                <td><code>{v.vehicle_id}</code></td>
                <td>
                  <div style={{ fontWeight: 600 }}>{v.make} {v.model}</div>
                  <div className="text-muted" style={{ fontSize: '0.8rem' }}>{v.year} &middot; {v.plate}</div>
                </td>
                <td>{ETIQUETA_CATEGORIA_ADMIN[v.car_type] || v.car_type}</td>
                <td>{v.depot?.name || '-'}</td>
                <td>${Number(v.price_per_day).toFixed(2)}</td>
                <td><span className="badge">{ESTADOS_VEHICULO[v.status] || v.status}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => abrirEditar(v)}>Editar</button>{' '}
                  <button className="btn btn-danger btn-sm" onClick={() => eliminar(v.vehicle_id)}>Eliminar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function F({ l, children, full }: { l: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className="form-group" style={{ margin: 0, gridColumn: full ? '1 / -1' : undefined }}>
      <label className="form-label">{l}</label>{children}
    </div>
  );
}

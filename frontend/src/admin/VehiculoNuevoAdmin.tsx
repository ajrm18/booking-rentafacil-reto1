import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { vehiculosV3 } from '../api/clientV3';

const CATEGORIAS = [
  { v: 'ECONOMICO', l: 'Económico / compacto' }, { v: 'COMPACTO', l: 'Sedán' }, { v: 'SUV', l: 'SUV' },
  { v: 'PREMIUM', l: 'Premium / lujo' }, { v: 'VAN', l: 'Camioneta / van' },
];

const inicial = {
  marca: '', modelo: '', anio: String(new Date().getFullYear()), placa: '', color: '', categoria: 'ECONOMICO',
  transmision: 'manual', asientos: '5', puertas: '4', precio_diario: '35', kilometraje_actual: '0',
  foto_url: '', descripcion: '', depot_id: '', supplier_id: '',
};

/**
 * FLUJO 1 de la evaluacion: alta de un vehiculo con stock inicial (1 unidad DISPONIBLE). Al
 * guardarse, el backend registra stock.actualizado y envia PushStockUpdate (available_units=1) al
 * Booking central; cuando el Booking lo reserve, el stock baja a 0 en ambas plataformas.
 */
export default function VehiculoNuevoAdmin() {
  const [f, setF] = useState(inicial);
  const [op, setOp] = useState<{ depots: any[]; suppliers: any[] }>({ depots: [], suppliers: [] });
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState('');
  const [creado, setCreado] = useState<any>(null);

  useEffect(() => {
    vehiculosV3.opciones().then((o) => {
      setOp(o);
      setF((x) => ({ ...x, depot_id: x.depot_id || String(o.depots[0]?.depot_id ?? ''), supplier_id: x.supplier_id || String(o.suppliers[0]?.supplier_id ?? '') }));
    }).catch((e) => setErr(e.message));
  }, []);

  const set = (k: keyof typeof inicial) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true); setErr('');
    try {
      const r = await vehiculosV3.crear({
        marca: f.marca.trim(), modelo: f.modelo.trim(), anio: Number(f.anio), placa: f.placa.trim().toUpperCase(), color: f.color || undefined,
        categoria: f.categoria, transmision: f.transmision, asientos: Number(f.asientos), puertas: Number(f.puertas),
        precio_diario: Number(f.precio_diario), kilometraje_actual: Number(f.kilometraje_actual || 0),
        foto_url: f.foto_url.trim() || undefined, descripcion: f.descripcion.trim() || undefined,
        depot_id: Number(f.depot_id), supplier_id: Number(f.supplier_id), estado: 'DISPONIBLE',
      });
      setCreado(r);
      setF({ ...inicial, depot_id: f.depot_id, supplier_id: f.supplier_id });
    } catch (ex: any) {
      setErr(ex?.message || 'No se pudo crear el vehículo');
    } finally { setGuardando(false); }
  };

  const campo = (k: keyof typeof inicial, label: string, props: Record<string, any> = {}) => (
    <div className="form-group">
      <label className="form-label" htmlFor={`vn-${k}`}>{label}</label>
      <input id={`vn-${k}`} className="form-control" value={f[k]} onChange={set(k)} {...props} />
    </div>
  );

  return (
    <div>
      <div className="eyebrow">Catálogo · Flujo 1</div>
      <h1 style={{ margin: '0.15rem 0 0.25rem' }}>Nuevo vehículo con stock</h1>
      <p className="text-muted" style={{ marginTop: 0 }}>
        Cada auto es una unidad física (placa única): se publica con <b>stock 1 · DISPONIBLE</b> y se sincroniza con Booking Central por gRPC.
        Al reservarse desde Booking el stock baja a 0 en ambas plataformas.
      </p>

      {creado && (
        <div className="alert alert-success" role="status">
          <b>Vehículo creado: {creado.marca} {creado.modelo} ({creado.vehicle_id})</b> · stock {creado.stock} · estado {creado.estado}.{' '}
          Push de stock enviado a Booking Central. <Link to="/admin/flota">Ver flota en vivo</Link> · <Link to={`/vehiculos/${creado.vehicle_id}`}>Ver en el catálogo</Link>
        </div>
      )}
      {err && <div className="alert alert-danger" role="alert">{err}</div>}

      <form className="card" onSubmit={enviar} noValidate>
        <div className="card-body">
          <div className="grid" style={{ display: 'grid', gap: '0 1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            {campo('marca', 'Marca *', { placeholder: 'Chevrolet', required: true })}
            {campo('modelo', 'Modelo *', { placeholder: 'Onix', required: true })}
            {campo('anio', 'Año *', { inputMode: 'numeric' })}
            {campo('placa', 'Placa *', { placeholder: 'PBA-1234', required: true })}
            {campo('color', 'Color', { placeholder: 'Blanco' })}
            <div className="form-group">
              <label className="form-label" htmlFor="vn-categoria">Categoría</label>
              <select id="vn-categoria" className="form-control" value={f.categoria} onChange={set('categoria')}>
                {CATEGORIAS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="vn-transmision">Transmisión</label>
              <select id="vn-transmision" className="form-control" value={f.transmision} onChange={set('transmision')}>
                <option value="manual">Manual</option><option value="automatica">Automática</option>
              </select>
            </div>
            {campo('asientos', 'Asientos', { inputMode: 'numeric' })}
            {campo('puertas', 'Puertas', { inputMode: 'numeric' })}
            {campo('precio_diario', 'Precio por día (USD) *', { inputMode: 'decimal' })}
            {campo('kilometraje_actual', 'Odómetro actual (km)', { inputMode: 'numeric' })}
            <div className="form-group">
              <label className="form-label" htmlFor="vn-depot">Agencia *</label>
              <select id="vn-depot" className="form-control" value={f.depot_id} onChange={set('depot_id')}>
                {op.depots.map((d) => <option key={d.depot_id} value={d.depot_id}>{d.name} ({d.city})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="vn-supplier">Proveedor *</label>
              <select id="vn-supplier" className="form-control" value={f.supplier_id} onChange={set('supplier_id')}>
                {op.suppliers.map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          {campo('foto_url', 'URL de la foto', { placeholder: 'https://…', type: 'url' })}
          <div className="form-group">
            <label className="form-label" htmlFor="vn-desc">Descripción</label>
            <textarea id="vn-desc" className="form-control" rows={2} value={f.descripcion} onChange={set('descripcion')} />
          </div>
          <div className="flex-between">
            <span className="badge badge-success" style={{ fontSize: '0.85rem' }}>Stock inicial: 1 unidad · DISPONIBLE</span>
            <button className="btn btn-primary" disabled={guardando || !f.marca || !f.modelo || !f.placa} style={{ padding: '0.75rem 1.5rem', fontWeight: 700 }}>
              {guardando ? 'Creando…' : 'Crear vehículo y publicar stock'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

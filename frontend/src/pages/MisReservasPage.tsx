import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { admin, orders } from '../api';
import type { OrderDetail } from '../types';
import { useAuth } from '../context/AuthContext';

const badges: Record<string, string> = {
  CONFIRMED: 'badge-success',
  CANCELLED: 'badge-danger',
  PENDING: 'badge-warning',
};

export default function MisReservasPage() {
  const { user } = useAuth();
  const [lista, setLista] = useState<OrderDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const cargar = () => {
    setLoading(true);
    // Los clientes normales no tienen endpoint /admin/orders, asi que aqui
    // usamos el listado del admin cuando lo son. Para clientes filtramos por sub del token,
    // pero como el listado del contrato no expone eso, mostramos un mensaje explicativo.
    if (user?.role === 'admin') {
      admin.listOrders().then(setLista).catch((e) => setError(e?.message || 'Error')).finally(() => setLoading(false));
    } else {
      // Los clientes ven las que crearon en esta sesion (guardadas en localStorage)
      const ids: string[] = JSON.parse(localStorage.getItem('rf_myorders') || '[]');
      Promise.all(ids.map((id) => orders.get(id).catch(() => null)))
        .then((res) => setLista(res.filter(Boolean) as OrderDetail[]))
        .finally(() => setLoading(false));
    }
  };

  useEffect(() => { cargar(); }, [user]);

  const cancelar = async (id: string) => {
    if (!confirm('Cancelar esta reserva?')) return;
    try { await orders.cancel(id); cargar(); }
    catch (e: any) { alert(e?.message || 'Error'); }
  };

  return (
    <div className="container" style={{ padding: '2rem 1rem' }}>
      <h1 style={{ marginTop: 0 }}>Mis reservas</h1>
      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <div className="text-muted">Cargando...</div>
      ) : lista.length === 0 ? (
        <div className="card"><div className="card-body text-center">
          <div className="text-muted mb-2">Aun no tienes reservas.</div>
          <Link to="/catalogo" className="btn btn-primary">Buscar vehiculos</Link>
        </div></div>
      ) : (
        <div style={{
          display: 'grid', gap: '1rem',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        }}>
          {lista.map((r) => (
            <div key={r.order_id} className="card">
              <div className="card-body">
                <div className="flex-between">
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      {r.vehicle_details?.make} {r.vehicle_details?.model}
                    </div>
                    <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                      <code>{r.locator}</code>
                    </div>
                  </div>
                  <span className={`badge ${badges[r.status] || ''}`}>{r.status}</span>
                </div>
                <div className="mt-2" style={{ display: 'grid', gap: '0.25rem', fontSize: '0.9rem' }}>
                  <div><b>Total:</b> ${Number(r.total_price).toFixed(2)} {r.currency}</div>
                  <div><b>Creada:</b> {new Date(r.creation_date).toLocaleString()}</div>
                </div>
                <div className="flex mt-2" style={{ gap: '0.5rem' }}>
                  <Link to={`/reserva/${r.order_id}`} className="btn btn-outline btn-sm">Ver</Link>
                  {r.status === 'CONFIRMED' && (
                    <button className="btn btn-danger btn-sm" onClick={() => cancelar(r.order_id)}>Cancelar</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

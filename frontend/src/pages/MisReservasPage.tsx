import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { account, orders } from '../api';
import type { OrderDetail } from '../types';
import { estadoOrden, fechaCorta } from '../utils/reservas';

export default function MisReservasPage() {
  const [lista, setLista] = useState<OrderDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Órdenes cuyo dueño es el `sub` del token (GET /account/orders), en cualquier dispositivo
  const cargar = () => {
    setLoading(true);
    account.myOrders()
      .then(setLista)
      .catch((e) => setError(e?.message || 'No se pudieron cargar tus reservas'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, []);

  const cancelar = async (id: string) => {
    if (!confirm('¿Cancelar esta reserva?')) return;
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
          <div className="text-muted mb-2">Aún no tienes reservas.</div>
          <Link to="/catalogo" className="btn btn-primary">Buscar vehículos</Link>
        </div></div>
      ) : (
        <div style={{
          display: 'grid', gap: '1rem',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        }}>
          {lista.map((r) => {
            const est = estadoOrden(r);
            const ruta = r.route_details as any;
            return (
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
                    <span className={`badge ${est.badge}`}>{est.label}</span>
                  </div>
                  <div className="mt-2" style={{ display: 'grid', gap: '0.25rem', fontSize: '0.9rem' }}>
                    {ruta?.pickup?.datetime && (
                      <div><b>Fechas:</b> {fechaCorta(ruta.pickup.datetime)} – {fechaCorta(ruta.dropoff?.datetime)}</div>
                    )}
                    <div><b>Total:</b> ${Number(r.total_price).toFixed(2)} {r.currency}</div>
                    <div><b>Creada:</b> {new Date(r.creation_date).toLocaleString('es-EC')}</div>
                  </div>
                  <div className="flex mt-2" style={{ gap: '0.5rem' }}>
                    <Link to={`/reserva/${r.order_id}`} className="btn btn-outline btn-sm">Ver</Link>
                    {r.status === 'CONFIRMED' && est.activa && (
                      <button className="btn btn-danger btn-sm" onClick={() => cancelar(r.order_id)}>Cancelar</button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

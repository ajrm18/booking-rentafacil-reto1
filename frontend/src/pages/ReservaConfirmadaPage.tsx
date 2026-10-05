import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { orders } from '../api';
import type { OrderDetail } from '../types';

export default function ReservaConfirmadaPage() {
  const { orderId } = useParams();
  const [orden, setOrden] = useState<OrderDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!orderId) return;
    orders.get(orderId).then(setOrden).catch((e) => setError(e?.message || 'No se encontro la orden'));
  }, [orderId]);

  if (error) return (
    <div className="container" style={{ padding: '2rem 1rem', maxWidth: 640 }}>
      <div className="alert alert-danger">{error}</div>
      <Link to="/" className="btn btn-primary">Volver al inicio</Link>
    </div>
  );
  if (!orden) return <div className="container" style={{ padding: '2rem 1rem' }}>Cargando...</div>;

  return (
    <div className="container" style={{ padding: '3rem 1rem', maxWidth: 640 }}>
      <div className="card">
        <div className="card-body">
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <div style={{
              width: 72, height: 72, borderRadius: '50%', background: '#dcfce7',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '2rem', color: 'var(--success)', marginBottom: '0.5rem',
            }}>✓</div>
            <h1 style={{ margin: 0 }}>Reserva confirmada</h1>
            <div className="text-muted">Tu reserva se registro correctamente.</div>
          </div>

          <div style={{
            background: '#f8fafc', border: '1px solid var(--border)',
            padding: '1rem', borderRadius: 'var(--radius)', marginBottom: '1rem',
          }}>
            <div className="flex-between"><span>Localizador (PNR)</span><code style={{ fontSize: '1rem' }}>{orden.locator}</code></div>
            <div className="flex-between"><span>Order ID</span><code style={{ fontSize: '0.8rem' }}>{orden.order_id}</code></div>
            <div className="flex-between"><span>Estado</span>
              <span className="badge badge-success">{orden.status}</span>
            </div>
            <div className="flex-between"><span>Vehiculo</span>
              <b>{orden.vehicle_details.make} {orden.vehicle_details.model}</b>
            </div>
            <div className="flex-between" style={{ borderTop: '1px solid var(--border)', paddingTop: '0.5rem', marginTop: '0.5rem' }}>
              <span>Total</span><b>${Number(orden.total_price).toFixed(2)} {orden.currency}</b>
            </div>
          </div>

          <div className="flex" style={{ gap: '0.5rem' }}>
            <Link to="/mis-reservas" className="btn btn-primary btn-block">Ver mis reservas</Link>
            <Link to="/catalogo" className="btn btn-outline btn-block">Seguir buscando</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

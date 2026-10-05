import { useEffect, useState } from 'react';
import { admin, orders as ordersApi } from '../api';
import type { OrderDetail } from '../types';

const badges: Record<string, string> = {
  CONFIRMED: 'badge-success',
  CANCELLED: 'badge-danger',
  PENDING: 'badge-warning',
};

export default function OrdersAdmin() {
  const [lista, setLista] = useState<OrderDetail[]>([]);
  const [filtro, setFiltro] = useState('todas');

  const cargar = () => admin.listOrders(filtro === 'todas' ? undefined : filtro).then(setLista);
  useEffect(() => { cargar(); }, [filtro]);

  const cancelar = async (id: string) => {
    if (!confirm('Cancelar orden?')) return;
    try { await ordersApi.cancel(id); cargar(); }
    catch (e: any) { alert(e?.message || 'Error'); }
  };

  return (
    <div>
      <div className="flex-between mb-2">
        <h1 style={{ margin: 0 }}>Ordenes</h1>
        <select className="form-control" style={{ maxWidth: 200 }}
          value={filtro} onChange={(e) => setFiltro(e.target.value)}>
          <option value="todas">Todas</option>
          <option value="CONFIRMED">Confirmadas</option>
          <option value="CANCELLED">Canceladas</option>
          <option value="PENDING">Pendientes</option>
        </select>
      </div>

      <div className="table-wrapper">
        <table className="table">
          <thead><tr>
            <th>PNR</th><th>Vehiculo</th><th>Total</th><th>Estado</th><th>Creada</th><th></th>
          </tr></thead>
          <tbody>
            {lista.map((r) => (
              <tr key={r.order_id}>
                <td><code>{r.locator}</code></td>
                <td>
                  {r.vehicle_details?.make} {r.vehicle_details?.model}
                  <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                    <code>{r.vehicle_details?.vehicle_id}</code>
                  </div>
                </td>
                <td>${Number(r.total_price).toFixed(2)} {r.currency}</td>
                <td><span className={`badge ${badges[r.status] || ''}`}>{r.status}</span></td>
                <td>{new Date(r.creation_date).toLocaleString()}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {r.status === 'CONFIRMED' && (
                    <button className="btn btn-danger btn-sm" onClick={() => cancelar(r.order_id)}>Cancelar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

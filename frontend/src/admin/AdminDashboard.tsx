import { useEffect, useState } from 'react';
import { admin } from '../api';

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    total_vehicles: 0, total_depots: 0, total_suppliers: 0,
    total_orders: 0, confirmed_orders: 0, total_revenue: 0,
  });

  useEffect(() => { admin.stats().then(setStats).catch(() => {}); }, []);

  const cards = [
    { label: 'Vehiculos', value: stats.total_vehicles, color: '#0b6cff' },
    { label: 'Agencias', value: stats.total_depots, color: '#0ea5e9' },
    { label: 'Proveedores', value: stats.total_suppliers, color: '#ec4899' },
    { label: 'Ordenes', value: stats.total_orders, color: '#16a34a' },
    { label: 'Confirmadas', value: stats.confirmed_orders, color: '#f59e0b' },
    { label: 'Ingresos', value: `$${stats.total_revenue.toFixed(2)}`, color: '#059669' },
  ];

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Dashboard</h1>
      <div style={{
        display: 'grid', gap: '1rem',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
      }}>
        {cards.map((c) => (
          <div key={c.label} className="card">
            <div className="card-body">
              <div className="text-muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase' }}>
                {c.label}
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: c.color, marginTop: '0.25rem' }}>
                {c.value}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

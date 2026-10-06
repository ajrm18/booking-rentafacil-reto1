import { useEffect, useState } from 'react';
import { admin } from '../api';

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    total_vehicles: 0, total_depots: 0, total_suppliers: 0,
    total_orders: 0, confirmed_orders: 0, total_revenue: 0,
  });

  useEffect(() => { admin.stats().then(setStats).catch(() => {}); }, []);

  const cards = [
    { label: 'Vehiculos', value: stats.total_vehicles, color: '#0b0d10' },
    { label: 'Agencias', value: stats.total_depots, color: '#0b0d10' },
    { label: 'Proveedores', value: stats.total_suppliers, color: '#0b0d10' },
    { label: 'Ordenes', value: stats.total_orders, color: '#0b0d10' },
    { label: 'Confirmadas', value: stats.confirmed_orders, color: '#0b0d10' },
    { label: 'Ingresos', value: `$${stats.total_revenue.toFixed(2)}`, color: '#8a5a00' },
  ];

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Dashboard</h1>
      <div style={{
        display: 'grid', gap: '1rem',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
      }}>
        {cards.map((c) => (
          <div key={c.label} className="card" style={{ borderTop: '3px solid var(--brand)' }}>
            <div className="card-body">
              <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
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

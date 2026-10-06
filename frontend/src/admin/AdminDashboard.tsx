import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { admin } from '../api';

const dinero = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AdminDashboard() {
  // null mientras carga: se muestra "—" en vez de ceros que parecerían datos reales
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    admin.stats().then(setStats).catch((e) => setError(e?.message || 'No se pudieron cargar las estadísticas'));
  }, []);
  const n = (k: string) => (stats ? stats[k] ?? 0 : '—');

  const cards = [
    { label: 'Vehículos', value: n('total_vehicles'), color: 'var(--strong)' },
    { label: 'Agencias', value: n('total_depots'), color: 'var(--strong)' },
    { label: 'Proveedores', value: n('total_suppliers'), color: 'var(--strong)' },
    { label: 'Usuarios', value: n('total_users'), color: 'var(--strong)' },
    { label: 'Órdenes', value: n('total_orders'), color: 'var(--strong)' },
    { label: 'Confirmadas', value: n('confirmed_orders'), color: 'var(--strong)' },
    { label: 'Finalizadas', value: n('completed_orders'), color: 'var(--strong)' },
    { label: 'Ingresos totales', value: stats ? dinero(stats.total_revenue ?? 0) : '—', color: 'var(--brand-ink)' },
  ];

  return (
    <div>
      <div className="flex-between mb-2">
        <h1 style={{ margin: 0 }}>Panel de control</h1>
        <Link to="/admin/usuarios?nuevo=1" className="btn btn-primary">+ Nuevo cliente</Link>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      <div aria-busy={!stats} style={{
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
      <p className="text-muted mt-2" style={{ fontSize: '0.85rem' }}>
        Los ingresos suman las órdenes confirmadas (en curso y finalizadas); las canceladas no cuentan.
      </p>
    </div>
  );
}

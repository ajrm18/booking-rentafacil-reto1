import { NavLink, Outlet } from 'react-router-dom';

export default function AdminLayout() {
  const items = [
    { to: '/admin', label: 'Dashboard', end: true },
    { to: '/admin/vehiculos', label: 'Vehiculos' },
    { to: '/admin/depots', label: 'Agencias' },
    { to: '/admin/suppliers', label: 'Proveedores' },
    { to: '/admin/orders', label: 'Ordenes' },
  ];
  return (
    <div className="container" style={{ padding: '2rem 1rem' }}>
      <div style={{
        display: 'grid', gap: '1.5rem',
        gridTemplateColumns: 'minmax(180px, 220px) 1fr',
      }} className="admin-grid">
        <aside className="card">
          <div className="card-body" style={{ padding: '0.75rem' }}>
            <div style={{
              fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em',
              color: 'var(--text-muted)', padding: '0.5rem 0.75rem',
            }}>Panel admin</div>
            <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              {items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end}
                  className={({ isActive }) => isActive ? 'admin-link active' : 'admin-link'}>
                  {i.label}
                </NavLink>
              ))}
            </nav>
          </div>
        </aside>
        <div><Outlet /></div>
      </div>
      <style>{`
        .admin-link { padding: 0.55rem 0.75rem; border-radius: 6px;
          color: var(--text); text-decoration: none; font-size: 0.95rem; }
        .admin-link:hover { background: #f1f5f9; }
        .admin-link.active { background: var(--brand-light); color: var(--brand); font-weight: 600; }
        @media (max-width: 800px) { .admin-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
}

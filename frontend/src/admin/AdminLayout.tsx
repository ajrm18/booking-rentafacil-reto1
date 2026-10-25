import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/** `mechanic` = rol MANTENIMIENTO del contrato v2: solo ve las pantallas de patio y taller. */
const ITEMS = [
  { to: '/admin', label: 'Panel de control', end: true },
  { to: '/admin/usuarios', label: 'Usuarios' },
  { to: '/admin/vehiculos', label: 'Vehículos' },
  { to: '/admin/depots', label: 'Agencias' },
  { to: '/admin/suppliers', label: 'Proveedores' },
  { to: '/admin/orders', label: 'Órdenes' },
  { seccion: 'Operación (Reto 2)' },
  { to: '/admin/flota', label: 'Flota en vivo', tecnico: true },
  { to: '/admin/mostrador', label: 'Mostrador y patio', tecnico: true },
  { to: '/admin/mantenimiento', label: 'Mantenimiento', tecnico: true },
  { to: '/admin/promociones', label: 'Promociones B2B' },
  { to: '/admin/health', label: 'Salud y eventos' },
] as const;

export default function AdminLayout() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const tecnico = user?.role === 'mechanic';
  if (tecnico && pathname.replace(/\/$/, '') === '/admin') return <Navigate to="/admin/flota" replace />;
  const items = ITEMS.filter((i) => !tecnico || 'seccion' in i || ('tecnico' in i && i.tecnico));

  return (
    <div className="container" style={{ padding: '2rem 1rem' }}>
      <div style={{
        display: 'grid', gap: '1.5rem',
        gridTemplateColumns: 'minmax(180px, 220px) 1fr',
      }} className="admin-grid">
        <aside className="card">
          <div className="card-body" style={{ padding: '0.75rem' }}>
            <div className="admin-seccion">{tecnico ? 'Patio y taller' : 'Administración'}</div>
            <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              {items.map((i) => ('seccion' in i
                ? (tecnico ? null : <div key={i.seccion} className="admin-seccion" style={{ marginTop: '0.5rem' }}>{i.seccion}</div>)
                : (
                  <NavLink key={i.to} to={i.to} end={'end' in i ? i.end : undefined}
                    className={({ isActive }) => isActive ? 'admin-link active' : 'admin-link'}>
                    {i.label}
                  </NavLink>
                )))}
            </nav>
          </div>
        </aside>
        <div><Outlet /></div>
      </div>
      <style>{`
        .admin-seccion { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;
          color: var(--text-muted); padding: 0.5rem 0.75rem; }
        .admin-link { padding: 0.55rem 0.75rem; border-radius: 6px;
          color: var(--text); text-decoration: none; font-size: 0.95rem; }
        .admin-link:hover { background: var(--surface-hover); }
        .admin-link.active { background: var(--strong); color: var(--on-strong); font-weight: 600; }
        @media (max-width: 800px) { .admin-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
}

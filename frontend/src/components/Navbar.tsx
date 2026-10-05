import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);

  const doLogout = () => { logout(); setOpen(false); nav('/'); };

  return (
    <header style={{
      background: '#fff', borderBottom: '1px solid var(--border)',
      position: 'sticky', top: 0, zIndex: 20,
    }}>
      <div className="container" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.85rem 1rem', gap: '1rem',
      }}>
        <Link to="/" style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          fontWeight: 800, fontSize: '1.2rem', color: 'var(--text)',
          textDecoration: 'none',
        }}>
          <span style={{
            width: 32, height: 32, borderRadius: 8, background: 'var(--brand)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: '1rem',
          }}>RF</span>
          RentaFacil <span style={{ color: 'var(--brand)' }}>EC</span>
        </Link>

        <nav className="nav-desktop" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <NavLink to="/" end className="nav-link">Inicio</NavLink>
          <NavLink to="/catalogo" className="nav-link">Catalogo</NavLink>
          {user && <NavLink to="/mis-reservas" className="nav-link">Mis reservas</NavLink>}
          {user?.role === 'admin' && <NavLink to="/admin" className="nav-link">Admin</NavLink>}
          {user ? (
            <>
              <span className="text-muted" style={{ fontSize: '0.9rem' }}>{user.email}</span>
              <button className="btn btn-outline btn-sm" onClick={doLogout}>Salir</button>
            </>
          ) : (
            <Link to="/login" className="btn btn-primary btn-sm">Ingresar</Link>
          )}
        </nav>

        <button className="nav-toggle" onClick={() => setOpen(!open)} aria-label="Menu"
          style={{ display: 'none', padding: 8, borderRadius: 8, border: '1px solid var(--border)', background: '#fff' }}>
          <span style={{
            display: 'block', width: 22, height: 2, background: 'var(--text)',
            boxShadow: '0 -6px 0 var(--text), 0 6px 0 var(--text)',
          }} />
        </button>
      </div>

      {open && (
        <div className="nav-mobile" style={{
          borderTop: '1px solid var(--border)', padding: '0.5rem 1rem 1rem',
          display: 'flex', flexDirection: 'column', gap: '0.25rem', background: '#fff',
        }}>
          <NavLink to="/" end className="nav-link-mobile" onClick={() => setOpen(false)}>Inicio</NavLink>
          <NavLink to="/catalogo" className="nav-link-mobile" onClick={() => setOpen(false)}>Catalogo</NavLink>
          {user && <NavLink to="/mis-reservas" className="nav-link-mobile" onClick={() => setOpen(false)}>Mis reservas</NavLink>}
          {user?.role === 'admin' && <NavLink to="/admin" className="nav-link-mobile" onClick={() => setOpen(false)}>Admin</NavLink>}
          {user ? (
            <button className="btn btn-outline mt-1" onClick={doLogout}>Salir ({user.email})</button>
          ) : (
            <Link to="/login" className="btn btn-primary btn-block mt-1" onClick={() => setOpen(false)}>Ingresar</Link>
          )}
        </div>
      )}

      <style>{`
        .nav-link, .nav-link-mobile {
          color: var(--text); text-decoration: none; font-size: 0.95rem;
          padding: 0.4rem 0.65rem; border-radius: 6px;
        }
        .nav-link.active, .nav-link-mobile.active {
          background: var(--brand-light); color: var(--brand);
        }
        .nav-link-mobile { padding: 0.65rem 0.5rem; border-bottom: 1px solid var(--border); }
        @media (max-width: 900px) {
          .nav-desktop { display: none !important; }
          .nav-toggle { display: inline-flex !important; }
        }
        @media (min-width: 901px) {
          .nav-mobile { display: none !important; }
        }
      `}</style>
    </header>
  );
}

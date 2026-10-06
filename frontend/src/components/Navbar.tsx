import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../hooks/useTheme';

export default function Navbar() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const { theme, toggle } = useTheme();

  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const doLogout = () => { logout(); setOpen(false); nav('/'); };

  // Menu movil accesible por teclado: al abrir, el foco va al primer enlace;
  // Escape lo cierra y devuelve el foco al boton que lo abrio.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); toggleRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header style={{
      background: 'var(--ink)', borderBottom: '1px solid var(--ink-3)',
      position: 'sticky', top: 0, zIndex: 20,
    }}>
      <div className="container" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.85rem 1rem', gap: '1rem',
      }}>
        <Link to="/" aria-label="RentaFacil EC - Inicio" style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          fontWeight: 800, fontSize: '1.2rem', color: '#fff',
          textDecoration: 'none',
        }}>
          <span style={{
            width: 32, height: 32, borderRadius: 8, background: 'var(--brand)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--on-brand)', fontSize: '0.9rem', letterSpacing: '-0.02em',
          }}>RF</span>
          RentaFacil <span style={{ color: 'var(--brand)' }}>EC</span>
        </Link>

        <nav className="nav-desktop" aria-label="Navegación principal" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <ThemeToggle theme={theme} onToggle={toggle} />
          <NavLink to="/" end className="nav-link">Inicio</NavLink>
          <NavLink to="/catalogo" className="nav-link">Catálogo</NavLink>
          {user && <NavLink to="/mis-reservas" className="nav-link">Mis reservas</NavLink>}
          {user?.role === 'admin' && <NavLink to="/admin" className="nav-link">Admin</NavLink>}
          {user ? (
            <>
              <span style={{ fontSize: '0.85rem', color: '#9a9da3' }}>{user.email}</span>
              <button className="btn btn-sm nav-btn-outline" onClick={doLogout}>Salir</button>
            </>
          ) : (
            <Link to="/login" className="btn btn-primary btn-sm">Ingresar</Link>
          )}
        </nav>

        <div className="nav-toggle" style={{ display: 'none', alignItems: 'center', gap: '0.5rem' }}>
          <ThemeToggle theme={theme} onToggle={toggle} />
        <button ref={toggleRef} type="button" onClick={() => setOpen(!open)}
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={open} aria-controls="menu-movil"
          style={{ display: 'inline-flex', padding: '12px 8px', borderRadius: 8, border: '1px solid var(--ink-3)', background: 'transparent' }}>
          <span style={{
            display: 'block', width: 22, height: 2, background: '#fff',
            boxShadow: '0 -6px 0 #fff, 0 6px 0 #fff',
          }} />
        </button>
        </div>
      </div>

      {open && (
        <nav id="menu-movil" ref={menuRef} className="nav-mobile" aria-label="Navegación principal" style={{
          borderTop: '1px solid var(--ink-3)', padding: '0.5rem 1rem 1rem',
          display: 'flex', flexDirection: 'column', gap: '0.25rem', background: 'var(--ink)',
        }}>
          <NavLink to="/" end className="nav-link-mobile" onClick={() => setOpen(false)}>Inicio</NavLink>
          <NavLink to="/catalogo" className="nav-link-mobile" onClick={() => setOpen(false)}>Catálogo</NavLink>
          {user && <NavLink to="/mis-reservas" className="nav-link-mobile" onClick={() => setOpen(false)}>Mis reservas</NavLink>}
          {user?.role === 'admin' && <NavLink to="/admin" className="nav-link-mobile" onClick={() => setOpen(false)}>Admin</NavLink>}
          {user ? (
            <button className="btn nav-btn-outline mt-1" onClick={doLogout}>Salir ({user.email})</button>
          ) : (
            <Link to="/login" className="btn btn-primary btn-block mt-1" onClick={() => setOpen(false)}>Ingresar</Link>
          )}
        </nav>
      )}

      <style>{`
        .nav-link, .nav-link-mobile {
          color: #c9cbcf; text-decoration: none; font-size: 0.93rem; font-weight: 500;
          padding: 0.4rem 0.2rem; margin: 0 0.45rem; border-bottom: 2px solid transparent;
        }
        .nav-link:hover, .nav-link-mobile:hover,
        .nav-link:focus-visible, .nav-link-mobile:focus-visible { color: #fff; text-decoration: none; }
        .nav-link.active { color: #fff; border-bottom-color: var(--brand); }
        .nav-link-mobile.active { color: var(--brand); }
        .nav-link-mobile { padding: 0.75rem 0.25rem; margin: 0; border-bottom: 1px solid var(--ink-3); }
        .nav-btn-outline { border: 1px solid var(--ink-3); color: #fff; }
        .nav-btn-outline:hover { border-color: #fff; text-decoration: none; }
        .theme-toggle {
          width: 36px; height: 36px; border-radius: 8px; border: 1px solid var(--ink-3);
          display: inline-flex; align-items: center; justify-content: center; color: #c9cbcf;
          transition: color .15s, border-color .15s;
        }
        .theme-toggle:hover { color: var(--brand); border-color: #454c57; }
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

function ThemeToggle({ theme, onToggle }: { theme: 'light' | 'dark'; onToggle: () => void }) {
  const oscuro = theme === 'dark';
  const label = oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  return (
    <button type="button" className="theme-toggle" onClick={onToggle} aria-label={label} title={label}>
      {oscuro ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

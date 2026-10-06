import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const u = await login(email, password);
      nav(u.role === 'admin' ? '/admin' : '/');
    } catch (e: any) {
      setError(e?.message || 'Credenciales invalidas');
    } finally { setLoading(false); }
  };

  const usar = (mail: string, pass: string) => { setEmail(mail); setPassword(pass); };

  return (
    <div className="container" style={{ padding: '3rem 1rem', maxWidth: 460 }}>
      <div className="card" style={{ borderTop: '3px solid var(--brand)' }}>
        <div className="card-body" style={{ padding: '1.75rem' }}>
          <div className="eyebrow">Mi cuenta</div>
          <h1 style={{ margin: '0.3rem 0 0.5rem' }}>Ingresar</h1>
          <p className="text-muted">
            Autenticacion OAuth2 (equivalente al Authorization Server del Booking Hub central).
            El token JWT recibido incluye los scopes autos:read, autos:book, autos:cancel.
          </p>
          <form onSubmit={submit}>
            {error && <div className="alert alert-danger">{error}</div>}
            <div className="form-group">
              <label className="form-label">Email</label>
              <input type="email" className="form-control" required
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Contrasena</label>
              <input type="password" className="form-control" required minLength={6}
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
              {loading ? 'Autenticando...' : 'Ingresar'}
            </button>
          </form>
          <div className="alert alert-info mt-2" style={{ fontSize: '0.85rem' }}>
            <b>Cuentas demo:</b>
            <div style={{ marginTop: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <button className="btn btn-outline btn-sm" type="button"
                onClick={() => usar('admin@rentafacil.ec', 'Admin12345')}>
                Admin: admin@rentafacil.ec / Admin12345
              </button>
              <button className="btn btn-outline btn-sm" type="button"
                onClick={() => usar('maria@example.com', 'Cliente12345')}>
                Cliente: maria@example.com / Cliente12345
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

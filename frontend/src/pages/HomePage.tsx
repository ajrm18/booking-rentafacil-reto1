import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { catalog } from '../api';
import type { Depot, VehicleDetail } from '../types';

const HOY = new Date().toISOString().slice(0, 10);
const TRES_DIAS = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

export default function HomePage() {
  const nav = useNavigate();
  const [depots, setDepots] = useState<Depot[]>([]);
  const [destacados, setDestacados] = useState<VehicleDetail[]>([]);
  const [depotId, setDepotId] = useState('');
  const [ini, setIni] = useState(HOY);
  const [fin, setFin] = useState(TRES_DIAS);
  const [edad, setEdad] = useState(25);

  useEffect(() => {
    catalog.depots().then((r) => setDepots(r.data)).catch(() => {});
    catalog.details().then((r) => setDestacados(r.data.slice(0, 6))).catch(() => {});
  }, []);

  const buscar = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams({
      depotId, ini, fin, edad: String(edad),
    });
    nav(`/catalogo?${params.toString()}`);
  };

  const categorias = [
    { code: 'Compacto', label: 'Economico', icon: '⚡' },
    { code: 'Sedan', label: 'Sedan', icon: '🚗' },
    { code: 'SUV', label: 'SUV', icon: '🚙' },
    { code: 'Camioneta', label: 'Camioneta', icon: '🛻' },
    { code: 'Lujo', label: 'Lujo', icon: '✨' },
  ];

  return (
    <>
      <section style={{
        background: 'linear-gradient(135deg, #0b6cff 0%, #084bb3 100%)',
        color: '#fff', padding: '4rem 0 3rem', position: 'relative', overflow: 'hidden',
      }}>
        <div className="container" style={{ position: 'relative', zIndex: 2 }}>
          <div style={{ maxWidth: 700 }}>
            <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.75rem)', fontWeight: 800, margin: 0, lineHeight: 1.15 }}>
              Alquila el vehiculo perfecto para tu proxima aventura
            </h1>
            <p style={{ fontSize: 'clamp(1rem, 1.6vw, 1.15rem)', opacity: 0.9, marginTop: '1rem' }}>
              Busca disponibilidad en tiempo real conectada al GDS Autos Core API.
            </p>
          </div>

          <form onSubmit={buscar} style={{
            background: '#fff', color: 'var(--text)', borderRadius: 'var(--radius-lg)',
            padding: '1.25rem', marginTop: '2rem', display: 'grid', gap: '0.75rem',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            boxShadow: 'var(--shadow-lg)', alignItems: 'end',
          }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Recogida</label>
              <select className="form-control" value={depotId} onChange={(e) => setDepotId(e.target.value)}>
                <option value="">Cualquier agencia</option>
                {depots.map((d) => (
                  <option key={d.depot_id} value={d.depot_id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Fecha inicio</label>
              <input type="date" className="form-control" value={ini}
                min={HOY} onChange={(e) => setIni(e.target.value)} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Fecha fin</label>
              <input type="date" className="form-control" value={fin}
                min={ini || HOY} onChange={(e) => setFin(e.target.value)} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Edad conductor</label>
              <input type="number" className="form-control" min={18} max={99}
                value={edad} onChange={(e) => setEdad(Number(e.target.value))} />
            </div>
            <button type="submit" className="btn btn-primary" style={{ padding: '0.7rem 1rem' }}>
              Buscar
            </button>
          </form>
        </div>
        <div style={{
          position: 'absolute', right: -60, top: -60, width: 300, height: 300,
          borderRadius: '50%', background: 'rgba(255,255,255,0.06)',
        }} />
      </section>

      <section className="container" style={{ padding: '3rem 1rem 1rem' }}>
        <h2 style={{ margin: 0 }}>Explora por categoria</h2>
        <p className="text-muted" style={{ margin: '0 0 1rem' }}>
          Encuentra el tipo de vehiculo que se adapta a tu viaje
        </p>
        <div style={{
          display: 'grid', gap: '1rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        }}>
          {categorias.map((c) => (
            <Link key={c.code} to={`/catalogo?carType=${c.code}`}
              style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card" style={{ padding: '1.25rem', textAlign: 'center', cursor: 'pointer' }}>
                <div style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>{c.icon}</div>
                <div style={{ fontWeight: 700 }}>{c.label}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="container" style={{ padding: '2rem 1rem' }}>
        <div className="flex-between mb-2">
          <h2 style={{ margin: 0 }}>Vehiculos destacados</h2>
          <Link to="/catalogo" className="btn btn-outline btn-sm">Ver todos</Link>
        </div>
        <div className="grid">
          {destacados.map((v) => (
            <Link key={v.vehicle_id} to={`/vehiculos/${v.vehicle_id}`}
              style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card" style={{ overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ aspectRatio: '16 / 10', overflow: 'hidden', background: '#f1f5f9' }}>
                  <img src={v.main_image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                </div>
                <div className="card-body" style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>{v.make} {v.model}</div>
                  <div className="text-muted" style={{ fontSize: '0.85rem' }}>{v.year} &middot; {v.car_type}</div>
                  <div style={{
                    marginTop: '0.75rem', paddingTop: '0.5rem',
                    borderTop: '1px solid var(--border)',
                    display: 'flex', alignItems: 'baseline', gap: '0.35rem',
                  }}>
                    <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--brand)' }}>
                      ${Number(v.price_per_day).toFixed(2)}
                    </span>
                    <span className="text-muted" style={{ fontSize: '0.85rem' }}>/ dia</span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section style={{ background: '#fff', padding: '3rem 1rem', marginTop: '2rem' }}>
        <div className="container">
          <h2 style={{ textAlign: 'center', marginBottom: '2rem' }}>Por que RentaFacil?</h2>
          <div style={{
            display: 'grid', gap: '1.5rem',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          }}>
            {[
              { t: 'API-first', d: 'Disenado siguiendo el contrato oficial GDS Autos Core API v1.0.0.' },
              { t: 'Sin comisiones ocultas', d: 'El precio que ves es el precio que pagas.' },
              { t: 'Cobertura nacional', d: 'Agencias en las principales ciudades del Ecuador.' },
              { t: 'Idempotente', d: 'Nuestras reservas incluyen Idempotency-Key para evitar cobros duplicados.' },
            ].map((b) => (
              <div key={b.t} style={{ textAlign: 'center' }}>
                <div style={{
                  width: 56, height: 56, borderRadius: '50%', background: 'var(--brand-light)',
                  color: 'var(--brand)', display: 'inline-flex', alignItems: 'center',
                  justifyContent: 'center', fontWeight: 800, fontSize: '1.3rem', marginBottom: '0.75rem',
                }}>✓</div>
                <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>{b.t}</div>
                <div className="text-muted" style={{ fontSize: '0.95rem' }}>{b.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { catalog } from '../api';
import type { Depot, VehicleDetail } from '../types';
import VehiculoCard from '../components/VehiculoCard';
import CarTypeIcon from '../components/CarTypeIcon';

const HOY = new Date().toISOString().slice(0, 10);
const TRES_DIAS = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

const HERO_IMG = 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/BMW_G20_3_Series_Jet_Black_%281%29.jpg/1280px-BMW_G20_3_Series_Jet_Black_%281%29.jpg';

const CATEGORIAS = [
  { code: 'Compacto', label: 'Económico', desc: 'Ciudad y bajo consumo' },
  { code: 'Sedan', label: 'Sedán', desc: 'Confort para carretera' },
  { code: 'SUV', label: 'SUV', desc: 'Espacio y versatilidad' },
  { code: 'Camioneta', label: 'Camioneta', desc: '4x4, carga y aventura' },
  { code: 'Lujo', label: 'Premium', desc: 'Ejecutivo y alta gama' },
];

export default function HomePage() {
  const nav = useNavigate();
  const [depots, setDepots] = useState<Depot[]>([]);
  const [vehiculos, setVehiculos] = useState<VehicleDetail[]>([]);
  const [depotId, setDepotId] = useState('');
  const [ini, setIni] = useState(HOY);
  const [fin, setFin] = useState(TRES_DIAS);

  useEffect(() => {
    catalog.depots().then((r) => setDepots(r.data)).catch(() => {});
    catalog.details().then((r) => setVehiculos(r.data)).catch(() => {});
  }, []);

  const desdePorTipo = useMemo(() => {
    const m: Record<string, number> = {};
    for (const v of vehiculos) {
      const p = Number(v.price_per_day);
      if (m[v.car_type] === undefined || p < m[v.car_type]) m[v.car_type] = p;
    }
    return m;
  }, [vehiculos]);

  const buscar = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams({ depotId, ini, fin });
    nav(`/catalogo?${params.toString()}`);
  };

  return (
    <>
      <section className="hero">
        <div className="container" style={{ position: 'relative', zIndex: 2 }}>
          <div style={{ maxWidth: 620 }}>
            <div className="eyebrow" style={{ color: 'var(--brand)' }}>Alquiler de vehículos en Ecuador</div>
            <h1 style={{
              fontSize: 'clamp(2rem, 4.4vw, 3.1rem)', fontWeight: 800, margin: '0.6rem 0 0', lineHeight: 1.08,
            }}>
              El vehículo correcto para cada viaje.
            </h1>
            <p style={{ fontSize: 'clamp(1rem, 1.5vw, 1.12rem)', color: '#c9cbcf', marginTop: '1rem', maxWidth: 520 }}>
              Disponibilidad en tiempo real en Quito, Guayaquil y Cuenca. Tarifas claras, sin cargos ocultos.
            </p>
          </div>

          <form onSubmit={buscar} className="search-bar">
            <div className="search-field">
              <label className="form-label">Lugar de recogida</label>
              <select className="form-control" value={depotId} onChange={(e) => setDepotId(e.target.value)}>
                <option value="">Todas las agencias</option>
                {depots.map((d) => (
                  <option key={d.depot_id} value={d.depot_id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="search-field">
              <label className="form-label">Fecha de recogida</label>
              <input type="date" className="form-control" value={ini}
                min={HOY} onChange={(e) => setIni(e.target.value)} />
            </div>
            <div className="search-field">
              <label className="form-label">Fecha de devolución</label>
              <input type="date" className="form-control" value={fin}
                min={ini || HOY} onChange={(e) => setFin(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-primary" style={{ padding: '0.8rem 1.6rem', alignSelf: 'end' }}>
              Buscar vehículos
            </button>
          </form>
        </div>
      </section>

      <section className="container" style={{ padding: '3.5rem 1rem 1rem' }}>
        <div className="eyebrow">Categorías</div>
        <h2 style={{ margin: '0.35rem 0 1.5rem' }}>Elige el tipo de vehículo</h2>
        <div className="cat-grid">
          {CATEGORIAS.map((c) => (
            <Link key={c.code} to={`/catalogo?carType=${c.code}`} className="cat-card">
              <div className="cat-icon"><CarTypeIcon type={c.code} size={84} /></div>
              <div className="cat-label">{c.label}</div>
              <div className="cat-desc">{c.desc}</div>
              <div className="cat-price">
                {desdePorTipo[c.code] !== undefined
                  ? <span>Desde <b>${desdePorTipo[c.code].toFixed(0)}</b> / día</span>
                  : <span>&nbsp;</span>}
                <span className="cat-arrow" aria-hidden="true">&rarr;</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="container" style={{ padding: '2.5rem 1rem' }}>
        <div className="flex-between" style={{ marginBottom: '1.5rem', alignItems: 'end' }}>
          <div>
            <div className="eyebrow">Flota</div>
            <h2 style={{ margin: '0.35rem 0 0' }}>Vehículos destacados</h2>
          </div>
          <Link to="/catalogo" className="btn btn-outline btn-sm">Ver toda la flota &rarr;</Link>
        </div>
        <div className="grid">
          {vehiculos.slice(0, 6).map((v) => <VehiculoCard key={v.vehicle_id} vehiculo={v} />)}
        </div>
      </section>

      <section style={{ background: 'var(--ink)', color: '#fff', padding: '3.5rem 1rem', marginTop: '2rem' }}>
        <div className="container">
          <div className="eyebrow" style={{ color: 'var(--brand)' }}>Por qué RentaFacil</div>
          <h2 style={{ margin: '0.35rem 0 2rem' }}>Alquilar un vehículo, sin complicaciones</h2>
          <div style={{
            display: 'grid', gap: '1.5rem',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}>
            {[
              { n: '01', t: 'Precio transparente', d: 'El precio que ves es el precio que pagas. Impuestos y extras detallados antes de confirmar.' },
              { n: '02', t: 'Cobertura nacional', d: 'Agencias en aeropuertos y centros de las principales ciudades del Ecuador.' },
              { n: '03', t: 'Reserva segura', d: 'Cada reserva usa una llave de idempotencia: nunca se duplica un cobro.' },
              { n: '04', t: 'Integración GDS', d: 'Plataforma construida sobre el contrato oficial GDS Autos Core API v1.0.0.' },
            ].map((b) => (
              <div key={b.n} style={{ borderTop: '2px solid var(--brand)', paddingTop: '1rem' }}>
                <div style={{ color: 'var(--brand)', fontWeight: 800, fontSize: '0.85rem', letterSpacing: '0.1em' }}>{b.n}</div>
                <div style={{ fontWeight: 700, fontSize: '1.05rem', margin: '0.4rem 0' }}>{b.t}</div>
                <div style={{ color: '#a9acb2', fontSize: '0.93rem', lineHeight: 1.55 }}>{b.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <style>{`
        .hero {
          background:
            linear-gradient(90deg, rgba(11,13,16,0.97) 0%, rgba(11,13,16,0.88) 45%, rgba(11,13,16,0.35) 100%),
            url('${HERO_IMG}') right 30% center / cover no-repeat,
            var(--ink);
          color: #fff; padding: 4.5rem 0 3.5rem;
        }
        .search-bar {
          background: var(--surface); color: var(--text); border-radius: var(--radius);
          padding: 1rem; margin-top: 2.25rem; display: grid; gap: 0.75rem;
          grid-template-columns: 1.3fr 1fr 1fr auto;
          box-shadow: 0 20px 50px rgba(0,0,0,0.35);
          border-top: 3px solid var(--brand);
        }
        .search-field .form-label {
          font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted);
        }
        @media (max-width: 860px) {
          .search-bar { grid-template-columns: 1fr 1fr; }
          .search-bar .search-field:first-child, .search-bar button { grid-column: 1 / -1; }
        }
        @media (max-width: 480px) {
          .search-bar { grid-template-columns: 1fr; }
        }

        .cat-grid {
          display: grid; gap: 1rem;
          grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
        }
        .cat-card {
          display: flex; flex-direction: column; gap: 0.2rem;
          background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
          padding: 1.25rem 1.25rem 1rem; color: var(--text);
          transition: border-color .18s, box-shadow .18s, transform .18s;
        }
        .cat-card:hover {
          text-decoration: none; border-color: var(--strong);
          box-shadow: var(--shadow-lg); transform: translateY(-2px);
        }
        .cat-icon { color: var(--strong); height: 46px; display: flex; align-items: center; margin-bottom: 0.6rem; }
        .cat-card:hover .cat-icon { color: var(--brand-dark); }
        .cat-label { font-weight: 700; font-size: 1.05rem; }
        .cat-desc { color: var(--text-muted); font-size: 0.85rem; }
        .cat-price {
          margin-top: 0.85rem; padding-top: 0.75rem; border-top: 1px solid var(--border);
          font-size: 0.85rem; color: var(--text-muted);
          display: flex; justify-content: space-between; align-items: center;
        }
        .cat-price b { color: var(--text); }
        .cat-arrow { color: var(--strong); font-weight: 700; transition: transform .18s; }
        .cat-card:hover .cat-arrow { transform: translateX(3px); color: var(--brand-dark); }
      `}</style>
    </>
  );
}

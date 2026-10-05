import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { catalog } from '../api';
import type { CarSearchItem, Depot, VehicleDetail } from '../types';

const HOY = new Date().toISOString().slice(0, 10);
const TRES = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

export default function CatalogoPage() {
  const [params, setParams] = useSearchParams();
  const [depots, setDepots] = useState<Depot[]>([]);
  const [detalles, setDetalles] = useState<Record<string, VehicleDetail>>({});
  const [resultados, setResultados] = useState<CarSearchItem[]>([]);
  const [searchToken, setSearchToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Filtros locales
  const [depotId, setDepotId] = useState(params.get('depotId') || '');
  const [ini, setIni] = useState(params.get('ini') || HOY);
  const [fin, setFin] = useState(params.get('fin') || TRES);
  const [edad, setEdad] = useState(Number(params.get('edad') || 25));
  const [carType, setCarType] = useState(params.get('carType') || '');
  const [transmision, setTransmision] = useState(params.get('tr') || '');

  useEffect(() => {
    catalog.depots().then((r) => setDepots(r.data)).catch(() => {});
    catalog.details().then((r) => {
      const map: Record<string, VehicleDetail> = {};
      for (const d of r.data) map[d.vehicle_id] = d;
      setDetalles(map);
    }).catch(() => {});
  }, []);

  const depot = useMemo(() => depots.find((d) => String(d.depot_id) === depotId), [depots, depotId]);
  const dias = useMemo(() => {
    if (!ini || !fin) return 0;
    const d = Math.ceil((new Date(fin).getTime() - new Date(ini).getTime()) / 86400000);
    return d > 0 ? d : 0;
  }, [ini, fin]);

  const buscar = async () => {
    setLoading(true); setError('');
    try {
      const filters: any = {};
      if (carType) filters.car_types = [carType];
      if (transmision) filters.transmission = [transmision];
      const res = await catalog.search({
        booker: { country: 'ec' },
        currency: 'USD',
        driver: { age: edad },
        route: {
          pickup: {
            datetime: `${ini}T10:00:00Z`,
            location: depot
              ? (depot.location.airport
                  ? { airport: depot.location.airport }
                  : { city_id: depot.location.city_id })
              : {},
          },
          dropoff: {
            datetime: `${fin}T10:00:00Z`,
            location: depot
              ? (depot.location.airport
                  ? { airport: depot.location.airport }
                  : { city_id: depot.location.city_id })
              : {},
          },
        },
        filters: Object.keys(filters).length ? filters : undefined,
      });
      setResultados(res.data);
      setSearchToken(res.search_token);
    } catch (e: any) {
      setError(e?.message || 'Error en la busqueda');
      setResultados([]);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    // Sincronizar URL y ejecutar busqueda
    const next = new URLSearchParams();
    if (depotId) next.set('depotId', depotId);
    next.set('ini', ini); next.set('fin', fin); next.set('edad', String(edad));
    if (carType) next.set('carType', carType);
    if (transmision) next.set('tr', transmision);
    setParams(next, { replace: true });
    if (Object.keys(detalles).length > 0) buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotId, ini, fin, edad, carType, transmision, Object.keys(detalles).length]);

  const limpiar = () => { setDepotId(''); setCarType(''); setTransmision(''); };

  return (
    <div className="container" style={{ padding: '2rem 1rem' }}>
      <h1 style={{ marginTop: 0 }}>Catalogo de vehiculos</h1>
      <p className="text-muted">
        Resultados obtenidos con <code>POST /api/v1/search</code> segun contrato oficial.
      </p>

      <div className="card mb-3">
        <div className="card-body" style={{
          display: 'grid', gap: '0.75rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        }}>
          <div>
            <label className="form-label">Recogida</label>
            <select className="form-control" value={depotId} onChange={(e) => setDepotId(e.target.value)}>
              <option value="">Cualquier agencia</option>
              {depots.map((d) => <option key={d.depot_id} value={d.depot_id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Fecha inicio</label>
            <input type="date" className="form-control" value={ini} min={HOY}
              onChange={(e) => setIni(e.target.value)} />
          </div>
          <div>
            <label className="form-label">Fecha fin</label>
            <input type="date" className="form-control" value={fin} min={ini}
              onChange={(e) => setFin(e.target.value)} />
          </div>
          <div>
            <label className="form-label">Edad conductor</label>
            <input type="number" className="form-control" min={18} max={99}
              value={edad} onChange={(e) => setEdad(Number(e.target.value))} />
          </div>
          <div>
            <label className="form-label">Categoria</label>
            <select className="form-control" value={carType} onChange={(e) => setCarType(e.target.value)}>
              <option value="">Todas</option>
              <option value="Compacto">Compacto</option>
              <option value="Sedan">Sedan</option>
              <option value="SUV">SUV</option>
              <option value="Camioneta">Camioneta</option>
              <option value="Lujo">Lujo</option>
            </select>
          </div>
          <div>
            <label className="form-label">Transmision</label>
            <select className="form-control" value={transmision} onChange={(e) => setTransmision(e.target.value)}>
              <option value="">Todas</option>
              <option value="manual">Manual</option>
              <option value="automatica">Automatica</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button className="btn btn-outline btn-block" onClick={limpiar}>Limpiar</button>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <div className="text-muted text-center" style={{ padding: '2rem' }}>Buscando...</div>
      ) : resultados.length === 0 ? (
        <div className="card"><div className="card-body text-center text-muted">
          No hay vehiculos disponibles con esos filtros.
        </div></div>
      ) : (
        <>
          <div className="text-muted mb-2">{resultados.length} vehiculos disponibles &middot; {dias} dia(s)</div>
          <div className="grid">
            {resultados.map((r) => {
              const d = detalles[r.vehicle_id];
              if (!d) return null;
              return (
                <Link key={r.vehicle_id} to={`/vehiculos/${r.vehicle_id}?token=${searchToken}&ini=${ini}&fin=${fin}&edad=${edad}`}
                  style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="card" style={{
                    overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%',
                    transition: 'transform 0.15s', cursor: 'pointer',
                  }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-4px)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = ''}>
                    <div style={{ aspectRatio: '16 / 10', overflow: 'hidden', background: '#f1f5f9' }}>
                      <img src={d.main_image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                    </div>
                    <div className="card-body" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div className="flex-between">
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{d.make} {d.model}</div>
                          <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                            {d.year} &middot; {d.car_type} &middot; {d.supplier?.name}
                          </div>
                        </div>
                        <span className="badge badge-success">Disponible</span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                        <span>{d.seats} pasajeros</span><span>&middot;</span>
                        <span>{d.transmission}</span><span>&middot;</span>
                        <span>{d.fuel_type}</span>
                      </div>
                      <div style={{
                        marginTop: 'auto', paddingTop: '0.75rem',
                        borderTop: '1px solid var(--border)',
                        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap',
                      }}>
                        <div>
                          <span style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--brand)' }}>
                            ${Number(d.price_per_day).toFixed(2)}
                          </span>
                          <span className="text-muted" style={{ fontSize: '0.85rem' }}>/ dia</span>
                        </div>
                        <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                          Total {dias}d: <b>${r.price.toFixed(2)}</b>
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { catalog } from '../api';
import type { CarSearchItem, Depot, VehicleDetail } from '../types';
import VehiculoCard from '../components/VehiculoCard';
import FechaError from '../components/FechaError';
import { diasEntre, enDias, hayErrores, hoy, validarFechas } from '../utils/reservas';

/** El contrato exige driver.age; la UI no lo solicita y se envía un valor estándar. */
const EDAD_CONDUCTOR = 25;

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
  const [ini, setIni] = useState(params.get('ini') || hoy());
  const [fin, setFin] = useState(params.get('fin') || enDias(3));
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
  const dias = useMemo(() => diasEntre(ini, fin), [ini, fin]);
  const errFechas = validarFechas(ini, fin);
  const fechasInvalidas = hayErrores(errFechas);

  const buscar = async () => {
    setLoading(true); setError('');
    try {
      const filters: any = {};
      if (carType) filters.car_types = [carType];
      if (transmision) filters.transmission = [transmision];
      const res = await catalog.search({
        booker: { country: 'ec' },
        currency: 'USD',
        driver: { age: EDAD_CONDUCTOR },
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
      setError(e?.message || 'Error en la búsqueda');
      setResultados([]);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    // Sincronizar URL y ejecutar la búsqueda (solo con fechas válidas: se validan antes de llamar al backend)
    const next = new URLSearchParams();
    if (depotId) next.set('depotId', depotId);
    next.set('ini', ini); next.set('fin', fin);
    if (carType) next.set('carType', carType);
    if (transmision) next.set('tr', transmision);
    setParams(next, { replace: true });
    if (fechasInvalidas) { setResultados([]); return; }
    if (Object.keys(detalles).length > 0) buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotId, ini, fin, carType, transmision, Object.keys(detalles).length]);

  const limpiar = () => { setDepotId(''); setCarType(''); setTransmision(''); };

  return (
    <div className="container" style={{ padding: '2rem 1rem' }}>
      <div className="eyebrow">Flota disponible</div>
      <h1 style={{ margin: '0.35rem 0 0.25rem' }}>Catálogo de vehículos</h1>
      <p className="text-muted" style={{ marginTop: 0 }}>
        Filtra por agencia, fechas, categoría y transmisión.
      </p>

      <div className="card mb-3">
        <div className="card-body" style={{
          display: 'grid', gap: '0.75rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        }}>
          <div>
            <label className="form-label" htmlFor="cat-depot">Recogida</label>
            <select id="cat-depot" className="form-control" value={depotId} onChange={(e) => setDepotId(e.target.value)}>
              <option value="">Cualquier agencia</option>
              {depots.map((d) => <option key={d.depot_id} value={d.depot_id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="cat-ini">Fecha de inicio</label>
            <input id="cat-ini" type="date" className="form-control" value={ini} min={hoy()}
              onChange={(e) => setIni(e.target.value)}
              aria-invalid={!!errFechas.ini} aria-describedby={errFechas.ini ? 'cat-ini-err' : undefined} />
            <FechaError id="cat-ini-err" mensaje={errFechas.ini} />
          </div>
          <div>
            <label className="form-label" htmlFor="cat-fin">Fecha de fin</label>
            <input id="cat-fin" type="date" className="form-control" value={fin} min={ini || hoy()}
              max={ini ? enDias(90, new Date(`${ini}T00:00:00`)) : undefined}
              onChange={(e) => setFin(e.target.value)}
              aria-invalid={!!errFechas.fin} aria-describedby={errFechas.fin ? 'cat-fin-err' : undefined} />
            <FechaError id="cat-fin-err" mensaje={errFechas.fin} />
          </div>
          <div>
            <label className="form-label" htmlFor="cat-tipo">Categoría</label>
            <select id="cat-tipo" className="form-control" value={carType} onChange={(e) => setCarType(e.target.value)}>
              <option value="">Todas</option>
              <option value="Compacto">Económico</option>
              <option value="Sedan">Sedán</option>
              <option value="SUV">SUV</option>
              <option value="Camioneta">Camioneta</option>
              <option value="Lujo">Premium</option>
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="cat-tr">Transmisión</label>
            <select id="cat-tr" className="form-control" value={transmision} onChange={(e) => setTransmision(e.target.value)}>
              <option value="">Todas</option>
              <option value="manual">Manual</option>
              <option value="automatica">Automática</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button className="btn btn-outline btn-block" onClick={limpiar}>Limpiar</button>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {fechasInvalidas ? (
        <div className="card"><div className="card-body text-center text-muted">
          Corrige las fechas para ver los vehículos disponibles.
        </div></div>
      ) : loading ? (
        <div className="text-muted text-center" style={{ padding: '2rem' }}>Buscando...</div>
      ) : resultados.length === 0 ? (
        <div className="card"><div className="card-body text-center text-muted">
          No hay vehículos disponibles con esos filtros.
        </div></div>
      ) : (
        <>
          <div className="text-muted mb-2"><b style={{ color: 'var(--text)' }}>{resultados.length}</b> vehículos disponibles &middot; {dias} {dias === 1 ? 'día' : 'días'}</div>
          <div className="grid">
            {resultados.map((r) => {
              const d = detalles[r.vehicle_id];
              if (!d) return null;
              return (
                <VehiculoCard key={r.vehicle_id} vehiculo={d} precioTotal={r.price} dias={dias}
                  extraQuery={`token=${searchToken}&ini=${ini}&fin=${fin}`} />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

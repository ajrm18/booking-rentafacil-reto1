import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { catalog } from '../api';
import { autosV2, FRANJAS_30_MIN } from '../api/clientV2';
import type { Depot, VehicleDetail } from '../types';
import type { AutoVehiculoCardV2 } from '../types/v2';
import VehiculoCard from '../components/VehiculoCard';
import FechaError from '../components/FechaError';
import { diasEntre, enDias, hayErrores, hoy, validarFechas } from '../utils/reservas';
import { CATEGORIAS_V2, useFranjaVigente } from '../utils/v2';

/**
 * Catálogo sobre POST /api/v2/autos/search (franjas de 30 min, exclusión de autos en limpieza).
 * Las fichas (fotos, specs) siguen saliendo de /api/v1/details.
 */
export default function CatalogoPage() {
  const [params, setParams] = useSearchParams();
  const [depots, setDepots] = useState<Depot[]>([]);
  const [detalles, setDetalles] = useState<Record<string, VehicleDetail>>({});
  const [resultados, setResultados] = useState<AutoVehiculoCardV2[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [ciudad, setCiudad] = useState(params.get('ciudad') || '');
  const [ini, setIni] = useState(params.get('ini') || hoy());
  const [fin, setFin] = useState(params.get('fin') || enDias(3));
  const [horaIni, setHoraIni] = useState(params.get('hIni') || '10:00');
  const [horaFin, setHoraFin] = useState(params.get('hFin') || '10:00');
  const [categoria, setCategoria] = useState(params.get('cat') || 'ALL');
  const [transmision, setTransmision] = useState(params.get('tr') || 'ALL');

  useEffect(() => {
    catalog.depots().then((r) => setDepots(r.data)).catch(() => {});
    catalog.details().then((r) => {
      const map: Record<string, VehicleDetail> = {};
      for (const d of r.data) map[d.vehicle_id] = d;
      setDetalles(map);
    }).catch(() => {});
  }, []);

  const ciudades = useMemo(() => [...new Set(depots.map((d) => d.city))].sort(), [depots]);
  const dias = useMemo(() => diasEntre(ini, fin), [ini, fin]);
  const franjasIni = useFranjaVigente(ini, horaIni, setHoraIni);
  const errFechas = validarFechas(ini, fin);
  if (!errFechas.ini && franjasIni.length === 0) errFechas.ini = 'Ya no quedan franjas de recogida hoy; elige otra fecha';
  const fechasInvalidas = hayErrores(errFechas);

  const buscar = async () => {
    setLoading(true); setError('');
    try {
      // El contrato exige pickup_location: "Cualquier ciudad" consulta cada ciudad con agencias
      const destinos = ciudad ? [ciudad] : ciudades;
      const respuestas = await Promise.all(destinos.map((c) => autosV2.buscar({
        pickup_location: c, pickup_date: ini, pickup_time: horaIni, dropoff_date: fin, dropoff_time: horaFin,
        category: categoria, transmission: transmision,
      })));
      setResultados(respuestas.flatMap((r) => r.data).sort((a, b) => a.precio_total - b.precio_total));
    } catch (e: any) {
      setError(e?.message || 'Error en la búsqueda');
      setResultados([]);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    const next = new URLSearchParams();
    if (ciudad) next.set('ciudad', ciudad);
    next.set('ini', ini); next.set('fin', fin); next.set('hIni', horaIni); next.set('hFin', horaFin);
    if (categoria !== 'ALL') next.set('cat', categoria);
    if (transmision !== 'ALL') next.set('tr', transmision);
    setParams(next, { replace: true });
    if (fechasInvalidas) { setResultados([]); return; }
    if (Object.keys(detalles).length > 0 && ciudades.length > 0) buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ciudad, ini, fin, horaIni, horaFin, categoria, transmision, Object.keys(detalles).length, ciudades.length]);

  const limpiar = () => { setCiudad(''); setCategoria('ALL'); setTransmision('ALL'); setHoraIni('10:00'); setHoraFin('10:00'); };
  const franja = (id: string, label: string, valor: string, set: (v: string) => void, opciones = FRANJAS_30_MIN) => (
    <div>
      <label className="form-label" htmlFor={id}>{label}</label>
      <select id={id} className="form-control" value={valor} onChange={(e) => set(e.target.value)}>
        {opciones.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </div>
  );

  return (
    <div className="container" style={{ padding: '2rem 1rem' }}>
      <div className="eyebrow">Flota disponible</div>
      <h1 style={{ margin: '0.35rem 0 0.25rem' }}>Catálogo de vehículos</h1>
      <p className="text-muted" style={{ marginTop: 0 }}>
        Filtra por ciudad, fechas y franjas de 30 minutos, categoría y transmisión.
      </p>

      <div className="card mb-3">
        <div className="card-body" style={{
          display: 'grid', gap: '0.75rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        }}>
          <div>
            <label className="form-label" htmlFor="cat-ciudad">Recogida</label>
            <select id="cat-ciudad" className="form-control" value={ciudad} onChange={(e) => setCiudad(e.target.value)}>
              <option value="">Cualquier ciudad</option>
              {ciudades.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="cat-ini">Fecha de inicio</label>
            <input id="cat-ini" type="date" className="form-control" value={ini} min={hoy()}
              onChange={(e) => setIni(e.target.value)}
              aria-invalid={!!errFechas.ini} aria-describedby={errFechas.ini ? 'cat-ini-err' : undefined} />
            <FechaError id="cat-ini-err" mensaje={errFechas.ini} />
          </div>
          {franja('cat-hini', 'Hora de recogida', horaIni, setHoraIni, franjasIni)}
          <div>
            <label className="form-label" htmlFor="cat-fin">Fecha de fin</label>
            <input id="cat-fin" type="date" className="form-control" value={fin} min={ini || hoy()}
              max={ini ? enDias(90, new Date(`${ini}T00:00:00`)) : undefined}
              onChange={(e) => setFin(e.target.value)}
              aria-invalid={!!errFechas.fin} aria-describedby={errFechas.fin ? 'cat-fin-err' : undefined} />
            <FechaError id="cat-fin-err" mensaje={errFechas.fin} />
          </div>
          {franja('cat-hfin', 'Hora de devolución', horaFin, setHoraFin)}
          <div>
            <label className="form-label" htmlFor="cat-tipo">Categoría</label>
            <select id="cat-tipo" className="form-control" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="ALL">Todas</option>
              {Object.entries(CATEGORIAS_V2).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="cat-tr">Transmisión</label>
            <select id="cat-tr" className="form-control" value={transmision} onChange={(e) => setTransmision(e.target.value)}>
              <option value="ALL">Todas</option>
              <option value="MANUAL">Manual</option>
              <option value="AUTOMATICO">Automática</option>
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
          No hay vehículos disponibles con esos filtros. Los vehículos recién devueltos vuelven a la oferta tras 2 horas de limpieza.
        </div></div>
      ) : (
        <>
          <div className="text-muted mb-2"><b style={{ color: 'var(--text)' }}>{resultados.length}</b> vehículos disponibles &middot; {dias} {dias === 1 ? 'día' : 'días'}</div>
          <div className="grid">
            {resultados.map((r) => {
              const d = detalles[r.vehicle_id];
              if (!d) return null;
              return (
                <VehiculoCard key={r.vehicle_id} vehiculo={d} precioTotal={r.precio_total} dias={dias}
                  extraQuery={`ini=${ini}&fin=${fin}&hIni=${encodeURIComponent(horaIni)}&hFin=${encodeURIComponent(horaFin)}`} />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

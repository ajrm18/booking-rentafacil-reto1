import { Link } from 'react-router-dom';
import type { VehicleDetail } from '../types';

interface Props {
  vehiculo: VehicleDetail;
  precioTotal?: number;
  dias?: number;
  extraQuery?: string;
}

export default function VehiculoCard({ vehiculo, precioTotal, dias, extraQuery }: Props) {
  const img = vehiculo.main_image_url ||
    'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=800';
  const url = `/vehiculos/${vehiculo.vehicle_id}${extraQuery ? `?${extraQuery}` : ''}`;

  return (
    <Link to={url} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="card" style={{
        overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%',
        transition: 'transform 0.15s, box-shadow 0.15s', cursor: 'pointer',
      }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-4px)';
          e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = '';
          e.currentTarget.style.boxShadow = '';
        }}>
        <div style={{ aspectRatio: '16 / 10', overflow: 'hidden', background: '#f1f5f9' }}>
          <img src={img} alt={`${vehiculo.make} ${vehiculo.model}`}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '0.5rem' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>
                {vehiculo.make} {vehiculo.model}
              </div>
              <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                {vehiculo.year} &middot; {vehiculo.car_type}
              </div>
            </div>
            <span className="badge badge-success">Disponible</span>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
            <span>{vehiculo.seats} pasajeros</span><span>&middot;</span>
            <span>{vehiculo.transmission}</span><span>&middot;</span>
            <span>{vehiculo.fuel_type}</span>
          </div>
          <div style={{
            marginTop: 'auto', paddingTop: '0.75rem',
            display: 'flex', alignItems: 'baseline', gap: '0.35rem',
            borderTop: '1px solid var(--border)', justifyContent: 'space-between', flexWrap: 'wrap',
          }}>
            <div>
              <span style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--brand)' }}>
                ${Number(vehiculo.price_per_day).toFixed(2)}
              </span>
              <span className="text-muted" style={{ fontSize: '0.85rem' }}> / dia</span>
            </div>
            {precioTotal !== undefined && dias !== undefined && (
              <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                Total {dias}d: <b>${precioTotal.toFixed(2)}</b>
              </div>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

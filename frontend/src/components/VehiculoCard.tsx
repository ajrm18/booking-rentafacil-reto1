import { Link } from 'react-router-dom';
import type { VehicleDetail } from '../types';

export const ETIQUETA_CATEGORIA: Record<string, string> = {
  Compacto: 'Económico', Sedan: 'Sedán', SUV: 'SUV', Camioneta: 'Camioneta', Lujo: 'Premium',
};

interface Props {
  vehiculo: VehicleDetail;
  precioTotal?: number;
  dias?: number;
  extraQuery?: string;
}

export default function VehiculoCard({ vehiculo, precioTotal, dias, extraQuery }: Props) {
  const url = `/vehiculos/${vehiculo.vehicle_id}${extraQuery ? `?${extraQuery}` : ''}`;

  return (
    <Link to={url} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="card veh-card" style={{
        overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%', cursor: 'pointer',
      }}>
        <div style={{ aspectRatio: '16 / 10', overflow: 'hidden', background: '#e9e9e6', position: 'relative' }}>
          {vehiculo.main_image_url && (
            <img src={vehiculo.main_image_url} alt={`${vehiculo.make} ${vehiculo.model}`}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
          )}
          <span style={{
            position: 'absolute', top: 12, left: 12, background: 'rgba(11,13,16,0.85)', color: '#fff',
            fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            padding: '0.3rem 0.6rem', borderRadius: 6,
          }}>{ETIQUETA_CATEGORIA[vehiculo.car_type] || vehiculo.car_type}</span>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', flex: 1 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1.08rem' }}>
              {vehiculo.make} {vehiculo.model}
            </div>
            <div className="text-muted" style={{ fontSize: '0.85rem' }}>
              {vehiculo.year}{vehiculo.supplier?.name ? <> &middot; {vehiculo.supplier.name}</> : null}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            <Spec>{vehiculo.seats} pasajeros</Spec>
            <Spec>{vehiculo.transmission === 'automatica' ? 'Automática' : vehiculo.transmission}</Spec>
            <Spec>{vehiculo.fuel_type === 'hibrido' ? 'Híbrido' : vehiculo.fuel_type === 'diesel' ? 'Diésel' : vehiculo.fuel_type}</Spec>
          </div>
          <div style={{
            marginTop: 'auto', paddingTop: '0.75rem',
            display: 'flex', alignItems: 'baseline', gap: '0.35rem',
            borderTop: '1px solid var(--border)', justifyContent: 'space-between', flexWrap: 'wrap',
          }}>
            <div>
              <span className="price">${Number(vehiculo.price_per_day).toFixed(2)}</span>
              <span className="text-muted" style={{ fontSize: '0.85rem' }}> / día</span>
            </div>
            {precioTotal !== undefined && dias !== undefined ? (
              <div className="text-muted" style={{ fontSize: '0.82rem' }}>
                Total {dias} {dias === 1 ? 'día' : 'días'}: <b style={{ color: 'var(--text)' }}>${precioTotal.toFixed(2)}</b>
              </div>
            ) : (
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>Ver detalle &rarr;</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

function Spec({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: '0.75rem', color: 'var(--text-muted)', background: '#f2f2ef',
      border: '1px solid var(--border)', borderRadius: 6, padding: '0.2rem 0.5rem',
      textTransform: 'capitalize',
    }}>{children}</span>
  );
}

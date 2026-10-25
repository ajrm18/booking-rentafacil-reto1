import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ordenesV2 } from '../api/clientV2';
import type { AutoOrderResponseV2 } from '../types/v2';
import { fechaCorta } from '../utils/reservas';
import { estadoOrdenV2 } from '../utils/v2';
import VoucherQR from '../components/VoucherQR';

export default function ReservaConfirmadaPage() {
  const { orderId } = useParams();
  const [orden, setOrden] = useState<AutoOrderResponseV2 | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!orderId) return;
    // GET /api/v2/autos/orders/{orderId} acepta el UUID o el PNR
    ordenesV2.obtener(orderId).then(setOrden).catch((e) => setError(e?.message || 'No se encontró la orden'));
  }, [orderId]);

  if (error) return (
    <div className="container" style={{ padding: '2rem 1rem', maxWidth: 640 }}>
      <div className="alert alert-danger">{error}</div>
      <Link to="/" className="btn btn-primary">Volver al inicio</Link>
    </div>
  );
  if (!orden) return <div className="container" style={{ padding: '2rem 1rem' }}>Cargando...</div>;

  const est = estadoOrdenV2(orden);
  const d = orden.total_price.desglose;
  return (
    <div className="container" style={{ padding: '3rem 1rem', maxWidth: 640 }}>
      <div className="card">
        <div className="card-body">
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <div style={{
              width: 72, height: 72, borderRadius: '50%', background: 'var(--success-bg)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '2rem', color: 'var(--success)', marginBottom: '0.5rem',
            }}>✓</div>
            <h1 style={{ margin: 0 }}>Reserva confirmada</h1>
            <div className="text-muted">Tu reserva se registró correctamente.</div>
          </div>

          <div style={{
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            padding: '1rem', borderRadius: 'var(--radius)', marginBottom: '1rem',
          }}>
            <div className="flex-between"><span>Localizador (PNR)</span><code style={{ fontSize: '1rem' }}>{orden.pnr}</code></div>
            <div className="flex-between"><span>ID de la orden</span><code style={{ fontSize: '0.8rem' }}>{orden.order_id}</code></div>
            <div className="flex-between"><span>Estado</span><span className={`badge ${est.badge}`}>{est.label}</span></div>
            {orden.recogida.fecha_hora && (
              <div className="flex-between"><span>Fechas</span>
                <span>{fechaCorta(orden.recogida.fecha_hora)} – {fechaCorta(orden.devolucion.fecha_hora ?? undefined)}</span>
              </div>
            )}
            <div className="flex-between"><span>Vehículo</span><b>{orden.vehiculo.marca} {orden.vehiculo.modelo}</b></div>
            <div className="flex-between"><span>Cobertura</span><span>{orden.tipo_cobertura === 'TOTAL' ? 'Total (franquicia $0)' : 'Básica'}</span></div>
            {d?.recargo_edad > 0 && <div className="flex-between"><span>Recargo por edad</span><span>${Number(d.recargo_edad).toFixed(2)}</span></div>}
            {orden.deposito_garantia > 0 && (
              <div className="flex-between"><span>Depósito de garantía (en mostrador)</span><span>${Number(orden.deposito_garantia).toFixed(2)}</span></div>
            )}
            <div className="flex-between" style={{ borderTop: '1px solid var(--border)', paddingTop: '0.5rem', marginTop: '0.5rem' }}>
              <span>Total</span><b>${Number(orden.total_price.total).toFixed(2)} {orden.total_price.currency}</b>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <VoucherQR data={orden.voucher_qr_data} size={132} />
            <div style={{ flex: 1, minWidth: 200, fontSize: '0.88rem' }}>
              <b>Presenta este código en el mostrador.</b>
              <div className="text-muted mt-1">
                Haz el <b>check-in digital</b> desde "Mis reservas" para retirar las llaves por la vía rápida (fast-track).
              </div>
              <ul className="text-muted" style={{ paddingLeft: '1.1rem', marginBottom: 0 }}>
                {orden.checklist_mostrador.slice(0, 3).map((c) => <li key={c}>{c}</li>)}
              </ul>
            </div>
          </div>

          <div className="flex" style={{ gap: '0.5rem' }}>
            <Link to="/mis-reservas" className="btn btn-primary btn-block">Ver mis reservas</Link>
            <Link to="/catalogo" className="btn btn-outline btn-block">Seguir buscando</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { admin, orders as ordersApi } from '../api';
import type { OrderDetail } from '../types';
import Modal from '../components/Modal';
import { estadoOrden, fechaCorta as fecha, fechaHora } from '../utils/reservas';


export default function OrdersAdmin() {
  const [lista, setLista] = useState<OrderDetail[]>([]);
  const [filtro, setFiltro] = useState('todas');
  /** Orden cuya devolución se está confirmando en el modal. */
  const [retorno, setRetorno] = useState<OrderDetail | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errRetorno, setErrRetorno] = useState('');

  const cargar = () => admin.listOrders(filtro === 'todas' ? undefined : filtro).then(setLista);
  useEffect(() => { cargar(); }, [filtro]);

  const cancelar = async (id: string) => {
    if (!confirm('¿Cancelar esta orden?')) return;
    try { await ordersApi.cancel(id); cargar(); }
    catch (e: any) { alert(e?.message || 'Error'); }
  };

  const abrirRetorno = (o: OrderDetail) => { setRetorno(o); setErrRetorno(''); };

  const registrarRetorno = async () => {
    if (!retorno) return;
    setGuardando(true); setErrRetorno('');
    try {
      await admin.returnOrder(retorno.order_id);
      setRetorno(null);
      cargar();
    } catch (e: any) {
      setErrRetorno(e?.message || 'No se pudo registrar la devolución');
    } finally { setGuardando(false); }
  };

  return (
    <div>
      <div className="flex-between mb-2">
        <h1 style={{ margin: 0 }}>Órdenes</h1>
        <select className="form-control" style={{ maxWidth: 200 }} aria-label="Filtrar por estado"
          value={filtro} onChange={(e) => setFiltro(e.target.value)}>
          <option value="todas">Todas</option>
          <option value="CONFIRMED">Confirmadas y finalizadas</option>
          <option value="CANCELLED">Canceladas</option>
          <option value="PENDING">Pendientes</option>
        </select>
      </div>

      <div className="table-wrapper">
        <table className="table">
          <thead><tr>
            <th>Localizador</th><th>Vehículo</th><th>Cliente</th><th>Fechas</th><th>Total</th><th>Estado</th><th>Creada</th><th></th>
          </tr></thead>
          <tbody>
            {lista.map((r) => {
              const est = estadoOrden(r);
              const puedeDevolver = r.status === 'CONFIRMED' && !r.returned_at;
              return (
                <tr key={r.order_id}>
                  <td><code>{r.locator}</code></td>
                  <td>
                    {r.vehicle_details?.make} {r.vehicle_details?.model}
                    <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                      <code>{r.vehicle_details?.vehicle_id}</code>
                    </div>
                  </td>
                  <td style={{ fontSize: '0.85rem' }}>{r.owner_sub || '—'}</td>
                  <td style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                    {fecha(r.route_details?.pickup?.datetime)} – {fecha(r.route_details?.dropoff?.datetime)}
                  </td>
                  <td>${Number(r.total_price).toFixed(2)} {r.currency}</td>
                  <td>
                    <span className={`badge ${est.badge}`}>{est.label}</span>
                    {r.returned_at && (
                      <div style={{ marginTop: 4 }}>
                        <span className="badge badge-success" style={{ whiteSpace: 'nowrap' }} title={r.returned_by_sub ? `Registrado por ${r.returned_by_sub}` : undefined}>
                          DEVUELTO el {fechaHora(r.returned_at)}
                        </span>
                      </div>
                    )}
                  </td>
                  <td>{new Date(r.creation_date).toLocaleString('es-EC')}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {puedeDevolver && (
                      <button className="btn btn-success btn-sm" onClick={() => abrirRetorno(r)}>Registrar retorno</button>
                    )}{' '}
                    {est.activa && r.status === 'CONFIRMED' && (
                      <button className="btn btn-danger btn-sm" onClick={() => cancelar(r.order_id)}>Cancelar</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {retorno && (
        <Modal titulo="Registrar retorno del vehículo" onClose={() => setRetorno(null)} bloqueado={guardando}>
          <p>
            ¿Confirmas que el cliente devolvió el <strong>{retorno.vehicle_details?.make} {retorno.vehicle_details?.model}</strong>{' '}
            de la orden <code>{retorno.locator}</code>?
          </p>
          <p className="text-muted" style={{ fontSize: '0.9rem' }}>
            La orden se mantiene confirmada. El vehículo pasa a <strong>lavado durante 24 horas</strong> y
            luego vuelve a estar disponible automáticamente.
          </p>
          {errRetorno && <div className="alert alert-danger">{errRetorno}</div>}
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-outline" type="button" disabled={guardando} onClick={() => setRetorno(null)}>Volver</button>
            <button className="btn btn-success" type="button" disabled={guardando} onClick={registrarRetorno}>
              {guardando ? 'Registrando…' : 'Confirmar retorno'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

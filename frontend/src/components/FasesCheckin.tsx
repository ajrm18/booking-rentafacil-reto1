import type { AutoOrderResponseV2 } from '../types/v2';
import { fechaHoraLocal, km } from '../utils/v2';

/** Las 3 fases presenciales del contrato v2 (digital, entrega en mostrador, devolución en patio) con sus marcas de tiempo. */
export default function FasesCheckin({ orden }: { orden: AutoOrderResponseV2 }) {
  const { digital, entrega, devolucion } = orden.checkins;
  const fases = [
    { titulo: '1. Check-in digital', hecho: digital.completado, at: digital.at, detalle: digital.licencia_verificada ? `Licencia ${digital.licencia_verificada}` : 'Fast-track opcional antes de recoger' },
    { titulo: '2. Entrega en mostrador', hecho: entrega.completado, at: entrega.at, detalle: entrega.completado ? `Salida: ${km(entrega.km_salida)}${entrega.tecnico_entrega ? ` · ${entrega.tecnico_entrega}` : ''}` : 'Licencia física y odómetro inicial' },
    {
      titulo: '3. Devolución en patio', hecho: devolucion.completado, at: devolucion.at,
      detalle: devolucion.completado
        ? `Retorno: ${km(devolucion.km_retorno)}${devolucion.km_recorridos != null ? ` · ${km(devolucion.km_recorridos)} recorridos` : ''}${devolucion.nivel_combustible != null ? ` · combustible ${devolucion.nivel_combustible}%` : ''}`
        : 'Odómetro final; inicia 2 h de limpieza',
    },
  ];
  return (
    <ol aria-label="Fases de check-in" style={{ listStyle: 'none', padding: 0, margin: '0.75rem 0 0', display: 'grid', gap: '0.4rem' }}>
      {fases.map((f) => (
        <li key={f.titulo} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
          <span aria-hidden="true" style={{
            flex: '0 0 auto', width: 20, height: 20, borderRadius: '50%', marginTop: 2,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700,
            background: f.hecho ? 'var(--success)' : 'transparent', color: f.hecho ? '#fff' : 'var(--text-muted)',
            border: f.hecho ? 'none' : '2px solid var(--border)',
          }}>{f.hecho ? '✓' : ''}</span>
          <div style={{ fontSize: '0.85rem' }}>
            <div style={{ fontWeight: 600 }}>
              {f.titulo} <span className="text-muted" style={{ fontWeight: 400 }}>{f.hecho ? `· ${fechaHoraLocal(f.at)}` : '· pendiente'}</span>
            </div>
            <div className="text-muted" style={{ fontSize: '0.78rem' }}>{f.detalle}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

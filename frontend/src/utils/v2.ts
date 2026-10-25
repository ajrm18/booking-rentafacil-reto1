import { useEffect } from 'react';
import { FRANJAS_30_MIN } from '../api/clientV2';
import type { AutoOrderResponseV2, EstadoVehiculo } from '../types/v2';

/** Fecha YYYY-MM-DD y hora HH:MM actuales en Ecuador (UTC-5), la zona con la que el backend interpreta las franjas. */
function ahoraEc(): { fecha: string; hora: string } {
  const iso = new Date(Date.now() - 5 * 3600_000).toISOString();
  return { fecha: iso.slice(0, 10), hora: iso.slice(11, 16) };
}

/** Franjas de recogida que aún no pasaron para esa fecha (todas si es un día futuro). */
export function franjasDisponibles(fecha: string): string[] {
  const { fecha: hoyEc, hora } = ahoraEc();
  if (fecha > hoyEc) return FRANJAS_30_MIN;
  if (fecha < hoyEc) return [];
  return FRANJAS_30_MIN.filter((h) => h > hora);
}

/** Si la franja elegida ya pasó (p. ej. "10:00" de hoy a las 18:00), salta a la primera disponible. */
export function useFranjaVigente(fecha: string, hora: string, setHora: (h: string) => void): string[] {
  const opciones = franjasDisponibles(fecha);
  useEffect(() => {
    if (opciones.length && !opciones.includes(hora)) setHora(opciones[0]);
  }, [fecha, hora, opciones.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return opciones;
}

/** Las 6 fases de la máquina de estados del contrato v2. */
export const FASE_VEHICULO: Record<EstadoVehiculo, { label: string; badge: string }> = {
  DISPONIBLE: { label: 'Disponible', badge: 'badge-success' },
  RESERVADO: { label: 'Reservado', badge: 'badge-muted' },
  LISTO_PARA_ENTREGAR: { label: 'Listo para entregar', badge: 'badge-muted' },
  ENTREGADO: { label: 'Entregado (en uso)', badge: 'badge-muted' },
  EN_LIMPIEZA: { label: 'En limpieza', badge: 'badge-warning' },
  EN_MANTENIMIENTO: { label: 'En mantenimiento', badge: 'badge-danger' },
};

/** Estado visible de una orden v2 (CONFIRMED -> CHECKIN_COMPLETED -> ENTREGADO -> COMPLETADA, o CANCELLED). */
export function estadoOrdenV2(o: Pick<AutoOrderResponseV2, 'status'>): { label: string; badge: string } {
  switch (o.status) {
    case 'CANCELLED': return { label: 'Cancelada', badge: 'badge-danger' };
    case 'COMPLETADA': return { label: 'Finalizada', badge: 'badge-muted' };
    case 'ENTREGADO': return { label: 'En curso', badge: 'badge-success' };
    case 'CHECKIN_COMPLETED': return { label: 'Check-in listo', badge: 'badge-success' };
    case 'PENDING': return { label: 'Pendiente', badge: 'badge-warning' };
    default: return { label: 'Confirmada', badge: 'badge-success' };
  }
}

export const CATEGORIAS_V2: Record<string, string> = {
  ECONOMICO: 'Económico', COMPACTO: 'Sedán / Compacto', SUV: 'SUV', PREMIUM: 'Premium', VAN: 'Camioneta / Van',
};

/** HH:MM:SS de un conteo regresivo en segundos. */
export function cronometro(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

export const km = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('es-EC')} km`);

/** Fecha y hora local corta (DD/MM/YYYY HH:mm). */
export function fechaHoraLocal(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' });
}

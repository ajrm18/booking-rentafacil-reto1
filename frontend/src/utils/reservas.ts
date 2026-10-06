/** Utilidades compartidas de reservas: fechas y estado visible de una orden. */

export const MAX_DIAS_ALQUILER = 90;
const MS_DIA = 86_400_000;

/** Fecha local YYYY-MM-DD (no toISOString: en Ecuador, después de las 19:00 la fecha UTC ya es "mañana"). */
export function fechaLocal(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const hoy = () => fechaLocal();
export const enDias = (n: number, desde = new Date()) => fechaLocal(new Date(desde.getTime() + n * MS_DIA));

export function diasEntre(ini: string, fin: string): number {
  if (!ini || !fin) return 0;
  const d = Math.round((Date.parse(`${fin}T00:00:00`) - Date.parse(`${ini}T00:00:00`)) / MS_DIA);
  return d > 0 ? d : 0;
}

export interface ErroresFechas { ini?: string; fin?: string }

/**
 * Valida el rango de alquiler en el cliente, con las mismas reglas que el backend
 * (/orders/preview y /orders/create): inicio no pasado, fin posterior e intervalo de 1 a 90 días.
 */
export function validarFechas(ini: string, fin: string): ErroresFechas {
  const e: ErroresFechas = {};
  if (!ini) e.ini = 'Selecciona la fecha de inicio';
  else if (ini < hoy()) e.ini = 'La fecha de inicio no puede ser en el pasado';
  if (!fin) e.fin = 'Selecciona la fecha de fin';
  else if (ini && fin <= ini) e.fin = 'La fecha de fin debe ser posterior a la de inicio';
  else if (ini && diasEntre(ini, fin) > MAX_DIAS_ALQUILER) e.fin = `El alquiler no puede superar los ${MAX_DIAS_ALQUILER} días`;
  return e;
}

export const hayErrores = (e: ErroresFechas) => Boolean(e.ini || e.fin);

/**
 * Estado mostrado al usuario. "Finalizada" no es un estado del contrato (OrderDetail.status solo
 * admite CONFIRMED | CANCELLED | PENDING): es una orden CONFIRMED cuya fecha de devolución ya pasó.
 */
export function estadoOrden(o: { status: string; route_details?: any }): { label: string; badge: string; activa: boolean } {
  if (o.status === 'CANCELLED') return { label: 'Cancelada', badge: 'badge-danger', activa: false };
  if (o.status === 'PENDING') return { label: 'Pendiente', badge: 'badge-warning', activa: true };
  const fin = o.route_details?.dropoff?.datetime;
  if (fin && Date.parse(fin) < Date.now()) return { label: 'Finalizada', badge: 'badge-muted', activa: false };
  return { label: 'Confirmada', badge: 'badge-success', activa: true };
}

export const fechaCorta = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('es-EC') : '—');

/** Etiquetas visibles de los códigos de la API (que siguen sin tildes: 'automatica', 'hibrido'...). */
const ETIQUETAS: Record<string, string> = {
  manual: 'Manual', automatica: 'Automática',
  gasolina: 'Gasolina', diesel: 'Diésel', hibrido: 'Híbrido', electrico: 'Eléctrico',
};
export const etiqueta = (codigo?: string) => (codigo ? ETIQUETAS[codigo] ?? codigo : '');

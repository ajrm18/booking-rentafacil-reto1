import axios from 'axios';
import { API_V3, uuidv4 } from './client';

/**
 * Cliente de /api/v3 (contrato v3.0.0 + requerimiento v3.1): clientes cross-platform, buscador
 * del mostrador, check-in asistido con notificacion al Booking y alta de vehiculos con stock.
 */
export const apiV3 = axios.create({ baseURL: API_V3 });

apiV3.interceptors.request.use((config) => {
  const headers: any = config.headers || {};
  const token = localStorage.getItem('rf_token');
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!headers['X-Correlation-Id']) headers['X-Correlation-Id'] = `web-${uuidv4()}`;
  config.headers = headers;
  return config;
});

apiV3.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error?.response?.status === 401) {
      localStorage.removeItem('rf_token');
      localStorage.removeItem('rf_user');
    }
    const pd = error?.response?.data;
    if (pd?.title) {
      const motivos = Array.isArray(pd.invalid_params) ? pd.invalid_params.map((p: any) => p.reason).join('. ') : '';
      error.message = motivos || pd.detail || pd.title;
      error.code = pd.code;
    } else if (!error?.response) {
      error.message = 'No se pudo conectar con el servidor. Intenta de nuevo en unos segundos.';
    }
    return Promise.reject(error);
  },
);

const conClave = (clave: string = uuidv4()) => ({ headers: { 'Idempotency-Key': clave } });

export type EstadoMostrador = 'RESERVADO' | 'PENDIENTE_ENTREGA' | 'CONFIRMADO_ASISTIDO' | 'EN_LIMPIEZA' | 'COMPLETADA' | 'CANCELLED' | 'VENCIDA';
export type TipoBusqueda = 'EMAIL' | 'IDENTIFICACION' | 'PNR';

export interface TarjetaReserva {
  order_id: string;
  pnr: string;
  estado_mostrador: EstadoMostrador;
  puede_entregar: boolean;
  puede_devolver: boolean;
  vehiculo: { vehicle_id: string; marca: string; modelo: string; placa: string | null; anio: number | null; foto_url: string | null; estado: string | null; kilometraje_actual: number | null };
  cliente: { client_id: string | null; nombre: string | null; identificacion: string | null; email: string | null; telefono: string | null; licencia: string | null };
  recogida: { fecha_hora: string | null; lugar: string | null };
  devolucion: { fecha_hora: string | null; lugar: string | null };
  total: number;
  moneda: string;
  tipo_cobertura: string | null;
  checkin_entrega: { at: string; km_salida: number; admin_id: string } | null;
  notificacion_booking: { id: string; status: 'PENDING' | 'SENT' | 'FAILED'; attempts: number; last_status_code: number | null; sent_at: string | null } | null;
}

export interface ResultadoBusqueda { q: string; tipo_detectado: TipoBusqueda; total: number; resultados: TarjetaReserva[] }

export interface Cliente {
  client_id: string; nombre: string; email: string; identificacion: string;
  telefono: string | null; licencia: string | null; origen: 'LOCAL' | 'BOOKING' | 'WEB'; created_at: string; updated_at: string;
}

/** Misma regla que el backend: @ -> email; 10 digitos -> cedula; si no -> PNR. */
export function detectarTipo(q: string): TipoBusqueda {
  const t = q.trim();
  if (t.includes('@')) return 'EMAIL';
  if (/^\d{10}$/.test(t)) return 'IDENTIFICACION';
  return 'PNR';
}

export const mostradorV3 = {
  buscar: (q: string, signal?: AbortSignal) =>
    apiV3.get<ResultadoBusqueda>('/autos/orders/buscar', { params: { q }, signal }).then((r) => r.data),
  checkinEntrega: (ref: string, body: { licencia_conducir: string; km_salida: number; acepta_contrato: boolean }) =>
    apiV3.post<any>(`/autos/orders/${ref}/checkin-entrega`, body, conClave()).then((r) => r.data),
  checkinDevolucion: (ref: string, body: { km_retorno: number; nivel_combustible?: number; observaciones?: string }) =>
    apiV3.post<any>(`/autos/orders/${ref}/checkin-devolucion`, body, conClave()).then((r) => r.data),
};

export const clientesV3 = {
  listar: (q?: string) => apiV3.get<{ total: number; data: Cliente[] }>('/admin/clientes', { params: { q: q || undefined, limit: 100 } }).then((r) => r.data),
  obtener: (id: string) => apiV3.get<Cliente>(`/admin/clientes/${id}`).then((r) => r.data),
  actualizar: (id: string, body: Partial<Cliente>) => apiV3.patch<Cliente>(`/admin/clientes/${id}`, body).then((r) => r.data),
  /** POST /api/v3/clientes: 201 nuevo o 200 existente (anti-duplicados). */
  crear: (body: { nombre: string; email: string; identificacion: string; telefono?: string; licencia?: string }) =>
    apiV3.post<any>('/clientes', body).then((r) => ({ status: r.status, data: r.data })),
};

export const vehiculosV3 = {
  opciones: () => apiV3.get<{ depots: { depot_id: number; name: string; city: string }[]; suppliers: { supplier_id: number; name: string }[] }>('/admin/vehicles/opciones').then((r) => r.data),
  crear: (body: Record<string, any>) => apiV3.post<any>('/admin/vehicles', body).then((r) => r.data),
};

export const saludV3 = {
  health: () => apiV3.get<any>('/autos/health', { validateStatus: (s) => s === 200 || s === 503 }).then((r) => r.data),
};

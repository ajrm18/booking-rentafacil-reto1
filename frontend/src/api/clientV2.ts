import axios from 'axios';
import { uuidv4 } from './client';
import type {
  AutoFlotaItemV2, AutoOrderResponseV2, AutosHealthResponseV2, CloudEventFeed, ContratoPromociones,
  CoberturaOpcion, CreateAutoOrderRequestV2, SearchAutosRequestV2, SearchAutosResponseV2,
} from '../types/v2';

/**
 * Cliente de /api/v2 (backend/contracts/autos-openapi-v2.yaml). Por defecto se deriva de
 * VITE_API_URL cambiando /api/v1 por /api/v2, asi no hace falta otra variable en Vercel.
 */
const v1 = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
const baseURL = import.meta.env.VITE_API_V2_URL || v1.replace(/\/api\/v1\/?$/, '/api/v2');

export const apiV2 = axios.create({ baseURL });

apiV2.interceptors.request.use((config) => {
  const headers: any = config.headers || {};
  const token = localStorage.getItem('rf_token');
  if (token) headers.Authorization = `Bearer ${token}`;
  // Trazabilidad end-to-end: el backend la devuelve en la respuesta y en los CloudEvents
  if (!headers['X-Correlation-Id']) headers['X-Correlation-Id'] = `web-${uuidv4().slice(0, 13)}`;
  config.headers = headers;
  return config;
});

apiV2.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error?.response?.status === 401) {
      localStorage.removeItem('rf_token');
      localStorage.removeItem('rf_user');
    }
    // Problem Details v2 (RFC 7807): invalid_params > detail > title
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

/** Las mutaciones exigen Idempotency-Key (UUID v4); quien reintenta debe reusar la misma clave. */
const conClave = (clave: string = uuidv4()) => ({ headers: { 'Idempotency-Key': clave } });

export const autosV2 = {
  listar: (params?: { category?: string; transmission?: string; limit?: number }) =>
    apiV2.get<{ total: number; limit: number; data: any[] }>('/autos', { params }).then((r) => r.data),
  buscar: (req: SearchAutosRequestV2) => apiV2.post<SearchAutosResponseV2>('/autos/search', req).then((r) => r.data),
  detalle: (id: string) => apiV2.get<any>(`/autos/${id}`).then((r) => r.data),
  coberturas: (id: string) =>
    apiV2.get<{ auto_id: string; vehiculo: string; opciones: CoberturaOpcion[] }>(`/autos/${id}/coberturas`).then((r) => r.data),
};

export const ordenesV2 = {
  listar: () => apiV2.get<AutoOrderResponseV2[]>('/autos/orders').then((r) => r.data),
  obtener: (ref: string) => apiV2.get<AutoOrderResponseV2>(`/autos/orders/${ref}`).then((r) => r.data),
  crear: (body: CreateAutoOrderRequestV2, clave?: string) =>
    apiV2.post<AutoOrderResponseV2>('/autos/orders/create', body, conClave(clave)).then((r) => r.data),
  cancelar: (ref: string, motivo?: string) =>
    apiV2.post<any>(`/autos/orders/${ref}/cancel`, { motivo, solicitante: 'CLIENTE' }, conClave()).then((r) => r.data),
  checkinDigital: (ref: string, body: { documento_identidad: string; numero_licencia?: string; fecha_vencimiento_licencia?: string }) =>
    apiV2.post<any>(`/autos/reservas/${ref}/checkin`, body, conClave()).then((r) => r.data),
  checkinEntrega: (ref: string, body: { licencia_conducir: string; km_salida: number; tecnico_entrega?: string }) =>
    apiV2.post<any>(`/autos/orders/${ref}/checkin-entrega`, body, conClave()).then((r) => r.data),
  checkinDevolucion: (ref: string, body: { km_retorno: number; nivel_combustible?: number; observaciones?: string }) =>
    apiV2.post<any>(`/autos/orders/${ref}/checkin-devolucion`, body, conClave()).then((r) => r.data),
};

export const flotaV2 = {
  flota: () => apiV2.get<AutoFlotaItemV2[]>('/autos/flota').then((r) => r.data),
  devolucion: (id: string) => apiV2.post<any>(`/autos/${id}/devolucion`, null, conClave()).then((r) => r.data),
  mantenimiento: (id: string, body: Record<string, any>) =>
    apiV2.post<any>(`/autos/${id}/mantenimiento/registro`, body, conClave()).then((r) => r.data),
  bitacora: (id: string) => apiV2.get<any[]>(`/autos/${id}/mantenimiento/bitacora`).then((r) => r.data),
};

export const promocionesV2 = {
  obtener: () => apiV2.get<ContratoPromociones>('/autos/promociones/contrato').then((r) => r.data),
  actualizar: (body: Partial<ContratoPromociones>) =>
    apiV2.put<{ success: boolean; mensaje: string; contrato: ContratoPromociones }>('/autos/promociones/contrato', body, conClave()).then((r) => r.data),
};

export const telemetriaV2 = {
  /** El 503 (DOWN) tambien trae la telemetria: se devuelve igual para pintar el LED rojo. */
  health: () => apiV2.get<AutosHealthResponseV2>('/autos/health', { validateStatus: (s) => s === 200 || s === 503 }).then((r) => r.data),
  eventos: (limit = 25, after?: string) =>
    apiV2.get<{ events: CloudEventFeed[]; metadata: { total: number } }>('/autos/eventos', { params: { limit, after } }).then((r) => r.data),
};

/** Franjas estrictas de 30 minutos del contrato: 00:00, 00:30 ... 23:30. */
export const FRANJAS_30_MIN = Array.from({ length: 48 }, (_, i) =>
  `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

export { uuidv4 };

import axios from 'axios';

const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
const affiliateId = import.meta.env.VITE_AFFILIATE_ID || '1';

/** Cliente HTTP configurado con headers segun contrato autos-openapi.yaml */
export const api = axios.create({ baseURL });

api.interceptors.request.use((config) => {
  const headers: any = config.headers || {};
  // Header X-Affiliate-Id requerido por /search, /details, /depots, /suppliers, /constants
  headers['X-Affiliate-Id'] = affiliateId;
  // Bearer token para endpoints protegidos (/orders/*, /webhooks, /admin/*)
  const token = localStorage.getItem('rf_token');
  if (token) headers.Authorization = `Bearer ${token}`;
  config.headers = headers;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error?.response?.status === 401) {
      localStorage.removeItem('rf_token');
      localStorage.removeItem('rf_user');
    }
    // Extraer Problem Details si viene en formato RFC 7807
    if (error?.response?.data?.title) {
      error.message = error.response.data.title;
    }
    return Promise.reject(error);
  },
);

/** Genera un UUID v4 valido para Idempotency-Key */
export function uuidv4(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return (crypto as any).randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

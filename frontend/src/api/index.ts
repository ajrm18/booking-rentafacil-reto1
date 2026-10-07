import { api, uuidv4 } from './client';
import type {
  AdminUser, AdminUserInput, CarSearchRequest, CarSearchResponse, Depot, OrderDetail,
  OrderHoldResponse, OrderPreviewResponse, RegisterInput, Supplier, TokenResponse, VehicleDetail,
} from '../types';

/** Autenticación demo local */
export const auth = {
  login: (email: string, password: string) =>
    api.post<TokenResponse>('/auth/token', { email, password }).then((r) => r.data),
  /** Registro de un cliente nuevo: devuelve el mismo TokenResponse que el login. */
  register: (data: RegisterInput) =>
    api.post<TokenResponse>('/auth/register', data).then((r) => r.data),
};

/** Endpoints públicos del contrato GDS Autos Core */
export const catalog = {
  search: (req: CarSearchRequest) =>
    api.post<CarSearchResponse>('/search', req).then((r) => r.data),
  details: (vehicle_ids?: string[]) =>
    api.post<{ request_id: string; data: VehicleDetail[] }>('/details', { vehicle_ids }).then((r) => r.data),
  depots: () =>
    api.post<{ request_id: string; data: Depot[]; metadata: any }>('/depots', {}).then((r) => r.data),
  depotScores: () =>
    api.post<{ request_id: string; data: any[] }>('/depots/reviews/scores', {}).then((r) => r.data),
  suppliers: () =>
    api.post<{ request_id: string; data: Supplier[] }>('/suppliers', {}).then((r) => r.data),
  constants: (keys?: string[]) =>
    api.post<{ request_id: string; data: any }>('/constants', { constants: keys }).then((r) => r.data),
};

/** Gestión de órdenes según contrato */
export const orders = {
  hold: (vehicle_id: string, search_token: string, driverAge?: number) =>
    api.post<OrderHoldResponse>('/orders/hold', {
      vehicle_id, search_token,
      driver: driverAge ? { age: driverAge } : undefined,
    }).then((r) => r.data),

  preview: (vehicle_id: string, search_token: string, hold_id?: string, extras?: string[]) =>
    api.post<OrderPreviewResponse>('/orders/preview', {
      vehicle_id, search_token, hold_id, extras,
    }).then((r) => r.data),

  create: (order_preview_id: string, payment_reference: string, driver_details: any) =>
    api.post<OrderDetail>('/orders/create',
      { order_preview_id, payment_reference, driver_details },
      { headers: { 'Idempotency-Key': uuidv4() } },
    ).then((r) => r.data),

  get: (orderId: string) => api.get<OrderDetail>(`/orders/${orderId}`).then((r) => r.data),

  modify: (orderId: string, body: { extras_to_add?: string[]; extras_to_remove?: string[]; route?: any }) =>
    api.post<OrderDetail>(`/orders/${orderId}/modify`, body,
      { headers: { 'Idempotency-Key': uuidv4() } }).then((r) => r.data),

  cancel: (orderId: string) =>
    api.post(`/orders/${orderId}/cancel`, null,
      { headers: { 'Idempotency-Key': uuidv4() } }).then((r) => r.data),
};

/** BFF de administración interna (fuera del contrato público) */
export const admin = {
  stats: () => api.get<any>('/admin/stats').then((r) => r.data),
  listVehicles: () => api.get<any[]>('/admin/vehicles').then((r) => r.data),
  createVehicle: (data: any) => api.post<any>('/admin/vehicles', data).then((r) => r.data),
  updateVehicle: (id: string, data: any) => api.put<any>(`/admin/vehicles/${id}`, data).then((r) => r.data),
  deleteVehicle: (id: string) => api.delete(`/admin/vehicles/${id}`),
  listDepots: () => api.get<Depot[]>('/admin/depots').then((r) => r.data),
  createDepot: (data: any) => api.post<Depot>('/admin/depots', data).then((r) => r.data),
  updateDepot: (id: number, data: any) => api.put<Depot>(`/admin/depots/${id}`, data).then((r) => r.data),
  deleteDepot: (id: number) => api.delete(`/admin/depots/${id}`),
  listSuppliers: () => api.get<Supplier[]>('/admin/suppliers').then((r) => r.data),
  createSupplier: (data: any) => api.post<Supplier>('/admin/suppliers', data).then((r) => r.data),
  updateSupplier: (id: number, data: any) => api.put<Supplier>(`/admin/suppliers/${id}`, data).then((r) => r.data),
  deleteSupplier: (id: number) => api.delete(`/admin/suppliers/${id}`),
  listOrders: (status?: string) => api.get<OrderDetail[]>('/admin/orders', { params: { status } }).then((r) => r.data),
};

/** Cuenta del usuario autenticado (fuera del contrato): sus órdenes por `sub` del token. */
export const account = {
  myOrders: () => api.get<OrderDetail[]>('/account/orders').then((r) => r.data),
  /** Datos del usuario para autollenar el formulario del conductor. */
  profile: () => api.get<{ first_name: string; last_name: string; email: string; phone: string | null }>('/account/profile').then((r) => r.data),
};

/** Usuarios (tabla users): el admin crea, edita y elimina clientes. */
export const adminUsers = {
  list: () => api.get<AdminUser[]>('/admin/users').then((r) => r.data),
  create: (data: AdminUserInput) => api.post<AdminUser>('/admin/users', data).then((r) => r.data),
  update: (id: string, data: AdminUserInput) => api.put<AdminUser>(`/admin/users/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/admin/users/${id}`),
};

/** Cliente CRUD genérico para las APIs de administración (una por tabla). */
const adminCrud = <T = any, Id extends string | number = string>(recurso: string) => ({
  list: (params?: Record<string, any>) => api.get<T[]>(`/admin/${recurso}`, { params }).then((r) => r.data),
  get: (id: Id) => api.get<T>(`/admin/${recurso}/${id}`).then((r) => r.data),
  create: (data: Partial<T>) => api.post<T>(`/admin/${recurso}`, data).then((r) => r.data),
  update: (id: Id, data: Partial<T>) => api.put<T>(`/admin/${recurso}/${id}`, data).then((r) => r.data),
  remove: (id: Id) => api.delete(`/admin/${recurso}/${id}`),
});

/** Una API por cada tabla de la base de datos (9 tablas). */
export const adminApis = {
  suppliers: adminCrud<Supplier, number>('suppliers'),
  depots: adminCrud<Depot, number>('depots'),
  vehicles: adminCrud('vehicles'),
  vehicleImages: adminCrud<any, number>('vehicle-images'),
  holds: adminCrud('holds'),
  orderPreviews: adminCrud('order-previews'),
  orders: adminCrud<OrderDetail>('orders'),
  webhooks: adminCrud('webhooks'),
  users: adminCrud<AdminUser>('users'),
};

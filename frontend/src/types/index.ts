/** Tipos alineados con el contrato oficial contracts/autos-openapi.yaml */

export interface LocationPoint {
  airport?: string;
  city_id?: number;
  coordinates?: { latitude: number; longitude: number };
}

export interface RouteEndpoint {
  datetime: string;
  location: LocationPoint;
}

export interface Route {
  pickup: RouteEndpoint;
  dropoff: RouteEndpoint;
}

export interface Booker { country: string; }
export interface Driver { age: number; }

export interface CarSearchRequest {
  booker: Booker;
  currency: string;
  driver: Driver;
  route: Route;
  filters?: { car_types?: string[]; transmission?: string[] };
  maximum_results?: number;
  language?: string;
  page?: string;
}

export interface CarSearchItem {
  vehicle_id: string;
  price: number;
  supplier_id: number;
}

export interface CarSearchResponse {
  request_id: string;
  data: CarSearchItem[];
  metadata: { total_results: number; next_page: string | null };
  search_token: string;
}

export interface VehicleDetail {
  vehicle_id: string;
  make: string;
  model: string;
  year: number;
  doors: number;
  seats: number;
  bag_capacity: number;
  car_type: string;
  transmission: string;
  fuel_type: string;
  air_conditioning: boolean;
  color?: string;
  description?: string;
  main_image_url?: string;
  images?: string[];
  price_per_day: number;
  supplier?: { supplier_id: number; name: string };
  depot?: { depot_id: number; name: string; city: string; airport?: string };
}

export interface Depot {
  depot_id: number;
  name: string;
  city: string;
  address?: string;
  location: LocationPoint;
  score?: number;
}

export interface Supplier {
  supplier_id: number;
  name: string;
  brand?: string;
}

export interface OrderHoldResponse {
  hold_id: string;
  expires_at: string;
  status: 'HELD' | 'FAILED';
}

export interface OrderPreviewResponse {
  request_id: string;
  data: {
    order_preview_id: string;
    total_price: number;
    currency: string;
    breakdown: Record<string, any>;
  };
}

export interface OrderDetail {
  order_id: string;
  locator: string;
  status: 'CONFIRMED' | 'CANCELLED' | 'PENDING';
  vehicle_details: any;
  route_details: any;
  total_price: number;
  currency: string;
  creation_date: string;
  _links: Record<string, string>;
}

export interface AuthUser {
  email: string;
  role: 'admin' | 'client';
  first_name?: string;
  last_name?: string;
}

/** Usuario de la tabla users (GET /admin/users). Nunca incluye la contraseña. */
export interface AdminUser {
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: 'admin' | 'client';
  phone: string | null;
  national_id: string | null;
  created_at: string;
}

export type AdminUserInput = Partial<Omit<AdminUser, 'user_id' | 'created_at'>> & { password?: string };

/** Datos del registro público de clientes (POST /auth/register). */
export interface RegisterInput {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  national_id: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  user: AuthUser;
}

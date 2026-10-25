/** Tipos de backend/contracts/autos-openapi-v2.yaml (/api/v2) usados por el frontend. */

export type EstadoVehiculo =
  | 'DISPONIBLE' | 'RESERVADO' | 'LISTO_PARA_ENTREGAR' | 'ENTREGADO' | 'EN_LIMPIEZA' | 'EN_MANTENIMIENTO';

export type TipoCobertura = 'BASICA' | 'TOTAL';

export interface AutoVehiculoCardV2 {
  vehicle_id: string;
  marca: string;
  modelo: string;
  categoria: string;
  precio_diario: number;
  precio_total: number;
  moneda: string;
  transmision: string;
  estado: EstadoVehiculo;
  kilometraje_actual: number;
  foto_url: string;
  images: string[];
}

export interface SearchAutosRequestV2 {
  pickup_location: string;
  pickup_date: string;
  pickup_time: string;
  dropoff_date: string;
  dropoff_time: string;
  driver_age?: number;
  category?: string;
  transmission?: string;
}

export interface SearchAutosResponseV2 {
  request_id: string;
  metadata: {
    total_results: number; surcharge_applied: boolean; surcharge_amount: number; dias: number;
    pickup_date: string; dropoff_date: string;
  };
  data: AutoVehiculoCardV2[];
}

export interface CoberturaOpcion {
  tipo: TipoCobertura;
  nombre: string;
  costo_adicional_diario: number;
  franquicia: number;
  deposito_garantia: number;
  descripcion: string;
  beneficios: string[];
}

export interface CreateAutoOrderRequestV2 {
  vehicle_id: string;
  pickup_date: string;
  dropoff_date: string;
  hora_recogida: string;
  hora_devolucion: string;
  tipo_cobertura: TipoCobertura;
  pickup_location?: string;
  payment_reference?: string;
  conductor: { nombre: string; email: string; telefono: string; licencia_conducir: string; edad?: number };
}

export interface FaseCheckin { completado: boolean; at: string | null }

export interface AutoOrderResponseV2 {
  order_id: string;
  pnr: string;
  status: 'CONFIRMED' | 'CHECKIN_COMPLETED' | 'ENTREGADO' | 'COMPLETADA' | 'CANCELLED' | 'PENDING';
  auto_id: string;
  tipo_cobertura: TipoCobertura;
  deposito_garantia: number;
  total_price: { currency: string; total: number; desglose: Record<string, any> | null };
  voucher_qr_data: string;
  checklist_mostrador: string[];
  refund: { refund_id: string; amount: number; currency: string; status: string } | null;
  _links: Record<string, string>;
  reembolso_id: string | null;
  cooldown_info: { disponible_desde: string; activo: boolean } | null;
  vehiculo: { marca: string; modelo: string; foto_url: string | null };
  recogida: { fecha_hora: string | null; lugar: string | null };
  devolucion: { fecha_hora: string | null; lugar: string | null };
  conductor: Record<string, any> | null;
  propietario: string;
  creada_at: string;
  cancelada_at: string | null;
  checkins: {
    digital: FaseCheckin & { licencia_verificada: string | null };
    entrega: FaseCheckin & { km_salida: number | null; tecnico_entrega: string | null };
    devolucion: FaseCheckin & { km_retorno: number | null; km_recorridos: number | null; nivel_combustible: number | null; observaciones: string | null };
  };
}

export interface AutoFlotaItemV2 {
  id: string;
  marca: string;
  modelo: string;
  placa: string;
  categoria: string;
  precio_diario: number;
  estado_operativo: EstadoVehiculo;
  cooldown_activo: boolean;
  segundos_restantes_cooldown: number;
  disponible_estimado_at: string | null;
  kilometraje_actual: number;
  umbral_mantenimiento_km: number;
  alerta_mantenimiento: boolean;
  mantenimiento_requerido: boolean;
  agencia: string | null;
  foto_url: string;
}

export interface ContratoPromociones {
  proveedor_codigo: string;
  nombre_socio: string;
  vertical: string;
  permite_promociones: boolean;
  porcentaje_descuento_maximo: number;
  destinos_habilitados: string[];
  vigencia_hasta: string | null;
  condiciones_combo: string | null;
  vigente: boolean;
  actualizado_por: string | null;
  updated_at: string | null;
}

export interface AutosHealthResponseV2 {
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  nodo_id: string;
  nombre_proveedor: string;
  vertical: string;
  version: string;
  uptime_seconds: number;
  latencia_ms: number;
  circuit_breaker_estado: string;
  cooldown_activo_count: number;
  total_vehiculos: number;
  timestamp: string;
  dependencias?: Record<string, string>;
  event_bus_modo?: string;
  outbox_pendientes?: number | null;
}

export interface CloudEventFeed {
  specversion: string;
  type: string;
  source: string;
  id: string;
  time: string;
  subject?: string;
  correlation_id: string;
  data: Record<string, any>;
  routing_key: string;
  publish_status: 'PENDING' | 'PUBLISHED' | 'LOGGED' | 'FAILED';
  published_at: string | null;
}

import { BadRequestException } from '@nestjs/common';
import { NOMBRE_RE } from '../../../common/validaciones';

/**
 * Validación de los cuerpos de las APIs de administración (vehículos, agencias y proveedores).
 * Solo se validan los campos presentes, así sirve igual para POST (completo) y PUT (parcial).
 * Devuelve 400 con todos los problemas en invalidParams, en vez de que la BD responda 500.
 */
type Problema = { name: string; reason: string };

function lanzar(problemas: Problema[]): void {
  if (problemas.length === 0) return;
  throw new BadRequestException({
    type: 'https://api.booking-hub.com/errors/validation-failed',
    title: 'Petición inválida',
    status: 400,
    code: 'VALIDATION_FAILED',
    detail: problemas.map((p) => p.reason).join('. '),
    invalidParams: problemas,
  });
}

const presente = (v: unknown) => v !== undefined && v !== null && v !== '';

function entero(p: Problema[], body: any, campo: string, min: number, max: number, etiqueta: string) {
  if (!presente(body[campo])) return;
  const n = Number(body[campo]);
  if (!Number.isInteger(n) || n < min || n > max) p.push({ name: campo, reason: `${etiqueta} debe ser un número entero entre ${min} y ${max}` });
  else body[campo] = n;
}

function numero(p: Problema[], body: any, campo: string, min: number, max: number, etiqueta: string, minExclusivo = false) {
  if (!presente(body[campo])) return;
  const n = Number(body[campo]);
  if (!Number.isFinite(n) || (minExclusivo ? n <= min : n < min) || n > max) {
    p.push({ name: campo, reason: `${etiqueta} debe estar entre ${min} y ${max}${minExclusivo ? ' (mayor que ' + min + ')' : ''}` });
  } else body[campo] = n;
}

function texto(p: Problema[], body: any, campo: string, min: number, max: number, etiqueta: string, soloLetras = false) {
  if (body[campo] === undefined || body[campo] === null) return;
  const v = String(body[campo]).trim().replace(/\s+/g, ' ');
  if (v.length < min) p.push({ name: campo, reason: `${etiqueta} debe tener al menos ${min} caracteres` });
  else if (v.length > max) p.push({ name: campo, reason: `${etiqueta} no puede superar los ${max} caracteres` });
  else if (soloLetras && v && !NOMBRE_RE.test(v)) p.push({ name: campo, reason: `${etiqueta} solo puede contener letras` });
  else body[campo] = v;
}

const ANIO_MAX = () => new Date().getFullYear() + 1;
const TRANSMISIONES = ['manual', 'automatica'];
const COMBUSTIBLES = ['gasolina', 'diesel', 'hibrido', 'electrico'];
const CATEGORIAS = ['Compacto', 'Sedan', 'SUV', 'Camioneta', 'Lujo'];
const ESTADOS = ['AVAILABLE', 'RESERVED', 'MAINTENANCE', 'INACTIVE'];

export function validarVehiculo(body: any): void {
  const p: Problema[] = [];
  if (presente(body.vehicle_id) && !/^VEH-[A-Za-z0-9-]{1,36}$/.test(String(body.vehicle_id))) {
    p.push({ name: 'vehicle_id', reason: 'El ID debe tener el formato VEH-XXXX' });
  }
  texto(p, body, 'make', 2, 60, 'La marca');
  texto(p, body, 'model', 1, 80, 'El modelo');
  texto(p, body, 'color', 0, 30, 'El color', true);
  if (presente(body.plate)) {
    const placa = String(body.plate).trim().toUpperCase();
    if (!/^[A-Z]{3}-\d{3,4}$/.test(placa)) p.push({ name: 'plate', reason: 'La placa debe tener el formato ABC-1234' });
    else body.plate = placa;
  }
  entero(p, body, 'year', 1990, ANIO_MAX(), 'El año');
  entero(p, body, 'seats', 1, 15, 'Los pasajeros');
  entero(p, body, 'doors', 2, 6, 'Las puertas');
  entero(p, body, 'bag_capacity', 0, 10, 'Las maletas');
  numero(p, body, 'price_per_day', 0, 10_000, 'El precio por día', true);
  entero(p, body, 'depot_id', 1, 2_147_483_647, 'La agencia');
  entero(p, body, 'supplier_id', 1, 2_147_483_647, 'El proveedor');
  for (const [campo, lista, etiqueta] of [
    ['transmission', TRANSMISIONES, 'La transmisión'], ['fuel_type', COMBUSTIBLES, 'El combustible'],
    ['car_type', CATEGORIAS, 'La categoría'], ['status', ESTADOS, 'El estado'],
  ] as const) {
    if (presente(body[campo]) && !(lista as readonly string[]).includes(body[campo])) {
      p.push({ name: campo, reason: `${etiqueta} no es válida (${lista.join(', ')})` });
    }
  }
  if (presente(body.main_image_url) && !/^https?:\/\/\S+$/.test(String(body.main_image_url))) {
    p.push({ name: 'main_image_url', reason: 'La imagen principal debe ser una URL http(s)' });
  }
  texto(p, body, 'description', 0, 1000, 'La descripción');
  lanzar(p);
}

export function validarAgencia(body: any): void {
  const p: Problema[] = [];
  texto(p, body, 'name', 2, 160, 'El nombre');
  texto(p, body, 'city', 2, 80, 'La ciudad', true);
  texto(p, body, 'address', 0, 200, 'La dirección');
  if (presente(body.airport)) {
    const iata = String(body.airport).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(iata)) p.push({ name: 'airport', reason: 'El código IATA debe tener 3 letras (ej. UIO)' });
    else body.airport = iata;
  } else if (body.airport === '') body.airport = null;
  numero(p, body, 'score', 0, 5, 'La puntuación');
  numero(p, body, 'latitude', -90, 90, 'La latitud');
  numero(p, body, 'longitude', -180, 180, 'La longitud');
  entero(p, body, 'city_id', 1, 2_147_483_647, 'El ID de ciudad');
  lanzar(p);
}

export function validarProveedor(body: any): void {
  const p: Problema[] = [];
  texto(p, body, 'name', 2, 120, 'El nombre');
  texto(p, body, 'brand', 0, 120, 'La marca');
  texto(p, body, 'description', 0, 1000, 'La descripción');
  lanzar(p);
}

/** 400 claro si la referencia no existe (en lugar del error de llave foránea de la BD). */
export function referenciaInexistente(campo: string, etiqueta: string): BadRequestException {
  return new BadRequestException({
    type: 'https://api.booking-hub.com/errors/validation-failed',
    title: 'Petición inválida',
    status: 400,
    code: 'VALIDATION_FAILED',
    detail: `${etiqueta} seleccionada no existe`,
    invalidParams: [{ name: campo, reason: `${etiqueta} seleccionada no existe` }],
  });
}

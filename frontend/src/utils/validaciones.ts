/**
 * Validaciones de formularios compartidas (mismas reglas que backend/src/common/validaciones.ts).
 * Los `filtrar*` limpian lo que se teclea (no se pueden escribir letras en un teléfono);
 * los `msg*` devuelven el mensaje de error o undefined si el valor es válido.
 */

const NOMBRE_RE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:[ '-][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*$/;
/** Exactamente una @, sin espacios, y un dominio con punto (ej. usuario@dominio.com). */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)*\.[A-Za-z]{2,}$/;
/** Igual que el backend: 9 a 15 dígitos con espacios simples y "+" opcional al inicio. */
const TELEFONO_RE = /^\+?\d(?: ?\d){8,14}$/;

/** Solo letras (con tildes y ñ), espacios, apóstrofo y guion. */
export const filtrarNombre = (v: string) => v.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]/g, '').replace(/\s{2,}/g, ' ');
/** Solo dígitos y espacios, con un "+" opcional al inicio. */
export const filtrarTelefono = (v: string) => {
  const limpio = v.replace(/[^\d+ ]/g, '');
  return (limpio.startsWith('+') ? '+' : '') + limpio.replace(/\+/g, '');
};
export const filtrarDigitos = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);
/** Sin espacios y como máximo una @. */
export const filtrarEmail = (v: string) => {
  const sinEspacios = v.replace(/\s/g, '');
  const i = sinEspacios.indexOf('@');
  return i < 0 ? sinEspacios : sinEspacios.slice(0, i + 1) + sinEspacios.slice(i + 1).replace(/@/g, '');
};

export function msgNombre(v: string, campo = 'El nombre', obligatorio = true): string | undefined {
  const t = v.trim();
  if (!t) return obligatorio ? `${campo} es obligatorio` : undefined;
  if (t.length < 2) return `${campo} debe tener al menos 2 letras`;
  if (t.length > 60) return `${campo} no puede superar los 60 caracteres`;
  if (!NOMBRE_RE.test(t)) return `${campo} solo puede contener letras`;
  return undefined;
}

export function msgEmail(v: string, obligatorio = true): string | undefined {
  const t = v.trim();
  if (!t) return obligatorio ? 'El correo electrónico es obligatorio' : undefined;
  const arrobas = (t.match(/@/g) || []).length;
  if (arrobas !== 1) return 'El correo debe contener una sola @';
  if (!EMAIL_RE.test(t)) return 'Ingresa un correo válido (ej. nombre@dominio.com)';
  return undefined;
}

export function msgTelefono(v: string, obligatorio = false): string | undefined {
  const t = v.trim();
  if (!t) return obligatorio ? 'El teléfono es obligatorio' : undefined;
  if (!/^\+?[\d ]+$/.test(t)) return 'El teléfono solo puede contener números';
  const digitos = t.replace(/\D/g, '').length;
  if (digitos < 9 || digitos > 15) return 'El teléfono debe tener entre 9 y 15 dígitos (ej. 0983563584)';
  if (!TELEFONO_RE.test(t)) return 'Usa un solo espacio entre grupos de números';
  return undefined;
}

/** Cédula ecuatoriana: 10 dígitos, provincia 01-24 (o 30), tercer dígito < 6 y dígito verificador (módulo 10). */
export function cedulaValida(c: string): boolean {
  if (!/^\d{10}$/.test(c)) return false;
  const prov = Number(c.slice(0, 2));
  if (!((prov >= 1 && prov <= 24) || prov === 30) || Number(c[2]) >= 6) return false;
  const suma = [...c.slice(0, 9)].reduce((s, d, i) => {
    let n = Number(d) * (i % 2 === 0 ? 2 : 1);
    if (n > 9) n -= 9;
    return s + n;
  }, 0);
  return (10 - (suma % 10)) % 10 === Number(c[9]);
}

export function msgCedula(v: string, obligatorio = false): string | undefined {
  const t = v.trim();
  if (!t) return obligatorio ? 'La cédula es obligatoria' : undefined;
  if (!/^\d{10}$/.test(t)) return 'La cédula debe tener 10 dígitos';
  if (!cedulaValida(t)) return 'La cédula no es válida';
  return undefined;
}

export const sinErrores = (e: Record<string, string | undefined>) => Object.values(e).every((m) => !m);

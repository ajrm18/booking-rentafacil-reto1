/**
 * Reglas de validación de datos personales, iguales a las del frontend
 * (frontend/src/utils/validaciones.ts), para que una petición directa a la API
 * no pueda guardar lo que la interfaz rechaza.
 */

/** Letras (con tildes y ñ) separadas por un espacio, apóstrofo o guion. */
export const NOMBRE_RE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:[ '-][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*$/;
/** Exactamente una @, sin espacios, y un dominio con punto. */
export const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)*\.[A-Za-z]{2,}$/;
/** Entre 9 y 15 dígitos, separados como mucho por un espacio, con "+" opcional al inicio (ej. 0983563584, +593 98 356 3584). */
export const TELEFONO_RE = /^\+?\d(?: ?\d){8,14}$/;

export const telefonoValido = (v: string) => TELEFONO_RE.test(v);

/** Cédula ecuatoriana: provincia 01-24 (o 30), tercer dígito < 6 y dígito verificador módulo 10. */
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

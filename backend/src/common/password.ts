import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/** Hash de contraseñas con scrypt (incluido en Node, sin dependencias nativas). */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
  const [alg, salt, hash] = (stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(plain, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

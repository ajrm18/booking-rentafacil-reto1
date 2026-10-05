import { ValueTransformer } from 'typeorm';

/**
 * Transforma columnas numeric de PostgreSQL (string) a number en TypeScript.
 */
export class ColumnNumericTransformer implements ValueTransformer {
  to(data: number | null): number | null {
    return data;
  }
  from(data: string | null): number | null {
    if (data === null || data === undefined) return null;
    const n = parseFloat(data);
    return isNaN(n) ? null : n;
  }
}

/**
 * Siluetas laterales minimalistas (trazo) para cada categoria de vehiculo.
 * Usan currentColor para heredar el color del contenedor.
 */
const CUERPOS: Record<string, { body: string; windows: string }> = {
  Compacto: {
    body: 'M6 30 V24 Q6 21.5 8.5 21 L18 19.5 L25 12.5 Q26.5 11 28.5 11 H44 Q46 11 47.5 12.8 L53 19.5 L60 21 Q63 21.8 63 25 V30',
    windows: 'M26.5 19 L31 13.5 H38.5 V19 Z M41 13.5 H45 L49.5 19 H41 Z',
  },
  Sedan: {
    body: 'M4 30 V25 Q4 22 7 21.5 L19 20 L27 13 Q28.5 11.8 30.5 11.8 H45 Q47 11.8 48.5 13.2 L55 20 L70 21.5 Q74 22 74 25.5 V30',
    windows: 'M28.5 19.2 L33 14 H40 V19.2 Z M42.5 14 H46 L51.5 19.2 H42.5 Z',
  },
  SUV: {
    body: 'M5 30 V21 Q5 18.5 7.5 18 L17 17 L23 9.5 Q24.5 8 26.8 8 H62 Q65 8 65.6 11 L67 18 Q69 19 69 22 V30',
    windows: 'M24.5 16.2 L28.5 10.8 H39 V16.2 Z M41.5 10.8 H52 V16.2 H41.5 Z M54.5 10.8 H62 L63 16.2 H54.5 Z',
  },
  Camioneta: {
    body: 'M4 30 V22 Q4 19.5 6.5 19 L16 18 L22 10 Q23.5 8.5 25.5 8.5 H40 Q42 8.5 42 10.5 V19 H74 V30',
    windows: 'M23.5 16.5 L27.5 11.2 H33.5 V16.5 Z M35.8 11.2 H39.5 V16.5 H35.8 Z',
  },
  Lujo: {
    body: 'M3 29 V25.5 Q3 22.5 6 22 L20 20.5 Q27 13 33 12 H46 Q51 12.3 56 19.5 L71 21.5 Q75 22.2 75 25.5 V29',
    windows: 'M25 19.5 Q29.5 14.5 34 14 H40.5 V19.5 Z M43 14 H46.5 Q49.5 14.5 52.5 19.5 H43 Z',
  },
};

const RUEDAS: Record<string, [number, number]> = {
  Compacto: [18, 52], Sedan: [17, 61], SUV: [18, 56], Camioneta: [17, 61], Lujo: [17, 61],
};

export default function CarTypeIcon({ type, size = 72 }: { type: string; size?: number }) {
  const c = CUERPOS[type] || CUERPOS.Sedan;
  const [r1, r2] = RUEDAS[type] || RUEDAS.Sedan;
  const base = type === 'Lujo' ? 29 : 30;
  const fin = type === 'Compacto' ? 63 : type === 'SUV' ? 69 : type === 'Lujo' ? 75 : 74;
  const ini = type === 'Compacto' ? 6 : type === 'SUV' ? 5 : type === 'Lujo' ? 3 : 4;
  return (
    <svg width={size} height={size * 0.5} viewBox="0 0 78 39" fill="none" aria-hidden="true"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={c.body} />
      <path d={c.windows} strokeWidth={1.4} />
      <path d={`M${ini} ${base} H${r1 - 6} M${r1 + 6} ${base} H${r2 - 6} M${r2 + 6} ${base} H${fin}`} />
      <circle cx={r1} cy={base} r={4.6} />
      <circle cx={r2} cy={base} r={4.6} />
      <circle cx={r1} cy={base} r={1.4} fill="currentColor" stroke="none" />
      <circle cx={r2} cy={base} r={1.4} fill="currentColor" stroke="none" />
    </svg>
  );
}

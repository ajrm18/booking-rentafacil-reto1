/** Mensaje de error inline bajo un campo de fecha, enlazado al input por aria-describedby. */
export default function FechaError({ id, mensaje }: { id: string; mensaje?: string }) {
  if (!mensaje) return null;
  return (
    <div id={id} role="alert" style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '0.3rem' }}>
      {mensaje}
    </div>
  );
}

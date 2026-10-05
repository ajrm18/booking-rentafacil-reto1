export default function Footer() {
  return (
    <footer style={{
      background: '#0f172a', color: '#94a3b8', padding: '2.5rem 0 1.5rem',
      marginTop: '3rem', fontSize: '0.9rem',
    }}>
      <div className="container" style={{
        display: 'grid', gap: '1.5rem',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      }}>
        <div>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: '1.1rem', marginBottom: '0.5rem' }}>
            RentaFacil EC
          </div>
          <div>Alquila el vehiculo perfecto para tu proximo viaje en Ecuador.</div>
        </div>
        <div>
          <div style={{ color: '#fff', fontWeight: 600, marginBottom: '0.5rem' }}>Sucursales</div>
          <div>Quito Aeropuerto</div>
          <div>Quito Centro</div>
          <div>Guayaquil</div>
          <div>Cuenca</div>
        </div>
        <div>
          <div style={{ color: '#fff', fontWeight: 600, marginBottom: '0.5rem' }}>Contacto</div>
          <div>hola@rentafacil.ec</div>
          <div>+593 2 222 3344</div>
        </div>
        <div>
          <div style={{ color: '#fff', fontWeight: 600, marginBottom: '0.5rem' }}>Proyecto academico</div>
          <div>Booking Prototipo - Reto 1</div>
          <div>Integracion de Sistemas - PUCE</div>
          <div>Anthony Rosero</div>
        </div>
      </div>
      <div className="container" style={{
        marginTop: '2rem', paddingTop: '1rem', borderTop: '1px solid #1e293b',
        textAlign: 'center', fontSize: '0.85rem',
      }}>
        &copy; {new Date().getFullYear()} RentaFacil EC. Todos los derechos reservados.
      </div>
    </footer>
  );
}

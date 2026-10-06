export default function Footer() {
  return (
    <footer style={{
      background: 'var(--ink)', color: '#9a9da3', padding: '3rem 0 1.5rem',
      marginTop: '3rem', fontSize: '0.9rem', borderTop: '3px solid var(--brand)',
    }}>
      <div className="container" style={{
        display: 'grid', gap: '1.5rem',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      }}>
        <div>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: '1.1rem', marginBottom: '0.5rem' }}>
            RentaFacil <span style={{ color: 'var(--brand)' }}>EC</span>
          </div>
          <div>Alquiler de vehículos para tus viajes por Ecuador.</div>
        </div>
        <div>
          <div className="footer-title">Sucursales</div>
          <div>Quito Aeropuerto</div>
          <div>Quito Centro</div>
          <div>Guayaquil</div>
          <div>Cuenca</div>
        </div>
        <div>
          <div className="footer-title">Contacto</div>
          <div>hola@rentafacil.ec</div>
          <div>+593 2 222 3344</div>
        </div>
        <div>
          <div className="footer-title">Proyecto académico</div>
          <div>Booking Prototipo - Reto 1</div>
          <div>Integración de Sistemas - PUCE</div>
          <div>Anthony Rosero</div>
        </div>
      </div>
      <div className="container" style={{
        marginTop: '2rem', paddingTop: '1rem', borderTop: '1px solid var(--ink-3)',
        display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.8rem',
      }}>
        <span>&copy; {new Date().getFullYear()} RentaFacil EC. Todos los derechos reservados.</span>
        <span>Fotografías de vehículos: Wikimedia Commons (CC BY / CC BY-SA), autores citados en cada ficha.</span>
      </div>
      <style>{`
        .footer-title {
          color: #fff; font-weight: 700; margin-bottom: 0.6rem;
          font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.12em;
        }
      `}</style>
    </footer>
  );
}

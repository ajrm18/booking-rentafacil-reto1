import { useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import HomePage from './pages/HomePage';
import CatalogoPage from './pages/CatalogoPage';
import VehiculoDetallePage from './pages/VehiculoDetallePage';
import LoginPage from './pages/LoginPage';
import RegistroPage from './pages/RegistroPage';
import MisReservasPage from './pages/MisReservasPage';
import ReservaConfirmadaPage from './pages/ReservaConfirmadaPage';
import AdminLayout from './admin/AdminLayout';
import AdminDashboard from './admin/AdminDashboard';
import VehiculosAdmin from './admin/VehiculosAdmin';
import DepotsAdmin from './admin/DepotsAdmin';
import SuppliersAdmin from './admin/SuppliersAdmin';
import OrdersAdmin from './admin/OrdersAdmin';
import UsuariosAdmin from './admin/UsuariosAdmin';
import FlotaAdmin from './admin/FlotaAdmin';
import MostradorAdmin from './admin/MostradorAdmin';
import MantenimientoAdmin from './admin/MantenimientoAdmin';
import PromocionesAdmin from './admin/PromocionesAdmin';
import SaludAdmin from './admin/SaludAdmin';
import PrivateRoute from './components/PrivateRoute';
import { useAuth } from './context/AuthContext';

const SoloAdmin = ({ children }: { children: JSX.Element }) => <PrivateRoute rol="admin">{children}</PrivateRoute>;

/**
 * Al cambiar de página el foco pasa al contenido principal, para que con Tab el usuario
 * siga desde la nueva página y no desde el enlace del menú que pulsó (y los lectores de
 * pantalla anuncien el cambio). No se aplica en la carga inicial.
 */
function useFocoAlNavegar() {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const primeraCarga = useRef(true);
  useEffect(() => {
    if (primeraCarga.current) { primeraCarga.current = false; return; }
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);
  return mainRef;
}

export default function App() {
  const { loading } = useAuth();
  const mainRef = useFocoAlNavegar();
  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Cargando...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <a href="#contenido" className="skip-link"
        onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }}>
        Saltar al contenido
      </a>
      <Navbar />
      <main id="contenido" ref={mainRef} tabIndex={-1} style={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/catalogo" element={<CatalogoPage />} />
          <Route path="/vehiculos/:id" element={<VehiculoDetallePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/registro" element={<RegistroPage />} />
          <Route path="/mis-reservas" element={
            <PrivateRoute><MisReservasPage /></PrivateRoute>
          } />
          <Route path="/reserva/:orderId" element={
            <PrivateRoute><ReservaConfirmadaPage /></PrivateRoute>
          } />
          <Route path="/admin" element={
            <PrivateRoute rol={['admin', 'mechanic']}><AdminLayout /></PrivateRoute>
          }>
            <Route index element={<SoloAdmin><AdminDashboard /></SoloAdmin>} />
            <Route path="vehiculos" element={<SoloAdmin><VehiculosAdmin /></SoloAdmin>} />
            <Route path="depots" element={<SoloAdmin><DepotsAdmin /></SoloAdmin>} />
            <Route path="suppliers" element={<SoloAdmin><SuppliersAdmin /></SoloAdmin>} />
            <Route path="orders" element={<SoloAdmin><OrdersAdmin /></SoloAdmin>} />
            <Route path="usuarios" element={<SoloAdmin><UsuariosAdmin /></SoloAdmin>} />
            {/* Reto 2 (/api/v2): el tecnico (rol MANTENIMIENTO) opera flota, mostrador y mantenimiento */}
            <Route path="flota" element={<FlotaAdmin />} />
            <Route path="mostrador" element={<MostradorAdmin />} />
            <Route path="mantenimiento" element={<MantenimientoAdmin />} />
            <Route path="promociones" element={<SoloAdmin><PromocionesAdmin /></SoloAdmin>} />
            <Route path="health" element={<SoloAdmin><SaludAdmin /></SoloAdmin>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}

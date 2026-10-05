import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import HomePage from './pages/HomePage';
import CatalogoPage from './pages/CatalogoPage';
import VehiculoDetallePage from './pages/VehiculoDetallePage';
import LoginPage from './pages/LoginPage';
import MisReservasPage from './pages/MisReservasPage';
import ReservaConfirmadaPage from './pages/ReservaConfirmadaPage';
import AdminLayout from './admin/AdminLayout';
import AdminDashboard from './admin/AdminDashboard';
import VehiculosAdmin from './admin/VehiculosAdmin';
import DepotsAdmin from './admin/DepotsAdmin';
import SuppliersAdmin from './admin/SuppliersAdmin';
import OrdersAdmin from './admin/OrdersAdmin';
import PrivateRoute from './components/PrivateRoute';
import { useAuth } from './context/AuthContext';

export default function App() {
  const { loading } = useAuth();
  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Cargando...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Navbar />
      <main style={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/catalogo" element={<CatalogoPage />} />
          <Route path="/vehiculos/:id" element={<VehiculoDetallePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/mis-reservas" element={
            <PrivateRoute><MisReservasPage /></PrivateRoute>
          } />
          <Route path="/reserva/:orderId" element={
            <PrivateRoute><ReservaConfirmadaPage /></PrivateRoute>
          } />
          <Route path="/admin" element={
            <PrivateRoute rol="admin"><AdminLayout /></PrivateRoute>
          }>
            <Route index element={<AdminDashboard />} />
            <Route path="vehiculos" element={<VehiculosAdmin />} />
            <Route path="depots" element={<DepotsAdmin />} />
            <Route path="suppliers" element={<SuppliersAdmin />} />
            <Route path="orders" element={<OrdersAdmin />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}

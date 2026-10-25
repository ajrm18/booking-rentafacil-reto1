import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { AuthUser } from '../types';

export default function PrivateRoute({
  children,
  rol,
}: {
  children: JSX.Element;
  rol?: AuthUser['role'] | AuthUser['role'][];
}) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: pathname }} />;
  const permitidos = rol === undefined ? null : Array.isArray(rol) ? rol : [rol];
  if (permitidos && !permitidos.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

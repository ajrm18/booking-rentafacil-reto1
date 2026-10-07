import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function PrivateRoute({
  children,
  rol,
}: {
  children: JSX.Element;
  rol?: 'admin' | 'client';
}) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: pathname }} />;
  if (rol && user.role !== rol) return <Navigate to="/" replace />;
  return children;
}

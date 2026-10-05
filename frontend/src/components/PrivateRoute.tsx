import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function PrivateRoute({
  children,
  rol,
}: {
  children: JSX.Element;
  rol?: 'admin' | 'client';
}) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (rol && user.role !== rol) return <Navigate to="/" replace />;
  return children;
}

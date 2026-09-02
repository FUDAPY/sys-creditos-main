import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { type Role } from '../../types';

interface Props {
  children: React.ReactNode;
  allowedRoles?: Role[];
}

export const ProtectedRoute = ({ children, allowedRoles }: Props) => {
  const { currentUser, userData, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-xl font-semibold text-gray-600">Cargando sistema...</div>
      </div>
    );
  }

  if (!currentUser || !userData) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(userData.role)) {
    // Si es cobrador y trata de entrar al dashboard (solo admin), lo mandamos a sus clientes
    return <Navigate to={userData.role === 'COLLECTOR' ? '/clientes' : '/dashboard'} replace />;
  }

  return <>{children}</>;
};
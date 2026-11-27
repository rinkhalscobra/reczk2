import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { roleHome, type AppRole } from '@/lib/roles';
import { RouteStatus } from '@/components/RouteStatus';

interface RoleRouteProps {
  allowedRoles: AppRole[];
  children: ReactNode;
}

export const RoleRoute = ({ allowedRoles, children }: RoleRouteProps) => {
  const { user, loading: authLoading, error: authError, signOut } = useAuth();
  const { role, isLoading: roleLoading, error, refetch } = useUserRole();

  if (authLoading || roleLoading) {
    return <RouteStatus />;
  }

  if (!user) return <Navigate to="/auth" replace />;
  if (authError || error) {
    return <RouteStatus
      error="We couldn't verify your session or account access. Please try again."
      onRetry={() => authError ? window.location.reload() : void refetch()}
      onSignOut={() => void signOut()}
    />;
  }
  if (!role || !allowedRoles.includes(role)) {
    return <Navigate to={role ? roleHome[role] : '/auth'} replace />;
  }

  return <>{children}</>;
};

export default RoleRoute;

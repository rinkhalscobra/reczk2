import { useUserRole } from './useUserRole';

// Keep the existing API while sharing the route guard's cached role lookup.
export const useAdmin = () => {
  const { role, isAdmin, isGroupAdmin, isLoading } = useUserRole();
  return {
    isAdmin,
    isGroupAdmin,
    userRole: role === 'user' ? null : role,
    loading: isLoading,
  };
};

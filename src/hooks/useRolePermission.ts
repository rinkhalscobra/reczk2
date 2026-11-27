import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useUserRole } from './useUserRole';
import { isPermissionMode } from '@/lib/permissions';

export function useRolePermission(permission: 'reset_password') {
  const { user } = useAuth();
  const { isStaff } = useUserRole();
  const userId = user?.id;
  const query = useQuery({
    queryKey: ['my-permission', userId, permission],
    enabled: Boolean(userId && isStaff),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_my_permission', { p_permission: permission })
        .abortSignal(AbortSignal.timeout(15_000));
      if (error || !isPermissionMode(data)) throw new Error('Unable to load permissions');
      return data;
    },
    staleTime: 30_000, retry: false, refetchOnWindowFocus: true,
  });
  return { mode: query.data, isLoading: isStaff && query.isPending, error: query.error, refetch: query.refetch };
}

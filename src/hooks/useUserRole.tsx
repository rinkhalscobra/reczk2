import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import type { AppRole } from '@/lib/roles';

export const useUserRole = () => {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id;
  const query = useQuery({
    queryKey: ['user-role', userId],
    enabled: Boolean(userId) && !authLoading,
    queryFn: async (): Promise<AppRole> => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId!)
        .retry(false)
        .abortSignal(AbortSignal.timeout(15_000))
        .maybeSingle();

      if (error) throw new Error(error.message);
      // Clients intentionally have no row in user_roles.
      return data?.role || 'user';
    },
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const role = userId ? query.data ?? null : null;
  return {
    role,
    isLoading: authLoading || Boolean(userId && query.isPending),
    error: query.error,
    refetch: query.refetch,
    isAdmin: role === 'admin',
    isGroupAdmin: role === 'group_admin',
    isSupervisor: role === 'supervisor',
    isAgent: role === 'agent',
    isUser: role === 'user',
    isStaff: role !== null && role !== 'user',
  };
};

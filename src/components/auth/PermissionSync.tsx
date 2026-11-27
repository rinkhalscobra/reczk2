import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { supabase } from '@/integrations/supabase/client';

export default function PermissionSync() {
  const { user } = useAuth();
  const { isStaff } = useUserRole();
  const queryClient = useQueryClient();
  const userId = user?.id;
  useEffect(() => {
    if (!userId || !isStaff) return;
    const channel = supabase.channel(`permissions-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'role_permissions' },
        () => void queryClient.invalidateQueries({ queryKey: ['my-permission', userId] })).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [userId, isStaff, queryClient]);
  return null;
}

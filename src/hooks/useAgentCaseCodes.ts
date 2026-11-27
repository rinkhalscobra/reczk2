import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

export function useAgentCaseCodes(agentIds: string[], enabled = true) {
  const { user } = useAuth();
  const ids = [...new Set(agentIds)].sort();
  const query = useQuery({
    queryKey: ['agent-case-codes', user?.id, ids],
    enabled: enabled && Boolean(user?.id) && ids.length > 0,
    retry: false,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const codes = new Map<string, string>();
      for (let offset = 0; offset < ids.length; offset += 100) {
        const batch = ids.slice(offset, offset + 100);
        const { data, error } = await supabase.rpc('get_agent_case_codes', { p_agent_ids: batch })
          .retry(false).abortSignal(signal);
        if (error) throw error;
        for (const row of data || []) {
          if (batch.includes(row.agent_id)) codes.set(row.agent_id, row.case_code);
        }
      }
      return codes;
    },
  });
  return { ...query, isPending: ids.length > 0 && query.isPending };
}

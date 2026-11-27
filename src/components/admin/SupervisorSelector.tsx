import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { getErrorMessage } from '@/lib/errorMessage';

export interface SupervisorOption {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  group_id: string | null;
}

export function SupervisorSelector({ value, groupId, supervisors, onChange, disabled = false, allowUnassigned = false }: {
  value: string; groupId: string | null; supervisors: SupervisorOption[];
  onChange: (value: string) => void; disabled?: boolean; allowUnassigned?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <Select value={value || (allowUnassigned ? 'unassigned' : '')} disabled={disabled || !groupId}
      onValueChange={value => onChange(value === 'unassigned' ? '' : value)}>
      <SelectTrigger aria-label={t('hierarchy.assignedSupervisor')} className="min-w-40"><SelectValue placeholder={t('hierarchy.chooseSupervisor')} /></SelectTrigger>
      <SelectContent>
        {allowUnassigned && <SelectItem value="unassigned">{t('customerDetail.unassigned')}</SelectItem>}
        {supervisors.filter(supervisor => groupId && supervisor.group_id === groupId).map(supervisor => (
          <SelectItem key={supervisor.id} value={supervisor.id}>
            {`${supervisor.first_name || ''} ${supervisor.last_name || ''}`.trim() || supervisor.email || 'Supervisor'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AgentSupervisorSelect({ agent, supervisors, onSuccess }: {
  agent: { id: string; group_id: string | null; supervisor_id: string | null };
  supervisors: SupervisorOption[]; onSuccess: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { t } = useLanguage();
  const assign = async (supervisorId: string) => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc('set_agent_supervisor', { p_agent_id: agent.id, p_supervisor_id: supervisorId || null });
      if (error) throw error;
      onSuccess();
    } catch (error) {
      toast({ title: t('common.error'), description: getErrorMessage(error), variant: 'destructive' });
    } finally { setSaving(false); }
  };
  return <SupervisorSelector value={agent.supervisor_id || ''} groupId={agent.group_id} supervisors={supervisors}
    onChange={value => void assign(value)} disabled={saving} allowUnassigned />;
}

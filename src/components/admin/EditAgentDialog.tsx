import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';
import { useAgentCaseCodes } from '@/hooks/useAgentCaseCodes';
import { useLanguage } from '@/contexts/LanguageContext';
import { useGroupDetailsContent } from '@/i18n/groupDetails';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { getErrorMessage } from '@/lib/errorMessage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SupervisorSelector, type SupervisorOption } from './SupervisorSelector';
import { AgentCaseCodeInput } from './AgentCaseCodeInput';

interface Agent {
  id: string; first_name: string | null; last_name: string | null; username: string | null;
  group_id: string | null; supervisor_id?: string | null;
}

export function EditAgentDialog({ agent, groups, supervisors = [], onSuccess }: {
  agent: Agent; groups: { id: string; name: string }[]; supervisors?: SupervisorOption[]; onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [groupId, setGroupId] = useState('');
  const [supervisorId, setSupervisorId] = useState('');
  const [caseCode, setCaseCode] = useState('');
  const [codeEdited, setCodeEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const { isAdmin, isGroupAdmin } = useUserRole();
  const { t } = useLanguage();
  const copy = useGroupDetailsContent();
  const { toast } = useToast();
  const cache = useQueryClient();
  const codes = useAgentCaseCodes([agent.id], open);
  useEffect(() => {
    if (open && !codeEdited) setCaseCode(codes.data?.get(agent.id) || '');
  }, [open, codeEdited, codes.data, agent.id]);
  const changeOpen = (next: boolean) => {
    if (saving) return;
    setOpen(next);
    if (next) {
      setFirstName(agent.first_name || ''); setLastName(agent.last_name || ''); setUsername(agent.username || '');
      setGroupId(agent.group_id || ''); setSupervisorId(agent.supervisor_id || ''); setCaseCode(''); setCodeEdited(false);
    }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (codes.isPending || codes.isError || !caseCode.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('update_managed_agent', {
        p_agent_id: agent.id, p_first_name: firstName.trim(), p_last_name: lastName.trim(), p_username: username.trim(),
        p_group_id: groupId || null, p_supervisor_id: supervisorId || null, p_case_code: caseCode.trim(),
      });
      if (error) throw error;
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['agent-case-codes'] }),
        cache.invalidateQueries({ queryKey: ['group-details'] }),
        cache.invalidateQueries({ queryKey: ['agent-clients'] }),
      ]);
      toast({ title: t('common.success'), description: t('customerDetail.profileUpdated') });
      setOpen(false); onSuccess();
    } catch (error) {
      toast({ title: t('common.error'), description: getErrorMessage(error), variant: 'destructive' });
    } finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button size="sm" variant="outline" aria-label={`${copy.editAgent} ${`${agent.first_name || ''} ${agent.last_name || ''}`.trim()}`}><Pencil className="h-4 w-4" /></Button></DialogTrigger>
    <DialogContent>
      <DialogHeader><DialogTitle>{copy.editAgent}</DialogTitle><DialogDescription>{copy.editAgentDescription}</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="editAgentFirstName">{t('auth.firstName')}</Label><Input id="editAgentFirstName" value={firstName} onChange={event => setFirstName(event.target.value)} disabled={saving} /></div>
          <div className="space-y-2"><Label htmlFor="editAgentLastName">{t('auth.lastName')}</Label><Input id="editAgentLastName" value={lastName} onChange={event => setLastName(event.target.value)} disabled={saving} /></div>
        </div>
        <div className="space-y-2"><Label htmlFor="editAgentUsername">{t('admin.username')}</Label><Input id="editAgentUsername" value={username} onChange={event => setUsername(event.target.value)} disabled={saving} /></div>
        <div className="space-y-2"><Label>{t('admin.group')}</Label>
          <Select value={groupId || 'no-group'} disabled={!isAdmin || saving} onValueChange={value => { setGroupId(value === 'no-group' ? '' : value); setSupervisorId(''); }}>
            <SelectTrigger aria-label={t('admin.group')}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="no-group">{t('customerDetail.unassigned')}</SelectItem>{groups.map(group => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}</SelectContent>
          </Select>
          {groupId !== (agent.group_id || '') && <p className="text-xs text-muted-foreground">{copy.agentGroupChange}</p>}
        </div>
        {(isAdmin || isGroupAdmin) && <div className="space-y-2"><Label>{t('hierarchy.assignedSupervisor')}</Label><SupervisorSelector value={supervisorId} groupId={groupId || null} supervisors={supervisors} onChange={setSupervisorId} disabled={saving} allowUnassigned /></div>}
        <AgentCaseCodeInput value={caseCode} onChange={value => { setCaseCode(value); setCodeEdited(true); }} required disabled={saving || codes.isPending || codes.isError} />
        <p className="text-sm text-muted-foreground">{copy.agentCaseChange}</p>
        {codes.isError && <div role="alert"><span>{copy.caseCodeError} </span><Button type="button" variant="link" onClick={() => void codes.refetch()}>{copy.retry}</Button></div>}
        <DialogFooter><Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={saving}>{t('common.cancel')}</Button><Button type="submit" disabled={saving || codes.isPending || codes.isError || !caseCode.trim()}>{saving ? t('common.loading') : t('common.save')}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

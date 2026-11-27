import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw, Search, Users, Shield, UserCog, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import type { AppRole } from '@/lib/roles';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { useLanguage } from '@/contexts/LanguageContext';
import { useGroupDetailsContent } from '@/i18n/groupDetails';
import { StaffDashboardLayout } from '@/components/dashboard/StaffDashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SupervisorAgentsDialog } from '@/components/admin/SupervisorAgentsDialog';
import { AgentCaseCode } from '@/components/admin/AgentCaseCode';
import { useAgentCaseCodes } from '@/hooks/useAgentCaseCodes';
import { EditStaffCredentialsDialog } from '@/components/admin/EditStaffCredentialsDialog';

type Member = Pick<Database['public']['Tables']['profiles']['Row'],
  'id' | 'email' | 'first_name' | 'last_name' | 'group_id' | 'supervisor_id' | 'assigned_to' | 'case_number' | 'status'>;
const sections = ['admins', 'supervisors', 'agents', 'clients'] as const;
type Section = typeof sections[number];
const memberName = (member: Member) => `${member.first_name || ''} ${member.last_name || ''}`.trim() || member.email || '—';
const statusKeys = { active: 'common.active', inactive: 'common.inactive', suspended: 'common.suspended', invalid_language: 'common.invalidLanguage' };

export default function GroupDetail() {
  const { groupId } = useParams();
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const { t } = useLanguage();
  const copy = useGroupDetailsContent();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab');
  const tab: Section = sections.includes(requestedTab as Section) ? requestedTab as Section : 'clients';
  const search = params.get('search') || '';
  const agentFilter = tab === 'clients' ? params.get('agent') || '' : '';
  const query = useQuery({
    queryKey: ['group-details', user?.id, groupId],
    enabled: Boolean(user?.id && groupId),
    retry: false, staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const { data: group, error: groupError } = await supabase.from('groups')
        .select('id, name, description, created_at, updated_at').eq('id', groupId!)
        .retry(false).abortSignal(signal).maybeSingle();
      if (groupError) throw groupError;
      if (!group) throw new Error(copy.unavailable);
      const members: Member[] = [];
      // Page all members instead of silently truncating the group at the API limit.
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from('profiles')
          .select('id, email, first_name, last_name, group_id, supervisor_id, assigned_to, case_number, status')
          .eq('group_id', groupId!).eq('is_archived', false).order('id').range(offset, offset + 499)
          .retry(false).abortSignal(signal);
        if (error) throw error;
        members.push(...(data || []).filter(member => member.group_id === groupId));
        if (!data || data.length < 500) break;
      }
      const roles = new Map<string, AppRole>();
      for (let offset = 0; offset < members.length; offset += 100) {
        const { data, error } = await supabase.from('user_roles').select('user_id, role')
          .in('user_id', members.slice(offset, offset + 100).map(member => member.id))
          .retry(false).abortSignal(signal);
        if (error) throw error;
        for (const row of data || []) roles.set(row.user_id, row.role);
      }
      return { group, members, roles };
    },
  });
  const members = query.data?.members || [];
  const roleOf = (member: Member): AppRole => query.data?.roles.get(member.id) || 'user';
  const byId = new Map(members.map(member => [member.id, member]));
  const parentName = (id: string | null) => !id ? t('customerDetail.unassigned')
    : byId.has(id) ? memberName(byId.get(id)!) : copy.notAvailable;
  const grouped = {
    admins: members.filter(member => ['admin', 'group_admin'].includes(roleOf(member))),
    supervisors: members.filter(member => roleOf(member) === 'supervisor'),
    agents: members.filter(member => roleOf(member) === 'agent'),
    clients: members.filter(member => roleOf(member) === 'user'),
  };
  const term = search.trim().toLocaleLowerCase();
  const agentCodes = useAgentCaseCodes(grouped.agents.map(agent => agent.id));
  const visible = grouped[tab].filter(member => (!agentFilter || member.assigned_to === agentFilter)
    && (!term || [memberName(member), member.email, member.case_number,
      member.assigned_to && parentName(member.assigned_to), member.supervisor_id && parentName(member.supervisor_id)]
      .some(value => value?.toLocaleLowerCase().includes(term))))
    .sort((left, right) => memberName(left).localeCompare(memberName(right)));
  const changeTab = (next: string) => setParams(current => {
    current.set('tab', next); current.delete('search'); current.delete('agent'); return current;
  }, { replace: true });
  const icons = { admins: Shield, supervisors: UserCog, agents: Users, clients: Users };
  const showClients = (agentId: string) => setParams(current => {
    current.set('tab', 'clients'); current.set('agent', agentId); current.delete('search'); return current;
  }, { replace: true });

  return <StaffDashboardLayout role={isAdmin ? 'admin' : 'group_admin'}
    title={query.data?.group.name || copy.title} subtitle={query.data?.group.description || copy.description}
    headerActions={<div className="flex flex-wrap gap-2">
      <Button asChild variant="outline"><Link to={isAdmin ? '/admin?tab=groups' : '/group-admin'}>
        <ArrowLeft className="mr-2 h-4 w-4" />{isAdmin ? copy.back : t('nav.dashboard')}
      </Link></Button>
      <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
        <RefreshCw className="mr-2 h-4 w-4" />{copy.refresh}
      </Button>
    </div>} isLoading={query.isPending}>
    {query.isError ? <div role="alert" className="space-y-3 rounded-lg border p-6">
      <p>{query.error instanceof Error ? query.error.message : copy.error}</p>
      <Button variant="outline" onClick={() => void query.refetch()}>{copy.retry}</Button>
    </div> : <div className="min-w-0 space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {sections.map(section => {
          const Icon = icons[section];
          return <button key={section} type="button" onClick={() => changeTab(section)}
            className="rounded-xl border bg-card p-4 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="h-4 w-4" />{copy[section]}</span>
            <span className="mt-2 block text-2xl font-semibold">{grouped[section].length}</span>
          </button>;
        })}
      </div>
      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList className="mb-4 flex h-auto flex-wrap justify-start gap-1">
          {sections.map(section => <TabsTrigger key={section} value={section}>{copy[section]}
            <Badge variant="secondary" className="ml-2">{grouped[section].length}</Badge>
          </TabsTrigger>)}
        </TabsList>
        <div className="relative mb-4">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input aria-label={copy.search} placeholder={copy.search} value={search} className="pl-9"
            onChange={event => setParams(current => { current.set('search', event.target.value); return current; }, { replace: true })} />
        </div>
        {agentFilter && <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span>{copy.clientsFor} <strong>{parentName(agentFilter)}</strong></span>
          <Button variant="ghost" size="sm" onClick={() => setParams(current => { current.delete('agent'); return current; }, { replace: true })}>
            <X className="mr-1 h-3 w-3" />{copy.clear}
          </Button>
        </div>}
        <TabsContent value={tab} className="mt-0">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t('admin.fullName')}</TableHead><TableHead className="hidden lg:table-cell">{t('common.email')}</TableHead>
                {tab === 'admins' && <TableHead className="hidden md:table-cell">{t('admin.roleType')}</TableHead>}
                {tab === 'agents' && <><TableHead className="hidden md:table-cell">{t('hierarchy.assignedSupervisor')}</TableHead><TableHead>{copy.agentCaseCode}</TableHead><TableHead>{t('admin.assignedClients')}</TableHead></>}
                {tab === 'supervisors' && <TableHead>{copy.agents}</TableHead>}
                {tab === 'clients' && <><TableHead className="hidden md:table-cell">{t('admin.caseNumber')}</TableHead><TableHead className="hidden lg:table-cell">{t('customerDetail.assignedAgent')}</TableHead></>}
                <TableHead className="hidden sm:table-cell">{t('common.status')}</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {visible.map(member => <TableRow key={member.id}>
                  <TableCell className="font-medium">
                    {tab === 'agents' ? <Button variant="link" className="h-auto whitespace-normal p-0 text-left" onClick={() => showClients(member.id)}>{memberName(member)}</Button>
                      : tab === 'supervisors' ? <SupervisorAgentsDialog supervisorId={member.id} supervisorName={memberName(member)} groupId={member.group_id} groupName={query.data?.group.name || ''} agents={grouped.agents} clients={grouped.clients}>
                        <Button variant="link" className="h-auto whitespace-normal p-0 text-left">{memberName(member)}</Button>
                      </SupervisorAgentsDialog> : memberName(member)}
                    <p className="mt-1 break-all text-xs font-normal text-muted-foreground lg:hidden">{member.email || '—'}</p>
                    {tab === 'admins' && <p className="mt-1 text-xs font-normal text-muted-foreground md:hidden">{roleOf(member) === 'admin' ? t('hierarchy.superiorAdmin') : copy.groupAdmin}</p>}
                    {tab === 'agents' && <p className="mt-1 text-xs font-normal text-muted-foreground md:hidden">{t('hierarchy.assignedSupervisor')}: {parentName(member.supervisor_id)}</p>}
                    {tab === 'clients' && <>
                      <p className="mt-1 break-all text-xs font-normal text-muted-foreground md:hidden">{t('admin.caseNumber')}: {member.case_number || '—'}</p>
                      <p className="mt-1 text-xs font-normal text-muted-foreground lg:hidden">{t('customerDetail.assignedAgent')}: {parentName(member.assigned_to)}</p>
                    </>}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{member.email || '—'}</TableCell>
                  {tab === 'admins' && <TableCell className="hidden md:table-cell">{roleOf(member) === 'admin' ? t('hierarchy.superiorAdmin') : copy.groupAdmin}</TableCell>}
                  {tab === 'agents' && <>
                    <TableCell className="hidden md:table-cell">{parentName(member.supervisor_id)}</TableCell>
                    <TableCell><AgentCaseCode code={agentCodes.data?.get(member.id)} loading={agentCodes.isPending} error={agentCodes.isError} onRetry={() => void agentCodes.refetch()} /></TableCell>
                    <TableCell><Button size="sm" variant="outline" aria-label={`${copy.clientsFor} ${memberName(member)}`}
                      onClick={() => showClients(member.id)}>
                      {grouped.clients.filter(client => client.assigned_to === member.id).length}
                    </Button></TableCell>
                  </>}
                  {tab === 'supervisors' && <TableCell><SupervisorAgentsDialog supervisorId={member.id} supervisorName={memberName(member)} groupId={member.group_id} groupName={query.data?.group.name || ''} agents={grouped.agents} clients={grouped.clients} /></TableCell>}
                  {tab === 'clients' && <><TableCell className="hidden font-mono md:table-cell">{member.case_number || '—'}</TableCell><TableCell className="hidden lg:table-cell">{parentName(member.assigned_to)}</TableCell></>}
                  <TableCell className="hidden sm:table-cell"><Badge variant="outline">{t(statusKeys[member.status || 'active'])}</Badge></TableCell>
                  {tab === 'clients' && <TableCell className="text-right"><Button asChild size="sm" variant="outline">
                    <Link to={`/customer/${member.id}`}>{t('common.view')}</Link>
                  </Button></TableCell>}
                  {tab !== 'clients' && <TableCell className="text-right">
                    {(isAdmin || roleOf(member) !== 'admin') && <EditStaffCredentialsDialog staff={member} onSuccess={() => void query.refetch()} />}
                  </TableCell>}
                </TableRow>)}
                {!visible.length && <TableRow><TableCell colSpan={tab === 'clients' ? 6 : tab === 'agents' ? 7 : 5}
                  className="py-10 text-center text-muted-foreground">{grouped[tab].length ? copy.noMatches : copy.empty}</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>}
  </StaffDashboardLayout>;
}

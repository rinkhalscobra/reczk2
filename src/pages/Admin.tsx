import { ChangeClientCaseNumberDialog } from '@/components/admin/ChangeClientCaseNumberDialog';
import { AssignmentSummary, ClientAssignmentCells, ClientAssignmentHeaders } from '@/components/admin/ClientAssignments';
import { createAssignmentLookup } from '@/lib/clientAssignments';
import { EditAgentDialog } from '@/components/admin/EditAgentDialog';
import { EditStaffCredentialsDialog } from '@/components/admin/EditStaffCredentialsDialog';
import { AgentCaseCode } from '@/components/admin/AgentCaseCode';
import { useAgentCaseCodes } from '@/hooks/useAgentCaseCodes';
import { useGroupDetailsContent } from '@/i18n/groupDetails';
import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAdmin } from '@/hooks/useAdmin';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { StaffDashboardLayout } from '@/components/dashboard/StaffDashboardLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Users, Shield, UserCog, Trash2, Building2, Globe, UserPlus, FileText, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { MFASetupDialog } from '@/components/admin/MFASetupDialog';
import { CreateGroupDialog } from '@/components/admin/CreateGroupDialog';
import { CreateIPWhitelistDialog } from '@/components/admin/CreateIPWhitelistDialog';
import { EditIPWhitelistDialog } from '@/components/admin/EditIPWhitelistDialog';
import { CreateUserDialog } from '@/components/admin/CreateUserDialog';
import { BulkCreateUsersDialog } from '@/components/admin/BulkCreateUsersDialog';
import ConfiscateStaffDialog from '@/components/admin/ConfiscateStaffDialog';
import { CreateClientDialog } from '@/components/admin/CreateClientDialog';
import { EditStaffNameDialog } from '@/components/admin/EditStaffNameDialog';
import { DeleteUserDialog } from '@/components/admin/DeleteUserDialog';
import { AgentSupervisorSelect } from '@/components/admin/SupervisorSelector';
import { AgentClientsDialog } from '@/components/admin/AgentClientsDialog';
import { SupervisorAgentsDialog } from '@/components/admin/SupervisorAgentsDialog';
import PasswordResetAction from '@/components/admin/PasswordResetAction';
import PermissionsSettings from '@/components/admin/PermissionsSettings';
import PasswordResetRequests from '@/components/admin/PasswordResetRequests';
import { usePermissionsContent } from '@/i18n/permissions';
import { publicContactEmail } from '@/lib/contactEmail';

interface UserProfile {
  case_number?: string | null;
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  phone: string | null;
  birthdate: string | null;
  status: 'active' | 'inactive' | 'suspended' | 'invalid_language' | null;
  group_id: string | null;
  created_by: string | null;
  last_login: string | null;
  is_super: boolean | null;
  assigned_to: string | null;
  supervisor_id: string | null;
  created_at: string | null;
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'Unexpected error';

interface UserRole {
  id: string;
  user_id: string;
  role: 'admin' | 'group_admin' | 'supervisor' | 'agent' | 'user';
  created_at: string | null;
}

interface Group {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface IPWhitelistEntry {
  id: string;
  ip_address: string;
  ip_version: string;
  action: 'ALLOW' | 'DENY';
  subject: string;
  group_id: string | null;
  created_at: string | null;
}

interface IPValidationLog {
  id: string;
  user_id: string | null;
  email: string | null;
  ipv4_address: string | null;
  ipv6_address: string | null;
  user_agent: string | null;
  action: string;
  reason: string | null;
  matched_rule_id: string | null;
  created_at: string | null;
}

const Admin = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useAdmin();
  const { toast } = useToast();
  const { t } = useLanguage();
  const permissionsCopy = usePermissionsContent();
  
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [ipWhitelist, setIpWhitelist] = useState<IPWhitelistEntry[]>([]);
  const [ipLogs, setIpLogs] = useState<IPValidationLog[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [tabParams, setTabParams] = useSearchParams();
  const activeTab = tabParams.get('tab') || 'customers';
  const setActiveTab = (tab: string) => setTabParams(current => { current.set('tab', tab); return current; }, { replace: true });
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');

  useEffect(() => {
    if (isAdmin) {
      fetchData();
    }
  }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = async () => {
    try {
      const [profilesRes, rolesRes, groupsRes, ipRes, ipLogsRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('is_archived', false).order('created_at', { ascending: false }),
        supabase.from('user_roles').select('*'),
        supabase.from('groups').select('*').order('name'),
        supabase.from('ip_whitelist').select('*').order('created_at', { ascending: false }),
        supabase.from('ip_validation_logs').select('*').order('created_at', { ascending: false }).limit(100),
      ]);

      if (profilesRes.error) throw profilesRes.error;
      if (rolesRes.error) throw rolesRes.error;
      if (groupsRes.error) throw groupsRes.error;
      if (ipRes.error) throw ipRes.error;
      if (ipLogsRes.error) throw ipLogsRes.error;

      // Keep related CRM records anchored to the visible accounts and groups.
      const visibleGroupIds = new Set((groupsRes.data || []).map((group) => group.id));
      const visibleUserIds = new Set((profilesRes.data || []).map((profile) => profile.id));

      setUsers(profilesRes.data || []);
      setUserRoles(rolesRes.data || []);
      setGroups(groupsRes.data || []);
      setIpWhitelist((ipRes.data || []).filter((record) => !record.group_id || visibleGroupIds.has(record.group_id)));
      setIpLogs((ipLogsRes.data || []).filter((record) => !record.user_id || visibleUserIds.has(record.user_id)));
    } catch (error: unknown) {
      toast({ title: t('common.error'), description: getErrorMessage(error), variant: "destructive" });
    } finally {
      setLoadingData(false);
    }
  };

  const handleRefresh = async () => fetchData();

  const getUserRole = (userId: string): string => {
    const role = userRoles.find(r => r.user_id === userId);
    return role?.role || 'user';
  };

  const getGroupName = (groupId: string | null): string => {
    if (!groupId) return '-';
    const group = groups.find(g => g.id === groupId);
    return group?.name || '-';
  };

  const getCreatorName = (creatorId: string | null): string => {
    if (!creatorId) return '-';
    const creator = users.find(u => u.id === creatorId);
    return creator ? `${creator.first_name || ''} ${creator.last_name || ''}`.trim() || creator.email || '-' : '-';
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    setUpdatingRole(userId);
    try {
      const { error } = await supabase.rpc('set_managed_user_role', {
        p_user_id: userId,
        p_role: newRole as UserRole['role'],
      });
      if (error) throw error;

      toast({ title: t('admin.roleUpdated'), description: `User role has been updated to ${newRole}.` });
      fetchData();
    } catch (error: unknown) {
      toast({ title: t('common.error'), description: getErrorMessage(error), variant: "destructive" });
    } finally {
      setUpdatingRole(null);
    }
  };

  const handleRemoveRole = async (userId: string) => {
    try {
      const { error } = await supabase.rpc('set_managed_user_role', {
        p_user_id: userId,
        p_role: 'user',
      });
      if (error) throw error;
      toast({ title: t('admin.roleRemoved') });
      fetchData();
    } catch (error: unknown) {
      toast({ title: t('common.error'), description: getErrorMessage(error), variant: "destructive" });
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    try {
      const { error } = await supabase.from('groups').delete().eq('id', groupId);
      if (error) throw error;
      toast({ title: t('admin.groupDeleted') });
      fetchData();
    } catch (error: unknown) {
      toast({ title: t('common.error'), description: getErrorMessage(error), variant: "destructive" });
    }
  };

  const handleDeleteIPRule = async (id: string) => {
    try {
      const { error } = await supabase.from('ip_whitelist').delete().eq('id', id);
      if (error) throw error;
      toast({ title: t('admin.ipRuleDeleted') });
      fetchData();
    } catch (error: unknown) {
      toast({ title: t('common.error'), description: getErrorMessage(error), variant: "destructive" });
    }
  };

  const filterUsersByRole = (role: string, search?: string) => {
    let filtered = role === 'all' ? users : users.filter(u => role === 'administrators' ? ['admin', 'group_admin'].includes(getUserRole(u.id)) : getUserRole(u.id) === role);
    if (search) {
      const term = search.toLowerCase();
      filtered = filtered.filter(u => 
        (u.first_name?.toLowerCase().includes(term)) ||
        (u.last_name?.toLowerCase().includes(term)) ||
        (u.email?.toLowerCase().includes(term)) ||
        (u.case_number?.toLowerCase().includes(term)) ||
        (`${u.first_name || ''} ${u.last_name || ''}`.toLowerCase().includes(term))
      );
    }
    return filtered;
  };

  const getAgentCount = (groupId: string) => {
    return users.filter(u => u.group_id === groupId && getUserRole(u.id) === 'agent').length;
  };

  const caseCopy = useGroupDetailsContent();
  const assignments = createAssignmentLookup(users, userRoles, groups, t('customerDetail.unassigned'), caseCopy.notAvailable);
  const agentCodes = useAgentCaseCodes(filterUsersByRole('agent').map(agent => agent.id));

  if (!isAdmin) return null;

  const roleColors: Record<string, string> = {
    admin: 'bg-red-500/20 text-red-400 border-red-500/30',
    supervisor: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    agent: 'bg-white/10 text-neutral-300 border-white/20',
    user: 'bg-gray-500/20 text-gray-400 border-gray-500/30'
  };

  const statusColors: Record<string, string> = {
    active: 'bg-green-500/20 text-green-400 border-green-500/30',
    inactive: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    invalid_language: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    suspended: 'bg-red-500/20 text-red-400 border-red-500/30'
  };

  return (
    <StaffDashboardLayout
      role="admin"
      title={t('admin.title')}
      subtitle={t('admin.subtitle')}
      onRefresh={handleRefresh}
      isLoading={loadingData}
      headerActions={<div className="flex gap-2"><ConfiscateStaffDialog /><MFASetupDialog /></div>}
    >
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full justify-start bg-card border border-border rounded-lg p-1 mb-6 flex-wrap h-auto gap-1">
          <TabsTrigger value="customers" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Users className="w-4 h-4 mr-2" /> {t('admin.customers')}
          </TabsTrigger>
          <TabsTrigger value="agents" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Users className="w-4 h-4 mr-2" /> {t('admin.agents')}
          </TabsTrigger>
          <TabsTrigger value="supervisors" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <UserCog className="w-4 h-4 mr-2" /> {t('admin.supervisors')}
          </TabsTrigger>
          <TabsTrigger value="admins" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Shield className="w-4 h-4 mr-2" /> {t('admin.admins')}
          </TabsTrigger>
          <TabsTrigger value="groups" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Building2 className="w-4 h-4 mr-2" /> {t('admin.groups')}
          </TabsTrigger>
          <TabsTrigger value="ip-whitelist" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Globe className="w-4 h-4 mr-2" /> {t('admin.ipWhitelist')}
          </TabsTrigger>
          <TabsTrigger value="ip-audit" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <FileText className="w-4 h-4 mr-2" /> {t('admin.ipAuditLogs')}
          </TabsTrigger>
          <TabsTrigger value="permissions" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Shield className="mr-2 h-4 w-4" />{permissionsCopy.title}
          </TabsTrigger>
          <TabsTrigger value="password-requests" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <UserCog className="mr-2 h-4 w-4" />{permissionsCopy.requests}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="permissions"><PermissionsSettings /></TabsContent>
        <TabsContent value="password-requests"><PasswordResetRequests /></TabsContent>

        {/* Customers Tab */}
        <TabsContent value="customers">
          <Card className="bg-card border-border">
            <CardHeader className="border-b border-border flex-row items-center justify-between flex-wrap gap-3">
              <CardTitle className="text-foreground flex items-center gap-2">
                {t('admin.customers')} <Badge variant="secondary">{filterUsersByRole('user', customerSearch).length}</Badge>
              </CardTitle>
              <div className="flex gap-2 items-center">
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={t('common.search') || 'Search clients...'}
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>
                <CreateClientDialog agents={filterUsersByRole('agent')} groups={groups} onSuccess={fetchData} />
                <BulkCreateUsersDialog groups={groups} supervisors={filterUsersByRole('supervisor')} onSuccess={fetchData} />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead>{t('admin.fullName')}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t('common.email')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('admin.caseNumber')}</TableHead>
                    <ClientAssignmentHeaders />
                    <TableHead className="hidden 2xl:table-cell">{t('admin.createdBy')}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t('admin.lastLogin')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filterUsersByRole('user', customerSearch).map((u) => (
                    <TableRow key={u.id} className="border-border">
                      <TableCell className="min-w-[180px] font-medium lg:min-w-0">
                        {u.first_name || u.last_name ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : 'N/A'}
                        <p className="mt-1 break-all text-xs font-normal text-muted-foreground lg:hidden">{u.email || '-'}</p>
                        <p className="mt-1 text-xs font-normal text-muted-foreground md:hidden">{t('admin.caseNumber')}: {u.case_number || '-'}</p>
                        <AssignmentSummary names={assignments.client(u)} />
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">{u.email || '-'}</TableCell>
                      <TableCell className="hidden font-mono text-sm md:table-cell">{u.case_number || '-'}</TableCell>
                      <ClientAssignmentCells names={assignments.client(u)} />
                      <TableCell className="hidden text-muted-foreground 2xl:table-cell">{getCreatorName(u.created_by)}</TableCell>
                      <TableCell className="hidden text-muted-foreground 2xl:table-cell">{u.last_login ? new Date(u.last_login).toLocaleString() : '-'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap gap-2 justify-end">
                          <ChangeClientCaseNumberDialog customerId={u.id} customerName={`${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email || 'Client'} caseNumber={u.case_number} onSuccess={() => void fetchData()} />
                          <Button size="sm" variant="outline" onClick={() => navigate(`/customer/${u.id}`)}>{t('common.view')}</Button>
                          <PasswordResetAction userId={u.id} userEmail={u.email} caseNumber={u.case_number} />
                          <Select value={getUserRole(u.id)} onValueChange={(v) => handleRoleChange(u.id, v)}>
                            <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="user">User</SelectItem>
                              <SelectItem value="agent">Agent</SelectItem>
                              <SelectItem value="supervisor">Supervisor</SelectItem>
                              <SelectItem value="group_admin">Group Admin</SelectItem>
                              <SelectItem value="admin">{t('hierarchy.superiorAdmin')}</SelectItem>
                            </SelectContent>
                          </Select>
                          <DeleteUserDialog
                            userId={u.id}
                            userName={u.first_name || u.last_name ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : u.email || 'User'}
                            onSuccess={fetchData}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filterUsersByRole('user', customerSearch).length === 0 && (
                    <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">{t('admin.noCustomers')}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Agents Tab */}
        <TabsContent value="agents">
          <Card className="bg-card border-border">
            <CardHeader className="border-b border-border flex-row items-center justify-between">
              <CardTitle className="text-foreground flex items-center gap-2">
                {t('admin.agents')} <Badge variant="secondary">{filterUsersByRole('agent').length}</Badge>
              </CardTitle>
              <div className="flex gap-2">
                <BulkCreateUsersDialog groups={groups} supervisors={filterUsersByRole('supervisor')} onSuccess={fetchData} />
                <CreateUserDialog groups={groups} supervisors={filterUsersByRole('supervisor')} roleType="agent" onSuccess={fetchData} />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead>{t('admin.fullName')}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t('common.email')}</TableHead>
                    <TableHead>{t('admin.username')}</TableHead>
                    <TableHead>{t('admin.phone')}</TableHead>
                    <TableHead>{t('admin.birthdate')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead>{t('admin.group')}</TableHead>
                    <TableHead>{t('hierarchy.assignedSupervisor')}</TableHead>
                    <TableHead>{caseCopy.agentCaseCode}</TableHead>
                    <TableHead>{t('admin.assignedClients')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filterUsersByRole('agent').map((u) => (
                    <TableRow key={u.id} className="border-border">
                      <TableCell className="font-medium"><AgentClientsDialog agentId={u.id} groupId={u.group_id} agentName={`${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email || 'Agent'}>
                        <Button variant="link" className="h-auto whitespace-normal p-0 text-left">{`${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email || 'Agent'}</Button>
                      </AgentClientsDialog><p className="mt-1 break-all text-xs font-normal text-muted-foreground lg:hidden">{u.email || '-'}</p><AssignmentSummary names={assignments.agent(u)} /></TableCell>
                      <TableCell className="hidden max-w-[18rem] break-all text-muted-foreground lg:table-cell">{u.email || '-'}</TableCell>
                      <TableCell className="text-muted-foreground">{u.username || '-'}</TableCell>
                      <TableCell className="text-muted-foreground">{u.phone || '-'}</TableCell>
                      <TableCell className="text-muted-foreground">{u.birthdate || '-'}</TableCell>
                      <TableCell><Badge className={`${statusColors[u.status || 'active']} border`}>{(u.status || 'active').toUpperCase()}</Badge></TableCell>
                      <TableCell>{getGroupName(u.group_id)}</TableCell>
                      <TableCell><AgentSupervisorSelect agent={u} supervisors={filterUsersByRole('supervisor')} onSuccess={fetchData} /></TableCell>
                      <TableCell><AgentCaseCode code={agentCodes.data?.get(u.id)} loading={agentCodes.isPending} error={agentCodes.isError} onRetry={() => void agentCodes.refetch()} /></TableCell>
                      <TableCell>
                        <AgentClientsDialog
                          agentId={u.id}
                          groupId={u.group_id}
                          agentName={`${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email || 'Agent'}
                          count={users.filter((customer) => customer.assigned_to === u.id).length}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-2 justify-end">
                          <EditAgentDialog agent={u} groups={groups} supervisors={filterUsersByRole('supervisor')} onSuccess={fetchData} />
                          <EditStaffCredentialsDialog staff={u} onSuccess={fetchData} />
                          <Button size="sm" variant="destructive" onClick={() => handleRemoveRole(u.id)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filterUsersByRole('agent').length === 0 && (
                    <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">{t('admin.noAgents')}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Supervisors Tab */}
        <TabsContent value="supervisors">
          <Card className="bg-card border-border">
            <CardHeader className="border-b border-border flex-row items-center justify-between">
              <CardTitle className="text-foreground flex items-center gap-2">
                {t('admin.supervisors')} <Badge variant="secondary">{filterUsersByRole('supervisor').length}</Badge>
              </CardTitle>
              <div className="flex gap-2">
                <BulkCreateUsersDialog groups={groups} supervisors={filterUsersByRole('supervisor')} onSuccess={fetchData} />
                <CreateUserDialog groups={groups} roleType="supervisor" onSuccess={fetchData} />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead>{t('admin.fullName')}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t('common.email')}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t('admin.username')}</TableHead>
                    <TableHead className="hidden xl:table-cell">{t('admin.phone')}</TableHead>
                    <TableHead className="hidden xl:table-cell">{t('admin.birthdate')}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t('admin.created')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('admin.group')}</TableHead>
                    <TableHead>{t('admin.agents')}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t('common.status')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filterUsersByRole('supervisor').map((u) => (
                    <TableRow key={u.id} className="border-border">
                      <TableCell className="font-medium"><SupervisorAgentsDialog supervisorId={u.id} supervisorName={getCreatorName(u.id)} groupId={u.group_id} groupName={getGroupName(u.group_id)} agents={filterUsersByRole('agent')} clients={filterUsersByRole('user')}>
                        <Button variant="link" className="h-auto whitespace-normal p-0 text-left">{getCreatorName(u.id)}</Button>
                      </SupervisorAgentsDialog><p className="mt-1 break-all text-xs font-normal text-muted-foreground lg:hidden">{u.email || '-'}</p><p className="mt-1 text-xs font-normal text-muted-foreground md:hidden">{t('admin.group')}: {u.group_id ? getGroupName(u.group_id) : t('customerDetail.unassigned')}</p></TableCell>
                      <TableCell className="hidden max-w-[18rem] break-all text-muted-foreground lg:table-cell">{u.email || '-'}</TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">{u.username || '-'}</TableCell>
                      <TableCell className="hidden text-muted-foreground xl:table-cell">{u.phone || '-'}</TableCell>
                      <TableCell className="hidden text-muted-foreground xl:table-cell">{u.birthdate || '-'}</TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</TableCell>
                      <TableCell className="hidden md:table-cell">{u.group_id ? <Link className="underline underline-offset-4" to={`/admin/groups/${u.group_id}`}>{getGroupName(u.group_id)}</Link> : t('customerDetail.unassigned')}</TableCell>
                      <TableCell><SupervisorAgentsDialog supervisorId={u.id} supervisorName={getCreatorName(u.id)} groupId={u.group_id} groupName={getGroupName(u.group_id)} agents={filterUsersByRole('agent')} clients={filterUsersByRole('user')} /></TableCell>
                      <TableCell className="hidden sm:table-cell"><Badge className={`${statusColors[u.status || 'active']} border`}>{(u.status || 'active').toUpperCase()}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-2 justify-end">
                          <EditStaffNameDialog
                            userId={u.id}
                            currentFirstName={u.first_name}
                            currentLastName={u.last_name}
                            currentUsername={u.username}
                            onSuccess={fetchData}
                          />
                          <EditStaffCredentialsDialog staff={u} onSuccess={fetchData} />
                          <Button size="sm" variant="destructive" onClick={() => handleRemoveRole(u.id)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filterUsersByRole('supervisor').length === 0 && (
                    <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">{t('admin.noSupervisors')}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Admins Tab */}
        <TabsContent value="admins">
          <Card className="bg-card border-border">
            <CardHeader className="border-b border-border flex-row items-center justify-between">
              <CardTitle className="text-foreground flex items-center gap-2">
                {t('admin.admins')} <Badge variant="secondary">{filterUsersByRole('administrators').length}</Badge>
              </CardTitle>
              <CreateUserDialog groups={groups} roleType="group_admin" onSuccess={fetchData} />
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead>{t('admin.fullName')}</TableHead>
                    <TableHead>{t('common.email')}</TableHead>
                    <TableHead>{t('admin.roleType')}</TableHead>
                    <TableHead>{t('admin.group')}</TableHead>
                    <TableHead>{t('admin.created')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filterUsersByRole('administrators').map((u) => (
                    <TableRow key={u.id} className="border-border">
                      <TableCell className="font-medium">{u.first_name || u.last_name ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : 'N/A'}</TableCell>
                      <TableCell className="text-muted-foreground">{u.email || 'N/A'}</TableCell>
                      <TableCell>{getUserRole(u.id) === 'admin' ? t('hierarchy.superiorAdmin') : 'Group Admin'}</TableCell>
                      <TableCell>{getGroupName(u.group_id)}</TableCell>
                      <TableCell className="text-muted-foreground">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-2 justify-end">
                          <EditStaffCredentialsDialog staff={u} onSuccess={fetchData} />
                          <Button size="sm" variant="destructive" onClick={() => handleRemoveRole(u.id)} disabled={u.id === user?.id}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filterUsersByRole('administrators').length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('admin.noAdmins')}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Groups Tab */}
        <TabsContent value="groups">
          <Card className="bg-card border-border">
            <CardHeader className="border-b border-border flex-row items-center justify-between">
              <CardTitle className="text-foreground flex items-center gap-2">
                {t('admin.groups')} <Badge variant="secondary">{groups.length}</Badge>
              </CardTitle>
              <CreateGroupDialog onSuccess={fetchData} />
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead>{t('customerDetail.name')}</TableHead>
                    <TableHead>{t('admin.description')}</TableHead>
                    <TableHead>{t('admin.agentsCount')}</TableHead>
                    <TableHead>{t('common.update')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => (
                    <TableRow key={g.id} className="border-border">
                      <TableCell className="font-medium"><Link to={`/admin/groups/${g.id}`} className="text-primary underline-offset-4 hover:underline">{g.name}</Link></TableCell>
                      <TableCell className="text-muted-foreground">{g.description || '-'}</TableCell>
                      <TableCell><Link to={`/admin/groups/${g.id}?tab=agents`}><Badge variant="secondary">{getAgentCount(g.id)}</Badge></Link></TableCell>
                      <TableCell className="text-muted-foreground">{g.updated_at ? new Date(g.updated_at).toLocaleDateString() : '-'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button asChild size="sm" variant="outline"><Link to={`/admin/groups/${g.id}`}>{t('common.view')}</Link></Button>
                          <Button size="sm" variant="destructive" onClick={() => handleDeleteGroup(g.id)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {groups.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{t('admin.noGroups')}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* IP Whitelist Tab */}
        <TabsContent value="ip-whitelist">
          <Card className="bg-card border-border">
            <CardHeader className="border-b border-border flex-row items-center justify-between">
              <CardTitle className="text-foreground flex items-center gap-2">
                {t('admin.ipWhitelist')} <Badge variant="secondary">{ipWhitelist.length}</Badge>
              </CardTitle>
              <CreateIPWhitelistDialog onSuccess={fetchData} isAdmin={true} />
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead>{t('admin.ipAddress')}</TableHead>
                    <TableHead>{t('admin.ipVersion')}</TableHead>
                    <TableHead>{t('admin.subject')}</TableHead>
                    <TableHead>{t('admin.action')}</TableHead>
                    <TableHead>{t('admin.created')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ipWhitelist.map((ip) => (
                    <TableRow key={ip.id} className="border-border">
                      <TableCell className="font-mono">{ip.ip_address}</TableCell>
                      <TableCell><Badge variant="outline">{ip.ip_version}</Badge></TableCell>
                      <TableCell className="text-muted-foreground">{ip.subject}</TableCell>
                      <TableCell>
                        <Badge className={ip.action === 'ALLOW' ? 'bg-green-500/20 text-green-400 border-green-500/30 border' : 'bg-red-500/20 text-red-400 border-red-500/30 border'}>
                          {ip.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{ip.created_at ? new Date(ip.created_at).toLocaleDateString() : '-'}</TableCell>
                      <TableCell className="text-right flex gap-2 justify-end">
                        <EditIPWhitelistDialog entry={ip} onSuccess={fetchData} isAdmin={true} />
                        <Button size="sm" variant="destructive" onClick={() => handleDeleteIPRule(ip.id)}><Trash2 className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {ipWhitelist.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('admin.noIPRules')}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* IP Audit Logs Tab */}
        <TabsContent value="ip-audit">
          <Card className="bg-card border-border">
            <CardHeader className="border-b border-border flex-row items-center justify-between">
              <CardTitle className="text-foreground flex items-center gap-2">
                {t('admin.ipAuditLogs')} <Badge variant="secondary">{ipLogs.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead>{t('admin.timestamp')}</TableHead>
                    <TableHead>{t('common.email')}</TableHead>
                    <TableHead>IPv4</TableHead>
                    <TableHead>IPv6</TableHead>
                    <TableHead>{t('admin.result')}</TableHead>
                    <TableHead>{t('admin.reason')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ipLogs.map((log) => (
                    <TableRow key={log.id} className="border-border">
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {log.created_at ? new Date(log.created_at).toLocaleString() : '-'}
                      </TableCell>
                      <TableCell>{publicContactEmail({ email: users.find(account => account.id === log.user_id)?.email || log.email }) || '-'}</TableCell>
                      <TableCell className="font-mono text-sm">{log.ipv4_address || '-'}</TableCell>
                      <TableCell className="font-mono text-sm max-w-[200px] truncate" title={log.ipv6_address || undefined}>
                        {log.ipv6_address || '-'}
                      </TableCell>
                      <TableCell>
                        <Badge className={
                          log.action === 'ALLOWED' 
                            ? 'bg-green-500/20 text-green-400 border-green-500/30 border' 
                            : log.action === 'DENIED'
                            ? 'bg-red-500/20 text-red-400 border-red-500/30 border'
                            : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30 border'
                        }>
                          {log.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-[300px] truncate" title={log.reason || undefined}>
                        {log.reason || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                  {ipLogs.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('admin.noAuditLogs')}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </StaffDashboardLayout>
  );
};

export default Admin;

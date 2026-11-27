import { ChangeClientCaseNumberDialog } from '@/components/admin/ChangeClientCaseNumberDialog';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAdmin } from '@/hooks/useAdmin';
import { supabase } from '@/integrations/supabase/client';
import { StaffDashboardLayout } from '@/components/dashboard/StaffDashboardLayout';
import { PendingTransactions } from '@/components/dashboard/PendingTransactions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Users, Search, Eye, Bell } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import CreateNotificationDialog from '@/components/admin/CreateNotificationDialog';
import { CreateClientDialog } from '@/components/admin/CreateClientDialog';
import { RouteStatus } from '@/components/RouteStatus';
import { useAgentCaseCodes } from '@/hooks/useAgentCaseCodes';
import { AgentCaseCode } from '@/components/admin/AgentCaseCode';
import { useGroupDetailsContent } from '@/i18n/groupDetails';

interface CustomerProfile {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  status: string | null;
  case_number: string | null;
  subscription: string | null;
  created_at: string | null;
  group_id: string | null;
}

type UserStatus = 'active' | 'inactive' | 'suspended' | 'invalid_language';
const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'Unexpected error';

const Agent = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { userRole } = useAdmin();
  const { toast } = useToast();
  const { t } = useLanguage();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const caseCopy = useGroupDetailsContent();
  const caseCodes = useAgentCaseCodes(userId ? [userId] : [], userRole === 'agent');

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const queryKey = ['agent-data', userId];
  const { data: agentData, isPending: loading, error: loadError, refetch } = useQuery({
    queryKey,
    enabled: Boolean(userId) && userRole === 'agent',
    queryFn: async () => {
      // Neither query depends on the other; start both together.
      const signal = AbortSignal.timeout(15_000);
      const [profileResult, customersResult] = await Promise.all([
        supabase.from('profiles').select('group_id').eq('id', userId!).abortSignal(signal).maybeSingle(),
        supabase.from('profiles')
          .select('id, email, first_name, last_name, status, case_number, subscription, created_at, group_id')
          .eq('assigned_to', userId!).eq('is_archived', false)
          .order('created_at', { ascending: false }).abortSignal(signal),
      ]);
      if (profileResult.error) throw new Error(profileResult.error.message);
      if (!profileResult.data) throw new Error('Your agent profile is unavailable. Please contact your administrator.');
      if (customersResult.error) throw new Error(customersResult.error.message);
      return { groupId: profileResult.data.group_id, customers: customersResult.data || [] };
    },
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const customers = agentData?.customers ?? [];
  const myGroupId = agentData?.groupId;
  const fetchAgentData = async () => {
    await refetch();
  };

  const handleStatusChange = async (customerId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ status: newStatus as UserStatus })
        .eq('id', customerId);

      if (error) throw error;
      toast({ title: t('admin.statusUpdated') });
      queryClient.setQueryData(queryKey, (current: typeof agentData) => current && ({
        ...current,
        customers: current.customers.map(customer => customer.id === customerId
          ? { ...customer, status: newStatus as UserStatus } : customer),
      }));
    } catch (error: unknown) {
      toast({ title: t('deposit.error'), description: getErrorMessage(error), variant: "destructive" });
    }
  };

  const filteredCustomers = customers.filter(c => {
    const matchesSearch = 
      (c.first_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
       c.last_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
       c.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
       c.case_number?.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusColors: Record<string, string> = {
    active: 'bg-green-500/20 text-green-400',
    inactive: 'bg-gray-500/20 text-gray-400',
    invalid_language: 'bg-amber-500/20 text-amber-400',
    suspended: 'bg-red-500/20 text-red-400'
  };

  const handleRefresh = async () => {
    await Promise.all([fetchAgentData(), caseCodes.refetch()]);
  };

  return (
    <StaffDashboardLayout
      role="agent"
      title={t('agent.title')}
      subtitle={`${customers.length} ${t('agent.assignedCustomers')}`}
      onRefresh={handleRefresh}
      isLoading={loading}
      headerActions={
        myGroupId && (
          <CreateClientDialog
            defaultGroupId={myGroupId}
            defaultAssignedTo={user?.id}
            onSuccess={fetchAgentData}
          />
        )
      }
    >
      <section aria-label={caseCopy.yourCaseNumber} className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card px-4 py-3">
        <span className="text-sm font-medium">{caseCopy.yourCaseNumber}</span>
        <AgentCaseCode code={userId ? caseCodes.data?.get(userId) : undefined} loading={caseCodes.isPending}
          error={caseCodes.isError} onRetry={() => void caseCodes.refetch()} />
        {caseCodes.isError && <p role="alert" className="w-full text-sm text-destructive">{caseCopy.caseCodeError}</p>}
      </section>
      {loadError ? <RouteStatus error={loadError.message} onRetry={() => void refetch()} /> : <>
      {/* Pending Transactions Card - at the top */}
      <div className="mb-6">
        <PendingTransactions assignedOnly={true} className="bg-card border-border" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <Card className="bg-card border-border">
          <CardContent className="p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
            <div className="p-2 sm:p-3 bg-green-500/20 rounded-lg">
              <Users className="h-5 w-5 sm:h-6 sm:w-6 text-green-400" />
            </div>
            <div>
              <p className="text-xl sm:text-2xl font-bold">{customers.filter(c => c.status === 'active').length}</p>
              <p className="text-xs sm:text-sm text-muted-foreground">{t('common.active')}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
            <div className="p-2 sm:p-3 bg-yellow-500/20 rounded-lg">
              <Users className="h-5 w-5 sm:h-6 sm:w-6 text-yellow-400" />
            </div>
            <div>
              <p className="text-xl sm:text-2xl font-bold">{customers.filter(c => c.status === 'inactive').length}</p>
              <p className="text-xs sm:text-sm text-muted-foreground">{t('common.inactive')}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
            <div className="p-2 sm:p-3 bg-red-500/20 rounded-lg">
              <Users className="h-5 w-5 sm:h-6 sm:w-6 text-red-400" />
            </div>
            <div>
              <p className="text-xl sm:text-2xl font-bold">{customers.filter(c => c.status === 'suspended').length}</p>
              <p className="text-xs sm:text-sm text-muted-foreground">{t('common.suspended')}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="bg-card border-border mb-4 sm:mb-6">
        <CardHeader className="border-b border-border py-3">
          <CardTitle className="text-sm">{t('admin.myCustomers')}</CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-4">
          <div className="flex gap-3 sm:gap-4 flex-col sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('admin.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder={t('admin.filterByStatus')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('transactions.allStatus')}</SelectItem>
                <SelectItem value="active">{t('common.active')}</SelectItem>
                <SelectItem value="inactive">{t('common.inactive')}</SelectItem>
                <SelectItem value="suspended">{t('common.suspended')}</SelectItem>
                <SelectItem value="invalid_language">{t('common.invalidLanguage')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Customers Table */}
      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="min-w-[140px]">{t('admin.fullName')}</TableHead>
                  <TableHead className="min-w-[180px] hidden sm:table-cell">{t('auth.email')}</TableHead>
                  <TableHead className="min-w-[100px] hidden md:table-cell">{t('admin.caseNumber')}</TableHead>
                  <TableHead className="min-w-[80px] hidden lg:table-cell">{t('admin.subscription')}</TableHead>
                  <TableHead className="min-w-[100px]">{t('transactions.status')}</TableHead>
                  <TableHead className="min-w-[100px] hidden md:table-cell">{t('admin.created')}</TableHead>
                  <TableHead className="text-right min-w-[120px]">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCustomers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      {customers.length === 0 ? t('admin.noCustomersAssigned') : t('admin.noMatchingCustomers')}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCustomers.map((customer) => (
                    <TableRow key={customer.id} className="border-border">
                      <TableCell className="font-medium">
                        <div>
                          {customer.first_name} {customer.last_name}
                          <div className="text-xs text-muted-foreground sm:hidden">{customer.email}</div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{customer.email}</TableCell>
                      <TableCell className="hidden md:table-cell">{customer.case_number || '-'}</TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <Badge variant="outline" className="text-xs">{customer.subscription || 'BASIC'}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`${statusColors[customer.status || 'active']} border-0 text-xs`}>
                          {customer.status || 'active'}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {customer.created_at ? new Date(customer.created_at).toLocaleDateString() : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 sm:gap-2 justify-end">
                          <ChangeClientCaseNumberDialog customerId={customer.id} customerName={`${customer.first_name || ''} ${customer.last_name || ''}`.trim() || customer.email || 'Client'} caseNumber={customer.case_number} onSuccess={() => void fetchAgentData()} />
                          <CreateNotificationDialog
                            userId={customer.id}
                            userName={`${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Customer'}
                          >
                            <Button size="sm" variant="outline" className="h-8 w-8 p-0 sm:w-auto sm:px-2">
                              <Bell className="h-4 w-4" />
                            </Button>
                          </CreateNotificationDialog>
                          <Button 
                            size="sm" 
                            variant="outline"
                            className="h-8 px-2 text-xs sm:text-sm"
                            onClick={() => navigate(`/customer/${customer.id}`)}
                          >
                            <Eye className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">{t('common.view')}</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      </>}
    </StaffDashboardLayout>
  );
};

export default Agent;

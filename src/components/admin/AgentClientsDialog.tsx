import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Eye } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useGroupDetailsContent } from '@/i18n/groupDetails';
import { getErrorMessage } from '@/lib/errorMessage';
import { AgentCaseCodeFor } from './AgentCaseCode';

interface AssignedClient {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  case_number: string | null;
  case_phase: string | null;
  status: string | null;
  created_at: string | null;
}

interface AgentClientsDialogProps {
  agentId: string;
  agentName: string;
  /** Optional pre-computed count shown on the trigger button */
  count?: number;
  groupId?: string | null;
  children?: ReactElement;
}

const statusColors: Record<string, string> = {
  active: 'bg-green-500/20 text-green-400 border-green-500/30',
  inactive: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  invalid_language: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  suspended: 'bg-red-500/20 text-red-400 border-red-500/30',
};

export const AgentClientsDialog = ({ agentId, agentName, count, groupId, children }: AgentClientsDialogProps) => {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const { t } = useLanguage();
  const copy = useGroupDetailsContent();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['agent-clients', user?.id, agentId, groupId],
    enabled: open && Boolean(user?.id),
    retry: false,
    queryFn: async ({ signal }) => {
      const clients: AssignedClient[] = [];
      for (let offset = 0; ; offset += 500) {
        let request = supabase.from('profiles')
          .select('id, first_name, last_name, email, case_number, case_phase, status, created_at')
          .eq('assigned_to', agentId).eq('is_archived', false);
        if (groupId) request = request.eq('group_id', groupId);
        const { data, error } = await request.order('created_at', { ascending: false }).order('id')
          .range(offset, offset + 499).retry(false).abortSignal(signal);
        if (error) throw error;
        clients.push(...(data || []));
        if (!data || data.length < 500) return clients;
      }
    },
  });
  const clients = query.data || [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || <Button size="sm" variant="outline" className="h-8 px-2 gap-1" aria-label={`${copy.clientsFor} ${agentName}`}>
          <Users className="h-4 w-4" />
          {typeof count === 'number' && <span className="text-xs">{count}</span>}
        </Button>}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-lg">
        <DialogHeader>
          <DialogTitle>{t('admin.assignedClients')}</DialogTitle>
          <DialogDescription>{agentName}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><span className="text-muted-foreground">{copy.agentCaseCode}:</span><AgentCaseCodeFor agentId={agentId} enabled={open} /></div>
          <Button asChild variant="outline" size="sm"><Link to={`/customer/${agentId}`}>{t('customerDetail.profile')}</Link></Button>
        </div>

        {query.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : query.isError ? (
          <div role="alert" className="space-y-3">
            <p>{t('common.error')}: {getErrorMessage(query.error)}</p>
            <Button variant="outline" onClick={() => void query.refetch()}>{copy.retry}</Button>
          </div>
        ) : clients.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">{t('admin.noAssignedClients')}</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead>{t('admin.fullName')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('common.email')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('admin.caseNumber')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((c) => (
                  <TableRow key={c.id} className="border-border">
                    <TableCell className="font-medium">
                      {`${c.first_name || ''} ${c.last_name || ''}`.trim() || 'N/A'}
                      <p className="mt-1 break-all text-xs font-normal text-muted-foreground sm:hidden">{c.email || '-'}</p>
                      <p className="mt-1 text-xs font-normal text-muted-foreground md:hidden">{t('admin.caseNumber')}: {c.case_number || '-'}</p>
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden sm:table-cell">{c.email || '-'}</TableCell>
                    <TableCell className="text-muted-foreground hidden md:table-cell">{c.case_number || '-'}</TableCell>
                    <TableCell>
                      <Badge className={`${statusColors[c.status || 'active']} border`}>
                        {(c.status || 'active').toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2"
                        aria-label={`${t('common.view')} ${`${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || 'N/A'}`}
                        onClick={() => {
                          setOpen(false);
                          navigate(`/customer/${c.id}`);
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default AgentClientsDialog;

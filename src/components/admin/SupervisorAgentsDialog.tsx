import { useState, type ReactElement } from 'react';
import { useAgentCaseCodes } from '@/hooks/useAgentCaseCodes';
import { AgentCaseCode } from './AgentCaseCode';
import { useLanguage } from '@/contexts/LanguageContext';
import { useGroupDetailsContent } from '@/i18n/groupDetails';
import { AgentClientsDialog } from './AgentClientsDialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface Agent {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  group_id: string | null;
  supervisor_id: string | null;
}

interface SupervisorAgentsDialogProps {
  supervisorId: string;
  supervisorName: string;
  groupId: string | null;
  groupName: string;
  agents: Agent[];
  clients: { assigned_to: string | null; group_id: string | null }[];
  children?: ReactElement;
}

export function SupervisorAgentsDialog({ supervisorId, supervisorName, groupId, groupName, agents, clients, children }: SupervisorAgentsDialogProps) {
  const { t } = useLanguage();
  const copy = useGroupDetailsContent();
  const assigned = agents.filter(agent => Boolean(groupId) && agent.group_id === groupId && agent.supervisor_id === supervisorId);
  const [open, setOpen] = useState(false);
  const codes = useAgentCaseCodes(assigned.map(agent => agent.id), open);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      {children || <Button size="sm" variant="outline" aria-label={`${copy.agentsFor} ${supervisorName}`}>{assigned.length}</Button>}
    </DialogTrigger>
    <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-lg">
      <DialogHeader>
        <DialogTitle>{copy.agentsFor} {supervisorName}</DialogTitle>
        <DialogDescription>{t('admin.group')}: {groupName}</DialogDescription>
      </DialogHeader>
      {assigned.length ? <div className="max-h-[60vh] overflow-auto"><Table>
        <TableHeader><TableRow>
          <TableHead>{t('admin.fullName')}</TableHead>
          <TableHead className="hidden sm:table-cell">{t('common.email')}</TableHead>
          <TableHead className="hidden sm:table-cell">{copy.agentCaseCode}</TableHead>
          <TableHead>{t('admin.assignedClients')}</TableHead>
        </TableRow></TableHeader>
        <TableBody>{assigned.map(agent => {
          const name = `${agent.first_name || ''} ${agent.last_name || ''}`.trim() || agent.email || '—';
          const count = clients.filter(client => client.group_id === groupId && client.assigned_to === agent.id).length;
          return <TableRow key={agent.id}>
            <TableCell>
              <AgentClientsDialog agentId={agent.id} agentName={name} groupId={groupId}>
                <Button variant="link" className="h-auto whitespace-normal p-0 text-left">{name}</Button>
              </AgentClientsDialog>
              <p className="mt-1 break-all text-xs text-muted-foreground sm:hidden">{agent.email || '—'}</p>
              <div className="mt-1 sm:hidden"><AgentCaseCode code={codes.data?.get(agent.id)} loading={codes.isPending} error={codes.isError} onRetry={() => void codes.refetch()} /></div>
            </TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">{agent.email || '—'}</TableCell>
            <TableCell className="hidden sm:table-cell"><AgentCaseCode code={codes.data?.get(agent.id)} loading={codes.isPending} error={codes.isError} onRetry={() => void codes.refetch()} /></TableCell>
            <TableCell><AgentClientsDialog agentId={agent.id} agentName={name} groupId={groupId} count={count} /></TableCell>
          </TableRow>;
        })}</TableBody>
      </Table></div> : <p className="py-8 text-center text-muted-foreground">{t('admin.noAgents')}</p>}
    </DialogContent>
  </Dialog>;
}

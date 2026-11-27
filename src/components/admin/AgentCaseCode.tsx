import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useGroupDetailsContent } from '@/i18n/groupDetails';
import { useAgentCaseCodes } from '@/hooks/useAgentCaseCodes';

interface AgentCaseCodeProps {
  code?: string;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}

export function AgentCaseCode({ code, loading, error, onRetry }: AgentCaseCodeProps) {
  const copy = useGroupDetailsContent();
  const { toast } = useToast();
  if (loading) return <span aria-label={copy.agentCaseCode} className="text-muted-foreground">…</span>;
  if (error) return <Button variant="link" size="sm" className="h-auto p-0" onClick={onRetry}>{copy.retry}</Button>;
  if (!code) return <span className="text-muted-foreground">{copy.notAvailable}</span>;
  return <span className="inline-flex items-center gap-1">
    <code className="break-all text-xs">{code}</code>
    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label={`${copy.copyCode} ${code}`}
      onClick={async () => {
        try { await navigator.clipboard.writeText(code); toast({ description: copy.codeCopied }); }
        catch { toast({ description: copy.copyFailed, variant: 'destructive' }); }
      }}><Copy className="h-3.5 w-3.5" /></Button>
  </span>;
}

export function AgentCaseCodeFor({ agentId, enabled = true }: { agentId: string; enabled?: boolean }) {
  const query = useAgentCaseCodes([agentId], enabled);
  return <AgentCaseCode code={query.data?.get(agentId)} loading={query.isPending} error={query.isError} onRetry={() => void query.refetch()} />;
}

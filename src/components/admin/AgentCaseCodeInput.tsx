import { RefreshCw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useGroupDetailsContent } from '@/i18n/groupDetails';

export function AgentCaseCodeInput({ value, onChange, required = false, disabled = false }: {
  value: string; onChange: (value: string) => void; required?: boolean; disabled?: boolean;
}) {
  const copy = useGroupDetailsContent();
  return <div className="space-y-2">
    <Label htmlFor="agentCaseCode">{copy.agentCaseCode}</Label>
    <div className="flex gap-2">
      <Input id="agentCaseCode" value={value} onChange={event => onChange(event.target.value)} maxLength={100} autoCapitalize="none" autoCorrect="off" spellCheck={false}
        required={required} disabled={disabled} placeholder={copy.autoCaseCode} />
      <Button type="button" variant="outline" disabled={disabled} aria-label={copy.generateCode}
        onClick={() => onChange(`AGT-${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`)}><RefreshCw className="h-4 w-4" /></Button>
    </div>
    {!required && <p className="text-xs text-muted-foreground">{copy.autoCaseCode}</p>}
  </div>;
}

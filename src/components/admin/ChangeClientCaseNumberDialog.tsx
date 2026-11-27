import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useClientCaseNumberContent } from '@/i18n/clientCaseNumber';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { getErrorMessage } from '@/lib/errorMessage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

export function ChangeClientCaseNumberDialog({ customerId, customerName, caseNumber, onSuccess, compact = false }: {
  customerId: string; customerName: string; caseNumber: string | null | undefined;
  onSuccess: (value: string) => void; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputId = useId();
  const { t } = useLanguage();
  const copy = useClientCaseNumberContent();
  const cache = useQueryClient();
  const { toast } = useToast();
  const changeOpen = (next: boolean) => {
    if (saving) return;
    setOpen(next);
    if (next) { setValue(caseNumber || ''); setError(''); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = value.trim();
    const validCharacters = Array.from(normalized).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
    if (!normalized || normalized.length > 100 || !validCharacters) { setError(copy.invalid); return; }
    setSaving(true); setError('');
    try {
      const { data, error } = await supabase.rpc('set_client_case_number', { p_customer_id: customerId, p_case_number: normalized });
      if (error) throw error;
      if (typeof data !== 'string' || !data.trim()) throw new Error(copy.unconfirmed);
      await Promise.all(['agent-data', 'agent-clients', 'group-details'].map(key => cache.invalidateQueries({ queryKey: [key] })));
      onSuccess(data);
      toast({ title: t('common.success'), description: copy.saved });
      setOpen(false);
    } catch (error) { setError(getErrorMessage(error)); }
    finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button type="button" size="sm" variant="outline" className="h-8 gap-1 px-2"
      title={`${copy.changeFor} ${customerName}`} aria-label={`${copy.changeFor} ${customerName}`}>
      <Pencil className="h-3.5 w-3.5" />{!compact && <span className="hidden sm:inline">{copy.change}</span>}
    </Button></DialogTrigger>
    <DialogContent>
      <DialogHeader><DialogTitle>{copy.change}</DialogTitle><DialogDescription>{customerName}. {copy.hint}</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2"><Label htmlFor={inputId}>{t('admin.caseNumber')}</Label><Input id={inputId} value={value} onChange={event => setValue(event.target.value)} required maxLength={100} disabled={saving} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={saving}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={saving || !value.trim()}>{saving ? t('common.loading') : t('common.save')}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

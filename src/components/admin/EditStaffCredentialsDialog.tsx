import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRolePermission } from '@/hooks/useRolePermission';
import { useLanguage } from '@/contexts/LanguageContext';
import { useStaffCredentialsContent } from '@/i18n/staffCredentials';
import { usePermissionsContent } from '@/i18n/permissions';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/errorMessage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

export function EditStaffCredentialsDialog({ staff, onSuccess }: {
  staff: { id: string; email: string | null; first_name: string | null; last_name: string | null };
  onSuccess: () => void;
}) {
  const { user } = useAuth();
  const permission = useRolePermission('reset_password');
  const { t } = useLanguage();
  const copy = useStaffCredentialsContent();
  const permissionsCopy = usePermissionsContent();
  const { toast } = useToast();
  const cache = useQueryClient();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const normalizedEmail = email.trim().toLowerCase();
  const emailChanged = normalizedEmail !== (staff.email || '').trim().toLowerCase();
  const validPassword = !password || (password.length >= 8 && !!password.trim() && password === confirmation);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) && validPassword
    && (emailChanged || !!password) && (!confirmation || !!password) && permission.mode === 'direct';
  const clear = () => { setPassword(''); setConfirmation(''); setVisible(false); };
  const changeOpen = (next: boolean) => {
    if (saving) return;
    clear(); setEmail(next ? staff.email || '' : ''); setOpen(next);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('update-staff-credentials', { body: {
        userId: staff.id,
        ...(emailChanged ? { newEmail: normalizedEmail } : {}),
        ...(password ? { newPassword: password } : {}),
      } });
      if (error) {
        if (error instanceof FunctionsHttpError) {
          const details = await error.context.clone().json().catch(() => null);
          if (typeof details?.error === 'string') throw new Error(details.error);
        }
        throw error;
      }
      if (data?.error) throw new Error(data.error);
      if (data?.success !== true || data?.userId !== staff.id) throw new Error(copy.failed);
      setOpen(false); clear(); setEmail('');
      toast({ title: t('common.success'), description: copy.saved });
      await cache.invalidateQueries({ queryKey: ['group-details'] });
      onSuccess();
    } catch (error) {
      toast({ title: t('common.error'), description: getErrorMessage(error), variant: 'destructive' });
    } finally { setSaving(false); }
  };
  if (user?.id === staff.id) return null;
  if (permission.error) return <Button size="sm" variant="outline" title={permissionsCopy.error} onClick={() => void permission.refetch()}>{permissionsCopy.retry}</Button>;
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button size="sm" variant="outline" disabled={permission.isLoading || permission.mode !== 'direct'}
      title={permission.mode !== 'direct' ? copy.restricted : undefined}><KeyRound className="mr-2 h-4 w-4" />{copy.edit}</Button></DialogTrigger>
    <DialogContent>
      <DialogHeader><DialogTitle>{copy.edit}</DialogTitle><DialogDescription>
        {copy.description} {`${staff.first_name || ''} ${staff.last_name || ''}`.trim() || staff.email}.
      </DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2"><Label htmlFor={`${id}-email`}>{t('auth.email')}</Label>
          <Input id={`${id}-email`} type="email" autoComplete="off" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={saving} required /></div>
        <p className="text-sm text-muted-foreground">{copy.hint}</p>
        <div className="space-y-2"><Label htmlFor={`${id}-password`}>{t('customerDetail.newPassword')}</Label>
          <div className="flex gap-2"><Input id={`${id}-password`} type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={8}
            value={password} onChange={event => setPassword(event.target.value)} disabled={saving} />
            <Button type="button" size="icon" variant="outline" disabled={saving} onClick={() => setVisible(!visible)} aria-label={t(visible ? 'passwordControl.hide' : 'passwordControl.show')}>
              {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button></div>
          <p className="text-xs text-muted-foreground">{t('customerDetail.passwordTooShort')}</p></div>
        <div className="space-y-2"><Label htmlFor={`${id}-confirmation`}>{t('auth.confirmPassword')}</Label>
          <Input id={`${id}-confirmation`} type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={8} required={!!password}
            value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={saving} />
          {confirmation && confirmation !== password && <p role="status" className="text-sm text-destructive">{t('auth.passwordsDoNotMatch')}</p>}</div>
        <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={() => changeOpen(false)}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={!valid || saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('common.save')}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

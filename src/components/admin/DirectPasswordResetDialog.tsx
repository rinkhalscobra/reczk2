import { generateSecurePassword } from '@/lib/passwords';
import { useId, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Key, Loader2, Copy, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { getErrorMessage } from '@/lib/errorMessage';

interface DirectPasswordResetDialogProps {
  userId: string;
  userEmail: string | null;
  caseNumber?: string | null;
  onSuccess?: () => void;
  children?: React.ReactNode;
}


export default function DirectPasswordResetDialog({ userId, userEmail, caseNumber, onSuccess, children }: DirectPasswordResetDialogProps) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const valid = newPassword.length >= 8 && !!newPassword.trim() && newPassword === confirmation;

  const clearPassword = () => {
    setNewPassword('');
    setConfirmation('');
    setShowPassword(false);
  };

  const handleCopyPassword = async () => {
    try {
      await navigator.clipboard.writeText(newPassword);
      toast({ title: t('common.copied'), description: t('customerDetail.passwordCopied') });
    } catch {
      toast({ title: t('common.error'), description: t('passwordControl.copyFailed'), variant: 'destructive' });
    }
  };

  const handleDirectReset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || loading) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('reset-user-password', { body: { userId, newPassword } });
      if (error) {
        if (error instanceof FunctionsHttpError) {
          const details = await error.context.clone().json().catch(() => null);
          if (typeof details?.error === 'string') throw new Error(details.error);
        }
        throw error;
      }
      if (data?.error) throw new Error(data.error);
      if (data?.success !== true) throw new Error(t('passwordControl.failed'));
      toast({ title: t('common.success'), description: t('customerDetail.passwordResetSuccess') });
      setOpen(false);
      clearPassword();
      onSuccess?.();
    } catch (error: unknown) {
      toast({ title: t('common.error'), description: getErrorMessage(error), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!loading) { setOpen(next); if (!next) clearPassword(); } }}>
      <DialogTrigger asChild>
        {children || <Button variant="outline" size="sm"><Key className="h-4 w-4 mr-2" />{t('passwordControl.change')}</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('passwordControl.change')}</DialogTitle>
          <DialogDescription>
            {t('passwordControl.description')} {userEmail || userId}. {t('passwordControl.previousPassword')}
            {caseNumber && <span className="mt-1 block">{t('admin.caseNumber')}: {caseNumber}</span>}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleDirectReset} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`${id}-new`}>{t('customerDetail.newPassword')}</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input id={`${id}-new`} type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8}
                  value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={loading} className="pr-10" required />
                <Button type="button" variant="ghost" size="sm" className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  disabled={loading} onClick={() => setShowPassword(!showPassword)} aria-label={t(showPassword ? 'passwordControl.hide' : 'passwordControl.show')}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <Button type="button" variant="outline" size="icon" onClick={handleCopyPassword} disabled={!newPassword || loading}
                aria-label={t('customerDetail.copyPassword')}><Copy className="h-4 w-4" /></Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('customerDetail.passwordTooShort')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-confirm`}>{t('auth.confirmPassword')}</Label>
            <Input id={`${id}-confirm`} type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8}
              value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={loading} required />
            {confirmation && newPassword !== confirmation && <p role="status" className="text-sm text-destructive">{t('auth.passwordsDoNotMatch')}</p>}
          </div>
          <Button type="button" variant="secondary" className="w-full" disabled={loading} onClick={() => {
            const password = generateSecurePassword();
            setNewPassword(password);
            setConfirmation(password);
            setShowPassword(true);
          }}><RefreshCw className="h-4 w-4 mr-2" />{t('customerDetail.generatePassword')}</Button>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={loading} onClick={() => { setOpen(false); clearPassword(); }}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={!valid || loading}>{loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{t('passwordControl.change')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

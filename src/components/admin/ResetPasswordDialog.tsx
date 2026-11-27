import { getErrorMessage } from '@/lib/errorMessage';
import { usePermissionsContent } from '@/i18n/permissions';
import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Key, Loader2, Clock } from 'lucide-react';

interface ResetPasswordDialogProps {
  userId: string;
  userEmail: string | null;
  caseNumber?: string | null;
  onSuccess?: () => void;
  children?: React.ReactNode;
}

export default function ResetPasswordDialog({ userId, userEmail, caseNumber, onSuccess, children }: ResetPasswordDialogProps) {
  const { t } = useLanguage();
  const copy = usePermissionsContent();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmitRequest = async () => {
    if (loading) return;
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Not authenticated');
      }

      // Create a password reset request
      const { data, error } = await supabase.rpc('request_password_reset', {
        p_target_user_id: userId, p_reason: reason.trim() || null,
      });

      if (error) {
        throw error;
      }
      if (typeof data !== 'string') throw new Error('Unable to confirm the password reset request');

      toast({
        title: t('common.success'),
        description: t('customerDetail.resetRequestSubmitted'),
      });

      setOpen(false);
      setReason('');
      onSuccess?.();
    } catch (error: unknown) {
      toast({
        title: t('common.error'),
        description: getErrorMessage(error, 'Failed to submit password reset request'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (loading) return;
    setOpen(isOpen);
    if (!isOpen) {
      setReason('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {children || (
          <Button variant="outline" size="sm">
            <Key className="h-4 w-4 mr-2" />
            {t('customerDetail.requestPasswordReset')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            {t('customerDetail.requestPasswordReset')}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            {t('customerDetail.resetRequestDescription')} {userEmail || userId}
          </DialogDescription>
          {caseNumber && <p className="text-sm text-muted-foreground">{t('admin.caseNumber')}: {caseNumber}</p>}
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="reason">{t('customerDetail.resetReason')}</Label>
            <Textarea
              id="reason" maxLength={2000} disabled={loading}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('customerDetail.resetReasonPlaceholder')}
              rows={2}
            />
          </div>

          <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
            <p className="text-xs text-yellow-600 dark:text-yellow-400">
              {copy.requestNote}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmitRequest} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('customerDetail.submitRequest')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

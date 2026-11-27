import { useState, type ReactNode } from 'react';
import { Check, Loader2, MessageSquareText, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { getErrorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/utils';

export type TransactionStatus = 'pending' | 'processing' | 'approved' | 'rejected';
const statuses: TransactionStatus[] = ['pending', 'processing', 'approved', 'rejected'];
interface ReviewTransaction {
  id: string;
  customer_id: string;
  type: 'deposit' | 'withdraw';
  amount: number;
  currency: string;
  status: string;
}
const formatAmount = (transaction: ReviewTransaction) => new Intl.NumberFormat(undefined, {
  style: 'currency', currency: transaction.currency || 'USD',
}).format(transaction.amount);
const defaultMessage = (transaction: ReviewTransaction, status: TransactionStatus) => {
  const request = transaction.type === 'withdraw' ? 'withdrawal' : 'deposit';
  if (status === 'approved') return `Your ${request} request for ${formatAmount(transaction)} has been approved.`;
  if (status === 'rejected') return `Your ${request} request for ${formatAmount(transaction)} was not approved. Please contact your case specialist if you need more information.`;
  return `Your ${request} request for ${formatAmount(transaction)} is ${status === 'pending' ? 'pending review' : 'being processed'}.`;
};

export const TransactionReviewDialog = ({ transaction, action, onReviewed, children }: {
  transaction: ReviewTransaction;
  action?: 'approved' | 'rejected';
  onReviewed?: () => void | Promise<void>;
  children: ReactNode;
}) => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [expectedStatus, setExpectedStatus] = useState(transaction.status as TransactionStatus);
  const [selectedStatus, setSelectedStatus] = useState<TransactionStatus>(action || transaction.status as TransactionStatus);
  const [submitting, setSubmitting] = useState(false);
  const status = action || selectedStatus;
  const isApproval = status === 'approved';
  const isRejection = status === 'rejected';
  const changeOpen = (next: boolean) => {
    if (submitting) return;
    setOpen(next); setMessage('');
    if (next) {
      setExpectedStatus(transaction.status as TransactionStatus);
      setSelectedStatus(action || transaction.status as TransactionStatus);
    }
  };
  const handleReview = async () => {
    if (submitting || status === expectedStatus) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('review_transaction_request', {
        p_transaction_id: transaction.id, p_status: status, p_expected_status: expectedStatus,
        p_message: message.trim() || defaultMessage(transaction, status),
      }).single<{ id: string; status: TransactionStatus }>();
      if (error) throw error;
      if (data?.id !== transaction.id || data.status !== status) throw new Error('Unable to confirm the transaction status change.');
      toast({ title: 'Transaction status updated', description: 'The status and message are now visible to the client.' });
      setOpen(false); setMessage('');
      await onReviewed?.();
    } catch (error) {
      toast({ title: 'Unable to update transaction status', description: getErrorMessage(error), variant: 'destructive' });
    } finally { setSubmitting(false); }
  };

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild>{children}</DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{action ? `${isApproval ? 'Approve' : 'Reject'} ${transaction.type} request` : 'Change transaction status'}</DialogTitle>
        <DialogDescription>{formatAmount(transaction)} will be marked as {status}. The message will appear in the client’s transaction history and notifications.</DialogDescription>
      </DialogHeader>
      {!action && <div className="space-y-2">
        <Label htmlFor={`transaction-status-${transaction.id}`}>{t('common.status')}</Label>
        <Select value={selectedStatus} onValueChange={value => setSelectedStatus(value as TransactionStatus)} disabled={submitting}>
          <SelectTrigger id={`transaction-status-${transaction.id}`}><SelectValue /></SelectTrigger>
          <SelectContent>{statuses.map(value => <SelectItem key={value} value={value}>{t(`transactions.${value}`)}</SelectItem>)}</SelectContent>
        </Select>
      </div>}
      {(expectedStatus === 'approved' || isApproval) && <p className="text-sm text-muted-foreground">
        Leaving Approved reverses its balance adjustment. Approving applies the adjustment again.
      </p>}
      <div className="space-y-2 py-2">
        <Label htmlFor={`review-message-${transaction.id}-${action || 'status'}`} className="flex items-center gap-2"><MessageSquareText className="h-4 w-4" />Message to client</Label>
        <Textarea id={`review-message-${transaction.id}-${action || 'status'}`} value={message} onChange={event => setMessage(event.target.value)}
          placeholder="Add a message about this status change…" rows={5} maxLength={2000} disabled={submitting} />
        <div className="flex justify-between text-xs text-muted-foreground"><span>If left empty, a default message will be sent.</span><span>{message.length}/2000</span></div>
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" onClick={() => changeOpen(false)} disabled={submitting}>{t('common.cancel')}</Button>
        <Button onClick={handleReview} disabled={submitting || status === expectedStatus}
          className={cn(action && (isApproval ? 'bg-green-600 text-white hover:bg-green-500' : 'bg-red-600 text-white hover:bg-red-500'))}>
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : action ? isRejection ? <X className="mr-2 h-4 w-4" /> : <Check className="mr-2 h-4 w-4" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          {action ? `Confirm ${isApproval ? 'approval' : 'rejection'}` : 'Save status'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
};

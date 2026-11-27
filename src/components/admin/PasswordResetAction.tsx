import { Key, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRolePermission } from '@/hooks/useRolePermission';
import { usePermissionsContent } from '@/i18n/permissions';
import DirectPasswordResetDialog from './DirectPasswordResetDialog';
import ResetPasswordDialog from './ResetPasswordDialog';

export default function PasswordResetAction(props: {
  userId: string; userEmail: string | null; caseNumber?: string | null; onSuccess?: () => void;
}) {
  const { mode, isLoading, error, refetch } = useRolePermission('reset_password');
  const copy = usePermissionsContent();
  if (isLoading) return <Button variant="outline" size="sm" disabled><Loader2 className="mr-2 h-4 w-4 animate-spin" />{copy.checking}</Button>;
  if (error) return <Button variant="outline" size="sm" title={copy.error} onClick={() => void refetch()}>{copy.retry}</Button>;
  if (mode === 'direct') return <DirectPasswordResetDialog {...props} />;
  if (mode === 'approval') return <ResetPasswordDialog {...props} />;
  return <Button variant="outline" size="sm" disabled><Key className="mr-2 h-4 w-4" />{copy.denied}</Button>;
}

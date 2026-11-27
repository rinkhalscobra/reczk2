import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { managedPermissionRoles, parseRolePermissions, permissionModes, type ManagedPermissionRole, type PermissionMode } from '@/lib/permissions';
import { usePermissionsContent } from '@/i18n/permissions';
import { getErrorMessage } from '@/lib/errorMessage';

export default function PermissionsSettings() {
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const { t } = useLanguage();
  const copy = usePermissionsContent();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const queryKey = ['role-permissions', user?.id];
  const [draft, setDraft] = useState<Partial<Record<ManagedPermissionRole, PermissionMode>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const query = useQuery({
    queryKey, enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from('role_permissions').select('role, permission, mode, version, updated_at')
        .retry(false).abortSignal(AbortSignal.timeout(15_000));
      if (error) throw error;
      return parseRolePermissions(data);
    },
    retry: false, refetchOnWindowFocus: false,
  });
  const changes = (query.data || []).filter(row => draft[row.role] && draft[row.role] !== row.mode)
    .map(row => ({ role: row.role, permission: row.permission, mode: draft[row.role]!, version: row.version }));
  const save = async () => {
    if (!changes.length || saving) return;
    setSaving(true); setSaveError('');
    try {
      const { data, error } = await supabase.rpc('save_role_permissions', { p_changes: changes });
      if (error) throw error;
      queryClient.setQueryData(queryKey, parseRolePermissions(data));
      setDraft({});
      toast({ title: copy.saved });
    } catch (error) { setSaveError(getErrorMessage(error)); }
    finally { setSaving(false); }
  };
  if (!isAdmin) return null;
  return <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />{copy.title}</CardTitle>
      <CardDescription>{copy.description}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-5">
      {query.isPending ? <p role="status" className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{copy.checking}</p>
        : query.isError ? <div role="alert" className="space-y-3"><p>{copy.error}</p><Button variant="outline" onClick={() => void query.refetch()}>{copy.retry}</Button></div>
        : <>
          <div className="flex flex-col justify-between gap-2 rounded-lg border bg-muted/40 p-4 sm:flex-row sm:items-center">
            <div><p className="font-medium">{t('hierarchy.superiorAdmin')}</p><p className="text-sm text-muted-foreground">{copy.fixed}</p></div>
            <span className="text-sm font-medium text-primary">{copy.direct}</span>
          </div>
          {managedPermissionRoles.map(role => {
            const row = query.data.find(row => row.role === role)!;
            return <div key={role} className="flex flex-col justify-between gap-3 rounded-lg border p-4 sm:flex-row sm:items-center">
              <div><p className="font-medium">{copy[role]}</p><Label htmlFor={`password-permission-${role}`} className="text-sm font-normal text-muted-foreground">{copy.password}</Label></div>
              <Select value={draft[role] || row.mode} disabled={saving || query.isFetching}
                onValueChange={(mode: PermissionMode) => { setDraft(current => ({ ...current, [role]: mode })); setSaveError(''); }}>
                <SelectTrigger id={`password-permission-${role}`} aria-label={`${copy[role]} ${copy.password}`} className="w-full sm:w-56"><SelectValue /></SelectTrigger>
                <SelectContent>{permissionModes.map(mode => <SelectItem key={mode} value={mode}>{copy[mode]}</SelectItem>)}</SelectContent>
              </Select>
            </div>;
          })}
          {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
          <div className="flex flex-wrap gap-3">
            <Button disabled={!changes.length || saving || query.isFetching} onClick={() => void save()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{copy.save}
            </Button>
            <Button variant="outline" disabled={saving || query.isFetching} onClick={() => {
              setDraft({}); setSaveError(''); void query.refetch();
            }}>{copy.reload}</Button>
          </div>
        </>}
    </CardContent>
  </Card>;
}

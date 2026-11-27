import { useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { Plus, Loader2, Eye, EyeOff } from 'lucide-react';
import { SupervisorSelector, type SupervisorOption } from './SupervisorSelector';
import { useGroupDetailsContent } from '@/i18n/groupDetails';
import { AgentCaseCodeInput } from './AgentCaseCodeInput';
import { getErrorMessage } from '@/lib/errorMessage';

interface Group {
  id: string;
  name: string;
}

interface CreateUserDialogProps {
  groups: Group[];
  roleType: 'agent' | 'supervisor' | 'group_admin';
  supervisors?: SupervisorOption[];
  onSuccess: () => void;
}

export const CreateUserDialog = ({ groups, roleType, supervisors = [], onSuccess }: CreateUserDialogProps) => {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [caseCode, setCaseCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [groupId, setGroupId] = useState('');
  const [supervisorId, setSupervisorId] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { t } = useLanguage();
  const copy = useGroupDetailsContent();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !email.trim() || !groupId || password.length < 8 || (roleType === 'agent' && !supervisorId)) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          email: email.trim(),
          password,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          username: username.trim() || null,
          phone: roleType === 'agent' ? null : phone.trim() || null,
          agentCaseCode: roleType === 'agent' ? caseCode.trim() || undefined : undefined,
          role: roleType,
          groupId,
          supervisorId: roleType === 'agent' ? supervisorId : undefined,
        },
      });

      if (error) {
        if (error instanceof FunctionsHttpError) {
          const details = await error.context.clone().json().catch(() => null);
          if (typeof details?.error === 'string') throw new Error(details.error);
        }
        throw error;
      }
      if (data?.error) throw new Error(data.error);

      toast({
        title: t('common.success'),
        description: `${firstName} ${lastName}`.trim() || email,
      });

      setEmail('');
      setFirstName('');
      setLastName('');
      setUsername('');
      setPhone('');
      setCaseCode('');
      setPassword('');
      setShowPassword(false);
      setGroupId('');
      setSupervisorId('');
      setOpen(false);
      onSuccess();
    } catch (error: unknown) {
      toast({
        title: t('common.error'),
        description: getErrorMessage(error, 'Failed to create staff account'),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const roleLabel = roleType === 'group_admin' ? 'Group Admin' : roleType === 'agent' ? t('admin.agents') : t('admin.supervisors');

  return (
    <Dialog open={open} onOpenChange={next => {
      if (loading) return;
      setOpen(next);
      if (!next) { setPassword(''); setShowPassword(false); }
    }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="h-4 w-4" /> {t('common.create').toUpperCase()}
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border">
        <DialogHeader>
          <DialogTitle>{t('dialogs.createUser')} {roleLabel}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">{t('auth.firstName')}</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="John"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">{t('auth.lastName')}</Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Doe"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{t('auth.email')}</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@example.com"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="staffPassword">{t('auth.password')}</Label>
            <div className="relative">
              <Input
                id="staffPassword"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                autoComplete="new-password"
                aria-describedby="staffPasswordHint"
                aria-invalid={password.length > 0 && password.length < 8}
                className="pr-10"
                disabled={loading}
                required
              />
              <Button type="button" size="icon" variant="ghost" className="absolute right-0 top-0 h-full" disabled={loading}
                onClick={() => setShowPassword(!showPassword)} aria-label={t(showPassword ? 'passwordControl.hide' : 'passwordControl.show')}>
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <p id="staffPasswordHint" role="status" className={`text-xs ${password.length > 0 && password.length < 8 ? 'text-destructive' : 'text-muted-foreground'}`}>
              {t('customerDetail.passwordTooShort')}
            </p>
          </div>
          <div className={roleType === 'agent' ? 'grid gap-4' : 'grid grid-cols-2 gap-4'}>
            <div className="space-y-2">
              <Label htmlFor="username">{t('admin.username')}</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="johndoe"
              />
            </div>
            {roleType !== 'agent' && <div className="space-y-2">
              <Label htmlFor="phone">{t('common.phone')} ({copy.optional})</Label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1234567890"
              />
            </div>}
          </div>
          {roleType === 'agent' && <AgentCaseCodeInput value={caseCode} onChange={setCaseCode} disabled={loading} />}
          <div className="space-y-2">
            <Label>{t('dialogs.assignToGroup')}</Label>
            <Select value={groupId} onValueChange={value => { setGroupId(value); setSupervisorId(''); }} required>
              <SelectTrigger>
                <SelectValue placeholder={t('dialogs.selectGroup')} />
              </SelectTrigger>
              <SelectContent>
                {groups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {roleType === 'agent' && <div className="space-y-2">
            <Label>{t('hierarchy.assignedSupervisor')}</Label>
            <SupervisorSelector value={supervisorId} groupId={groupId} supervisors={supervisors} onChange={setSupervisorId} disabled={loading} />
          </div>}
          <Button type="submit" disabled={loading || !email.trim() || !groupId || password.length < 8 || (roleType === 'agent' && !supervisorId)} className="w-full">
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {t('common.create')} {roleLabel}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

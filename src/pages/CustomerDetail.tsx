import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import Navigation from '@/components/Navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { 
  ArrowLeft, User, FileText, Bell, Key, Plus, Pencil,
  RefreshCw, Loader2, Check, X, ChevronDown, ChevronUp, Clock, MessageCircle, Trash2,
  AlertCircle, CheckCircle, AlertTriangle, Info, Landmark, BadgeDollarSign, FolderKanban, Bitcoin, Coins, Wallet, Eye, EyeOff
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import AdjustBalanceDialog from '@/components/admin/AdjustBalanceDialog';
import CaseTimelineEditor from '@/components/admin/CaseTimelineEditor';
import { AgentChatWindow } from '@/components/chat/AgentChatWindow';
import CreateNotificationDialog from '@/components/admin/CreateNotificationDialog';
import { CasePhaseUpdater } from '@/components/admin/CasePhaseUpdater';
import PasswordResetAction from '@/components/admin/PasswordResetAction';
import { ClientPaymentDetailsCard } from '@/components/admin/ClientPaymentDetailsCard';
import { useUserRole } from '@/hooks/useUserRole';
import { formatDistanceToNow } from 'date-fns';
import { formatCurrency } from '@/lib/utils';
import { TransactionPaymentDetailsDialog } from '@/components/admin/TransactionPaymentDetailsDialog';
import { TransactionReviewDialog } from '@/components/admin/TransactionReviewDialog';
import type { Json } from '@/integrations/supabase/types';
import { BALANCE_CURRENCIES, balanceForCurrency } from '@/lib/balances';
import { RecoveryFundsPanel } from '@/components/dashboard/RecoveryFundsPanel';
import AdjustCryptoBalanceDialog from '@/components/admin/AdjustCryptoBalanceDialog';
import DeleteCryptoBalanceDialog from '@/components/admin/DeleteCryptoBalanceDialog';
import { formatCryptoQuantity, type CryptoBalance, type CryptoBalanceAdjustment } from '@/lib/cryptoBalances';
import { KycPanel } from '@/components/kyc/KycPanel';
import { getErrorMessage } from '@/lib/errorMessage';

import { AgentCaseCodeFor } from '@/components/admin/AgentCaseCode';
import { ChangeClientCaseNumberDialog } from '@/components/admin/ChangeClientCaseNumberDialog';
import { useGroupDetailsContent } from '@/i18n/groupDetails';

interface CustomerProfile {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  phone: string | null;
  birthdate: string | null;
  status: string | null;
  case_number: string | null;
  subscription: string | null;
  preferred_currency: string | null;
  created_at: string | null;
  assigned_to: string | null;
  group_id: string | null;
  platform: string | null;
  case_phase: string | null;
  recovery_search_started_at: string | null;
  recovery_search_duration_minutes: number;
  recovery_search_scope: string;
  recovery_result_type: string | null;
  recovery_result_details: Json;
  recovery_completed_at: string | null;
}

interface AgentProfile {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  group_id: string | null;
  platform: string | null;
}

interface CustomerGroup {
  id: string;
  name: string;
  platform: string;
}

interface Note {
  id: string;
  content: string;
  created_by: string | null;
  created_at: string | null;
}

interface TransactionRequest {
  id: string;
  customer_id: string;
  type: 'deposit' | 'withdraw';
  amount: number;
  currency: string;
  method: string;
  status: string;
  processed_by: string | null;
  processed_at: string | null;
  created_at: string | null;
  payment_details: Json | null;
  payment_instructions_snapshot: Json | null;
  review_message: string | null;
}

interface UserSession {
  id: string;
  login_time: string | null;
  login_ip: string | null;
  is_active: boolean | null;
}

type UserStatus = 'active' | 'inactive' | 'suspended' | 'invalid_language';

interface CustomerBalance {
  id: string;
  balance: number;
  currency: string;
  visible_on_dashboard: boolean;
}

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string | null;
  is_read: boolean;
  created_at: string | null;
}

const CUSTOMER_TABS = ['profile', 'balances', 'case', 'messages', 'funds', 'transactions', 'payment-details', 'notifications', 'access'];

const CustomerDetailSession = (): JSX.Element => {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { isAdmin } = useUserRole();
  const userId = user?.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab = requestedTab && CUSTOMER_TABS.includes(requestedTab) ? requestedTab : 'profile';
  const requestId = useRef(0);
  const balanceRequestId = useRef(0);

  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [isAgentProfile, setIsAgentProfile] = useState(false);
  const caseCopy = useGroupDetailsContent();
  const [notes, setNotes] = useState<Note[]>([]);
  const [transactions, setTransactions] = useState<TransactionRequest[]>([]);
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [customerBalances, setCustomerBalances] = useState<CustomerBalance[]>([]);
  const [cryptoBalances, setCryptoBalances] = useState<CryptoBalance[]>([]);
  const [cryptoAdjustments, setCryptoAdjustments] = useState<CryptoBalanceAdjustment[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [updatingBalanceVisibility, setUpdatingBalanceVisibility] = useState<string | null>(null);
  const [userInfoOpen, setUserInfoOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(true);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [updatingGroup, setUpdatingGroup] = useState(false);
  
  // Edit form state
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editBirthdate, setEditBirthdate] = useState('');
  const [editCaseNumber, setEditCaseNumber] = useState('');
  const [editCurrency, setEditCurrency] = useState('');
  const [editSubscription, setEditSubscription] = useState('');

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/');
    }
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (customerId && userId) {
      fetchCustomerData();

      // Set up real-time subscriptions
      const profileChannel = supabase
        .channel(`profile-${customerId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${customerId}` },
          (payload) => {
            if (payload.new) {
              setCustomer(payload.new as CustomerProfile);
            }
          }
        )
        .subscribe();

      const transactionsChannel = supabase
        .channel(`transactions-${customerId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'transaction_requests', filter: `customer_id=eq.${customerId}` },
          () => {
            // Refetch transactions on any change
            supabase
              .from('transaction_requests')
              .select('*')
              .eq('customer_id', customerId)
              .order('created_at', { ascending: false })
              .then(({ data }) => {
                if (data) setTransactions(data);
              });
          }
        )
        .subscribe();

      const balanceChannel = supabase
        .channel(`balance-${customerId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'customer_balances', filter: `customer_id=eq.${customerId}` },
          (payload) => {
            if (payload.eventType === 'DELETE') {
              const removed = payload.old as Pick<CustomerBalance, 'id'>;
              setCustomerBalances((current) => current.filter((balance) => balance.id !== removed.id));
              return;
            }

            const changed = payload.new as CustomerBalance;
            setCustomerBalances((current) => {
              const exists = current.some((balance) => balance.id === changed.id);
              return exists
                ? current.map((balance) => balance.id === changed.id ? changed : balance)
                : [...current, changed].sort((a, b) => a.currency.localeCompare(b.currency));
            });
          }
        )
        .subscribe();

      const cryptoBalanceChannel = supabase
        .channel(`crypto-balance-${customerId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'portfolio_items', filter: `user_id=eq.${customerId}` },
          (payload) => {
            if (payload.eventType === 'DELETE') {
              const removed = payload.old as Pick<CryptoBalance, 'id'>;
              setCryptoBalances((current) => current.filter((balance) => balance.id !== removed.id));
              return;
            }

            const changed = payload.new as CryptoBalance;
            setCryptoBalances((current) => {
              const exists = current.some((balance) => balance.id === changed.id);
              return exists
                ? current.map((balance) => balance.id === changed.id ? changed : balance)
                : [...current, changed].sort((a, b) => a.crypto_symbol.localeCompare(b.crypto_symbol));
            });
          },
        )
        .subscribe();

      const cryptoAdjustmentsChannel = supabase
        .channel(`crypto-adjustments-${customerId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'crypto_balance_adjustments', filter: `customer_id=eq.${customerId}` },
          (payload) => {
            setCryptoAdjustments((current) => [payload.new as CryptoBalanceAdjustment, ...current].slice(0, 5));
          },
        )
        .subscribe();

      const notificationsChannel = supabase
        .channel(`notifications-${customerId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${customerId}` },
          () => {
            supabase
              .from('notifications')
              .select('*')
              .eq('user_id', customerId)
              .order('created_at', { ascending: false })
              .then(({ data }) => {
                if (data) setNotifications(data);
              });
          }
        )
        .subscribe();

      const notesChannel = supabase
        .channel(`notes-${customerId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'customer_notes', filter: `customer_id=eq.${customerId}` },
          () => {
            supabase
              .from('customer_notes')
              .select('*')
              .eq('customer_id', customerId)
              .order('created_at', { ascending: false })
              .then(({ data }) => {
                if (data) setNotes(data);
              });
          }
        )
        .subscribe();

      const invalidateRequests = () => {
        requestId.current++;
        balanceRequestId.current++;
      };
      return () => {
        invalidateRequests();
        supabase.removeChannel(profileChannel);
        supabase.removeChannel(transactionsChannel);
        supabase.removeChannel(balanceChannel);
        supabase.removeChannel(cryptoBalanceChannel);
        supabase.removeChannel(cryptoAdjustmentsChannel);
        supabase.removeChannel(notificationsChannel);
        supabase.removeChannel(notesChannel);
      };
    }
  }, [customerId, userId, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchCustomerData = async () => {
    if (!customerId) return;
    const currentRequest = ++requestId.current;

    try {
      // Fetch agents (users with agent role)
      const { data: agentRoles, error: agentRolesError } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'agent');
      if (agentRolesError) throw agentRolesError;
      
      const agentIds = agentRoles?.map(r => r.user_id) || [];
      if (currentRequest !== requestId.current) return;
      
      const [profileRes, notesRes, transactionsRes, sessionsRes, agentsRes, balanceRes, cryptoBalanceRes, cryptoAdjustmentsRes, notificationsRes, groupsRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', customerId).single(),
        supabase.from('customer_notes').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }),
        supabase.from('transaction_requests').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }),
        supabase.rpc('get_user_sessions_for_staff', { target_user_id: customerId }),
        agentIds.length > 0 
          ? supabase.from('profiles').select('id, email, first_name, last_name, group_id, platform').in('id', agentIds)
          : Promise.resolve({ data: [], error: null }),
        supabase.from('customer_balances').select('*').eq('customer_id', customerId).order('currency'),
        supabase.from('portfolio_items').select('id, crypto_id, crypto_name, crypto_symbol, quantity, purchase_price, visible_on_dashboard').eq('user_id', customerId).order('crypto_symbol'),
        supabase.from('crypto_balance_adjustments').select('id, adjustment_type, amount, balance_after, crypto_id, crypto_symbol, reason, created_at').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(5),
        supabase.from('notifications').select('*').eq('user_id', customerId).order('created_at', { ascending: false }),
        isAdmin
          ? supabase.from('groups').select('id, name, platform').order('name')
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (currentRequest !== requestId.current) return;
      if (profileRes.error) throw profileRes.error;
      if (agentsRes.error) throw agentsRes.error;
      if (groupsRes.error) throw groupsRes.error;
      setCustomer(profileRes.data);
      setIsAgentProfile(agentIds.includes(customerId));
      setNotes(notesRes.data || []);
      setTransactions(transactionsRes.data || []);
      setSessions(((sessionsRes.data || []) as UserSession[]).sort((left, right) => {
        const leftTime = left.login_time ? new Date(left.login_time).getTime() : 0;
        const rightTime = right.login_time ? new Date(right.login_time).getTime() : 0;
        return rightTime - leftTime;
      }));
      setAgents((agentsRes.data || []).filter(agent =>
        profileRes.data.group_id && agent.group_id === profileRes.data.group_id && agent.platform === profileRes.data.platform
      ));
      setGroups((groupsRes.data || []).filter(group => group.platform === profileRes.data.platform));
      setCustomerBalances(balanceRes.data || []);
      setCryptoBalances(cryptoBalanceRes.data || []);
      setCryptoAdjustments((cryptoAdjustmentsRes.data || []) as CryptoBalanceAdjustment[]);
      setNotifications(notificationsRes.data || []);
    } catch (error: unknown) {
      if (currentRequest === requestId.current) {
        toast({ title: t('common.error'), description: getErrorMessage(error), variant: "destructive" });
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  };

  // Refresh only the ledgers after an adjustment. Keep the tabs, dialogs and
  // unrelated forms mounted, even if a background read fails.
  const fetchBalanceData = async () => {
    if (!customerId) return;
    const currentRequest = ++balanceRequestId.current;
    try {
      const signal = AbortSignal.timeout(15_000);
      const [fiat, crypto, adjustments] = await Promise.all([
        supabase.from('customer_balances').select('*').eq('customer_id', customerId).order('currency').retry(false).abortSignal(signal),
        supabase.from('portfolio_items').select('id, crypto_id, crypto_name, crypto_symbol, quantity, purchase_price, visible_on_dashboard').eq('user_id', customerId).order('crypto_symbol').retry(false).abortSignal(signal),
        supabase.from('crypto_balance_adjustments').select('id, adjustment_type, amount, balance_after, crypto_id, crypto_symbol, reason, created_at').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(5).retry(false).abortSignal(signal),
      ]);
      if (currentRequest !== balanceRequestId.current) return;
      if (fiat.data) setCustomerBalances(fiat.data);
      if (crypto.data) setCryptoBalances(crypto.data);
      if (adjustments.data) setCryptoAdjustments(adjustments.data as CryptoBalanceAdjustment[]);
      const error = fiat.error || crypto.error || adjustments.error;
      if (error) throw error;
    } catch (error) {
      if (currentRequest === balanceRequestId.current) {
        toast({ title: 'Balance saved; could not refresh the latest balances', description: getErrorMessage(error), variant: 'destructive' });
      }
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !customerId) return;
    setAddingNote(true);

    try {
      const { error } = await supabase.from('customer_notes').insert({
        customer_id: customerId,
        content: newNote.trim(),
        created_by: user?.id
      });
      if (error) throw error;
      toast({ title: t('customerDetail.noteAdded') });
      setNewNote('');
      fetchCustomerData();
    } catch (error: unknown) {
      toast({ title: t('common.error'), description: getErrorMessage(error), variant: "destructive" });
    } finally {
      setAddingNote(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!customerId) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ status: newStatus as UserStatus })
        .eq('id', customerId);
      if (error) throw error;
      toast({ title: t('admin.statusUpdated') });
      fetchCustomerData();
    } catch (error: unknown) {
      toast({ title: t('common.error'), description: getErrorMessage(error), variant: "destructive" });
    }
  };

  const handleGroupChange = async (groupId: string) => {
    if (!customerId || !isAdmin || updatingGroup) return;
    const nextGroupId = groupId === 'no-group' ? null : groupId;
    if (nextGroupId === customer?.group_id) return;
    setUpdatingGroup(true);
    try {
      const { error } = await supabase.rpc('set_customer_group', {
        p_customer_id: customerId,
        p_group_id: nextGroupId,
      });
      if (error) throw error;
      toast({ title: t('customerDetail.groupUpdated') });
      await fetchCustomerData();
    } catch (error: unknown) {
      toast({ title: t('common.error'), description: getErrorMessage(error), variant: 'destructive' });
    } finally {
      setUpdatingGroup(false);
    }
  };

  const handleAgentAssign = async (agentId: string) => {
    if (!customerId) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ assigned_to: agentId === 'unassigned' ? null : agentId })
        .eq('id', customerId)
        .select('id')
        .single();
      if (error) throw error;
      toast({ title: t('customerDetail.agentAssigned') });
      fetchCustomerData();
    } catch (error: unknown) {
      toast({ title: t('common.error'), description: getErrorMessage(error), variant: "destructive" });
    }
  };

  const startEditingProfile = () => {
    if (customer) {
      setEditFirstName(customer.first_name || '');
      setEditLastName(customer.last_name || '');
      setEditPhone(customer.phone || '');
      setEditBirthdate(customer.birthdate || '');
      setEditCaseNumber(customer.case_number || '');
      setEditCurrency(customer.preferred_currency || 'EUR');
      setEditSubscription(customer.subscription || 'BASIC');
    }
    setEditingProfile(true);
  };

  const handleSaveProfile = async () => {
    if (!customerId) return;
    setSavingProfile(true);
    try {
      if (!isAgentProfile && !editCaseNumber.trim()) throw new Error(t('auth.caseNumberRequired'));
      const { error } = await supabase
        .from('profiles')
        .update({
          first_name: editFirstName.trim() || null,
          last_name: editLastName.trim() || null,
          phone: editPhone.trim() || null,
          birthdate: editBirthdate || null,
          ...(!isAgentProfile ? { case_number: editCaseNumber.trim() } : {}),
          preferred_currency: editCurrency,
          ...(editSubscription !== (customer?.subscription || 'BASIC') ? { subscription: editSubscription } : {}),
        })
        .eq('id', customerId)
        .select('id')
        .single();
      if (error) throw error;
      toast({ title: t('common.success'), description: t('customerDetail.profileUpdated') });
      setEditingProfile(false);
      await fetchCustomerData();
    } catch (error: unknown) {
      toast({ title: t('common.error'), description: getErrorMessage(error), variant: "destructive" });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleDeleteNotification = async (notificationId: string) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', notificationId);
      if (error) throw error;
      toast({ title: t('notification.deleted') });
      fetchCustomerData();
    } catch (error: unknown) {
      toast({ title: t('common.error'), description: getErrorMessage(error), variant: "destructive" });
    }
  };

  const handleBalanceVisibilityChange = async (
    balanceKind: 'fiat' | 'crypto',
    balanceId: string,
    visible: boolean,
  ) => {
    if (!customerId) return;
    setUpdatingBalanceVisibility(balanceId);

    try {
      const { error } = await supabase.rpc('set_balance_dashboard_visibility', {
        p_balance_id: balanceId,
        p_balance_kind: balanceKind,
        p_customer_id: customerId,
        p_visible: visible,
      });
      if (error) throw error;

      if (balanceKind === 'fiat') {
        setCustomerBalances((current) => current.map((balance) => (
          balance.id === balanceId ? { ...balance, visible_on_dashboard: visible } : balance
        )));
      } else {
        setCryptoBalances((current) => current.map((balance) => (
          balance.id === balanceId ? { ...balance, visible_on_dashboard: visible } : balance
        )));
      }

      toast({
        title: visible ? 'Balance shown on dashboard' : 'Balance hidden from dashboard',
        description: `The client dashboard visibility was updated for this ${balanceKind} balance.`,
      });
    } catch (error: unknown) {
      toast({
        title: 'Could not update balance visibility',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setUpdatingBalanceVisibility(null);
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'success': return <CheckCircle className="h-5 w-5 text-green-400" />;
      case 'warning': return <AlertTriangle className="h-5 w-5 text-yellow-400" />;
      case 'error': return <AlertCircle className="h-5 w-5 text-red-400" />;
      default: return <Info className="h-5 w-5 text-neutral-300" />;
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="min-h-screen bg-background pt-16 sm:pt-28">
        <Navigation />
        <main className="container mx-auto px-4 py-8">
          <p className="text-muted-foreground text-center">{t('customerDetail.customerNotFound')}</p>
        </main>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    active: 'bg-green-500/20 text-green-400',
    inactive: 'bg-gray-500/20 text-gray-400',
    invalid_language: 'bg-amber-500/20 text-amber-400',
    suspended: 'bg-red-500/20 text-red-400',
    pending: 'bg-yellow-500/20 text-yellow-400',
    approved: 'bg-green-500/20 text-green-400',
    rejected: 'bg-red-500/20 text-red-400',
    processing: 'bg-white/10 text-neutral-300'
  };

  return (
    <div className="min-h-screen bg-background pt-16 sm:pt-28">
      <Navigation />
      
      <main className="container mx-auto px-4 py-8">
        {/* Back Button */}
        <Button 
          variant="outline" 
          size="sm" 
          className="mb-6"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-4 w-4 mr-2" /> {t('customerDetail.backToDashboard')}
        </Button>

        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Customer workspace</p>
          <h1 className="mt-1 text-2xl font-bold">{t('customerDetail.title')}</h1>
        </div>

        <Tabs value={activeTab} onValueChange={(tab) => setSearchParams((current) => {
          current.set('tab', tab);
          return current;
        }, { replace: true })} className="grid w-full items-start gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="min-w-0 lg:sticky lg:top-32">
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className="border-b border-border p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
                    <User className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">{customer.first_name} {customer.last_name}</p>
                    <p className="truncate text-xs text-muted-foreground">{customer.email}</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs lg:grid-cols-1">
                  <div className="rounded-md bg-secondary/40 px-3 py-2">
                    <span className="text-muted-foreground">{isAgentProfile ? caseCopy.agentCaseCode : t('admin.caseNumber')} </span>
                    <span className="font-medium text-foreground">{isAgentProfile ? <AgentCaseCodeFor agentId={customer.id} /> : customer.case_number || 'Not assigned'}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-md bg-secondary/40 px-3 py-2">
                    <span className="text-muted-foreground">Plan</span>
                    <Badge variant="outline">{customer.subscription || 'BASIC'}</Badge>
                  </div>
                </div>
              </div>

              <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-none bg-transparent p-2 lg:flex lg:flex-col lg:items-stretch">
                <TabsTrigger value="profile" className="w-full justify-start whitespace-normal px-3 py-2.5 text-left data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  <User className="mr-2 h-4 w-4 shrink-0" /> {t('customerDetail.profile')}
                </TabsTrigger>
                <TabsTrigger value="balances" className="w-full justify-start whitespace-normal px-3 py-2.5 text-left data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  <Wallet className="mr-2 h-4 w-4 shrink-0" /> Balances
                </TabsTrigger>
                <TabsTrigger value="case" className="w-full justify-start whitespace-normal px-3 py-2.5 text-left data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  <FolderKanban className="mr-2 h-4 w-4 shrink-0" /> Case Management
                </TabsTrigger>
                <TabsTrigger value="messages" className="w-full justify-start whitespace-normal px-3 py-2.5 text-left data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  <MessageCircle className="mr-2 h-4 w-4 shrink-0" /> {t('nav.messages')}
                </TabsTrigger>
                <TabsTrigger value="funds" className="w-full justify-start whitespace-normal px-3 py-2.5 text-left data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  <BadgeDollarSign className="mr-2 h-4 w-4 shrink-0" /> Located Funds
                </TabsTrigger>
                <TabsTrigger value="transactions" className="w-full justify-start whitespace-normal px-3 py-2.5 text-left data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  <FileText className="mr-2 h-4 w-4 shrink-0" /> {t('customerDetail.transactionRequests')}
                </TabsTrigger>
                <TabsTrigger value="payment-details" className="w-full justify-start whitespace-normal px-3 py-2.5 text-left data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  <Landmark className="mr-2 h-4 w-4 shrink-0" /> Payment Details
                </TabsTrigger>
                <TabsTrigger value="notifications" className="w-full justify-start whitespace-normal px-3 py-2.5 text-left data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  <Bell className="mr-2 h-4 w-4 shrink-0" /> {t('common.notifications')}
                </TabsTrigger>
                <TabsTrigger value="access" className="w-full justify-start whitespace-normal px-3 py-2.5 text-left data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  <Key className="mr-2 h-4 w-4 shrink-0" /> {t('customerDetail.userAccess')}
                </TabsTrigger>
              </TabsList>
            </div>
          </aside>

          <div className="min-w-0">

          <TabsContent value="balances" className="space-y-6">
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Landmark className="h-4 w-4 text-primary" /> Fiat balances
                </CardTitle>
                <p className="text-xs text-muted-foreground">Choose which currencies appear in the client's balance cards.</p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {BALANCE_CURRENCIES.map((currency) => {
                    const balanceRecord = customerBalances.find((balance) => balance.currency.toUpperCase() === currency);
                    const currentBalance = balanceForCurrency(customerBalances, currency);
                    const isVisible = balanceRecord?.visible_on_dashboard !== false;
                    return (
                      <div key={currency} className="rounded-lg border border-border bg-background/40 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="mb-1 text-xs font-medium text-muted-foreground">{currency}</p>
                            <p className="font-bold text-primary">{formatCurrency(currentBalance, currency)}</p>
                          </div>
                          <AdjustBalanceDialog
                            customerId={customerId!}
                            currentBalance={currentBalance}
                            currency={currency}
                            onSuccess={(balance) => {
                              setCustomerBalances((current) => current.map((item) => item.currency.toUpperCase() === currency ? { ...item, balance } : item));
                              void fetchBalanceData();
                            }}
                          >
                            <Button size="sm" variant="outline">
                              <Pencil className="mr-1.5 h-3.5 w-3.5" /> {t('customerDetail.adjust')}
                            </Button>
                          </AdjustBalanceDialog>
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            {isVisible ? <Eye className="h-3.5 w-3.5 text-success" /> : <EyeOff className="h-3.5 w-3.5" />}
                            {isVisible ? 'Shown on dashboard' : 'Hidden from dashboard'}
                          </span>
                          <Switch
                            checked={isVisible}
                            disabled={!balanceRecord || updatingBalanceVisibility === balanceRecord.id}
                            onCheckedChange={(checked) => balanceRecord && void handleBalanceVisibilityChange('fiat', balanceRecord.id, checked)}
                            aria-label={`${isVisible ? 'Hide' : 'Show'} ${currency} balance on client dashboard`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Crypto holdings use the same canonical ledger as deposits and withdrawals. */}
            <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Coins className="h-4 w-4 text-primary" /> Crypto balances
                </CardTitle>
                <p className="mt-1.5 text-xs text-muted-foreground">Add BTC, Ethereum, or USDT, then choose which assets the client sees.</p>
              </div>
              <AdjustCryptoBalanceDialog
                customerId={customerId!}
                balances={cryptoBalances}
                onSuccess={fetchBalanceData}
              >
                <Button size="sm">
                  <Bitcoin className="mr-2 h-4 w-4" /> Add or adjust crypto
                </Button>
              </AdjustCryptoBalanceDialog>
            </CardHeader>
            <CardContent className="space-y-4">
              {cryptoBalances.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  No crypto balance has been added for this customer.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {cryptoBalances.map((balance) => (
                    <div key={balance.id} className="rounded-lg border border-border bg-background/40 p-4">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-muted-foreground">{balance.crypto_name}</span>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline">{balance.crypto_symbol.toUpperCase()}</Badge>
                          <DeleteCryptoBalanceDialog
                            customerId={customerId!}
                            balance={balance}
                            onSuccess={fetchBalanceData}
                          />
                        </div>
                      </div>
                      <p className="font-bold text-primary">
                        {formatCryptoQuantity(Number(balance.quantity), balance.crypto_symbol)}
                      </p>
                      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {balance.visible_on_dashboard !== false ? <Eye className="h-3.5 w-3.5 text-success" /> : <EyeOff className="h-3.5 w-3.5" />}
                          {balance.visible_on_dashboard !== false ? 'Shown on dashboard' : 'Hidden from dashboard'}
                        </span>
                        <Switch
                          checked={balance.visible_on_dashboard !== false}
                          disabled={updatingBalanceVisibility === balance.id}
                          onCheckedChange={(checked) => void handleBalanceVisibilityChange('crypto', balance.id, checked)}
                          aria-label={`${balance.visible_on_dashboard !== false ? 'Hide' : 'Show'} ${balance.crypto_symbol.toUpperCase()} balance on client dashboard`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {cryptoAdjustments.length > 0 && (
                <div className="border-t border-border pt-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent manual adjustments</p>
                  <div className="space-y-2">
                    {cryptoAdjustments.map((adjustment) => (
                      <div key={adjustment.id} className="flex flex-col justify-between gap-1 rounded-md bg-secondary/35 px-3 py-2 text-sm sm:flex-row sm:items-center">
                        <div>
                          <span className={adjustment.adjustment_type === 'credit' ? 'font-medium text-success' : 'font-medium text-destructive'}>
                            {adjustment.adjustment_type === 'credit' ? '+' : '-'}{formatCryptoQuantity(Number(adjustment.amount), adjustment.crypto_symbol)}
                          </span>
                          {adjustment.reason && <span className="ml-2 text-muted-foreground">— {adjustment.reason}</span>}
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(adjustment.created_at), { addSuffix: true })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
            </Card>
          </TabsContent>

          {/* Case Management Tab */}
          <TabsContent value="case" className="space-y-6">
            <CasePhaseUpdater
              customerId={customerId!}
              currentPhase={customer.case_phase}
              searchStartedAt={customer.recovery_search_started_at}
              searchDurationMinutes={customer.recovery_search_duration_minutes}
              searchScope={customer.recovery_search_scope}
              resultType={customer.recovery_result_type}
              resultDetails={customer.recovery_result_details}
              onUpdate={fetchCustomerData}
            />
            <CaseTimelineEditor customerId={customerId!} caseNumber={customer.case_number} />
          </TabsContent>

          {/* Messages Tab */}
          <TabsContent value="messages">
            <AgentChatWindow 
              customerId={customerId!}
              customerName={`${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Customer'}
              className="max-w-2xl"
            />
          </TabsContent>

          {/* Profile Tab */}
          <TabsContent value="profile">
            <div className="grid md:grid-cols-2 gap-6">
              {/* User Information */}
              <Collapsible open={userInfoOpen} onOpenChange={setUserInfoOpen}>
                <Card className="bg-card border-border">
                  <CollapsibleTrigger asChild>
                    <CardHeader className="border-b border-border cursor-pointer flex-row items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <ChevronDown className={`h-4 w-4 transition-transform ${userInfoOpen ? '' : '-rotate-90'}`} />
                        {t('customerDetail.userInformation')}
                      </CardTitle>
                      {!editingProfile ? (
                        <Button size="icon" variant="ghost" aria-label={`${t('common.edit')} ${t('customerDetail.profile')}`} onClick={(e) => { e.stopPropagation(); startEditingProfile(); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      ) : (
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" aria-label={t('common.cancel')} onClick={(e) => { e.stopPropagation(); setEditingProfile(false); }} disabled={savingProfile}>
                            <X className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" aria-label={t('common.save')} className="text-primary" onClick={(e) => { e.stopPropagation(); handleSaveProfile(); }} disabled={savingProfile}>
                            {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          </Button>
                        </div>
                      )}
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="p-4 space-y-3">
                      {isAgentProfile && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 py-2">
                        <span className="text-muted-foreground">{caseCopy.agentCaseCode}:</span>
                        <AgentCaseCodeFor agentId={customer.id} />
                      </div>}
                      {isAdmin && (
                        <div className="space-y-2 border-b border-border/50 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">{t('admin.group')}:</span>
                            <Select
                              value={customer.group_id || 'no-group'}
                              onValueChange={handleGroupChange}
                              disabled={updatingGroup || savingProfile}
                            >
                              <SelectTrigger className="h-8 w-44 text-xs" aria-label={t('admin.group')}>
                                <SelectValue placeholder={t('customerDetail.noGroup')} />
                              </SelectTrigger>
                              <SelectContent className="bg-popover">
                                <SelectItem value="no-group">{t('customerDetail.noGroup')}</SelectItem>
                                {groups.map(group => (
                                  <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          {customer.assigned_to && (
                            <p className="text-xs text-muted-foreground">{t('customerDetail.groupChangeHint')}</p>
                          )}
                        </div>
                      )}
                      {editingProfile ? (
                        <>
                          <div className="flex justify-between items-center py-2 border-b border-border/50">
                            <span className="text-muted-foreground">{t('customerDetail.firstName')}:</span>
                            <Input 
                              value={editFirstName} 
                              onChange={(e) => setEditFirstName(e.target.value)}
                              className="w-40 h-8 text-sm"
                            />
                          </div>
                          <div className="flex justify-between items-center py-2 border-b border-border/50">
                            <span className="text-muted-foreground">{t('customerDetail.lastName')}:</span>
                            <Input 
                              value={editLastName} 
                              onChange={(e) => setEditLastName(e.target.value)}
                              className="w-40 h-8 text-sm"
                            />
                          </div>
                          <div className="flex justify-between py-2 border-b border-border/50">
                            <span className="text-muted-foreground">{t('common.email')}:</span>
                            <span className="text-muted-foreground text-sm">{customer.email || '-'}</span>
                          </div>
                          <div className="flex justify-between items-center py-2 border-b border-border/50">
                            <span className="text-muted-foreground">{t('admin.phone')}:</span>
                            <Input 
                              value={editPhone} 
                              onChange={(e) => setEditPhone(e.target.value)}
                              className="w-40 h-8 text-sm"
                            />
                          </div>
                          <div className="flex justify-between items-center py-2 border-b border-border/50">
                            <span className="text-muted-foreground">{t('admin.birthdate')}:</span>
                            <Input 
                              type="date"
                              value={editBirthdate} 
                              onChange={(e) => setEditBirthdate(e.target.value)}
                              className="w-40 h-8 text-sm"
                            />
                          </div>
                          {!isAgentProfile && <div className="flex justify-between items-center py-2 border-b border-border/50">
                            <span className="text-muted-foreground">{t('admin.caseNumber')}:</span>
                            <Input 
                              value={editCaseNumber} 
                              autoCapitalize="none" autoCorrect="off" spellCheck={false}
                              aria-label={t('admin.caseNumber')}
                              maxLength={100}
                              required
                              onChange={(e) => setEditCaseNumber(e.target.value)}
                              className="w-40 h-8 text-sm"
                            />
                          </div>}
                          <div className="flex justify-between py-2 border-b border-border/50">
                            <span className="text-muted-foreground">{t('common.status')}:</span>
                            <Select value={customer.status || 'active'} onValueChange={(v) => handleStatusChange(v)}>
                              <SelectTrigger className="w-32 h-7 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="active">{t('common.active')}</SelectItem>
                                <SelectItem value="inactive">{t('common.inactive')}</SelectItem>
                                <SelectItem value="suspended">{t('common.suspended')}</SelectItem>
                                <SelectItem value="invalid_language">{t('common.invalidLanguage')}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex justify-between items-center py-2 border-b border-border/50">
                            <span className="text-muted-foreground">{t('customerDetail.currency')}:</span>
                            <Select value={editCurrency} onValueChange={setEditCurrency}>
                              <SelectTrigger className="w-32 h-7 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="EUR">EUR</SelectItem>
                                <SelectItem value="USD">USD</SelectItem>
                                <SelectItem value="CAD">CAD</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex justify-between items-center py-2 border-b border-border/50">
                            <span className="text-muted-foreground">{t('admin.subscription')}:</span>
                            <Select value={editSubscription} onValueChange={setEditSubscription}>
                              <SelectTrigger className="w-32 h-7 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="BASIC">BASIC</SelectItem>
                                <SelectItem value="PRO">PRO</SelectItem>
                                <SelectItem value="PREMIUM">PREMIUM</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex justify-between py-2">
                            <span className="text-muted-foreground">{t('customerDetail.assignedAgent')}:</span>
                            <Select 
                              value={customer.assigned_to || 'unassigned'} 
                              onValueChange={(v) => handleAgentAssign(v)}
                              disabled={updatingGroup}
                            >
                              <SelectTrigger className="w-40 h-7 text-xs">
                                <SelectValue placeholder={t('customerDetail.unassigned')} />
                              </SelectTrigger>
                              <SelectContent className="bg-popover">
                                <SelectItem value="unassigned">{t('customerDetail.unassigned')}</SelectItem>
                                {agents.map((agent) => (
                                  <SelectItem key={agent.id} value={agent.id}>
                                    {agent.first_name} {agent.last_name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex justify-between py-2 border-b border-border/50">
                            <span className="text-muted-foreground">{t('customerDetail.firstName')}:</span>
                            <span>{customer.first_name || '-'}</span>
                          </div>
                          <div className="flex justify-between py-2 border-b border-border/50">
                            <span className="text-muted-foreground">{t('customerDetail.lastName')}:</span>
                            <span>{customer.last_name || '-'}</span>
                          </div>
                          <div className="flex justify-between py-2 border-b border-border/50">
                            <span className="text-muted-foreground">{t('common.email')}:</span>
                            <span>{customer.email || '-'}</span>
                          </div>
                          <div className="flex justify-between py-2 border-b border-border/50">
                            <span className="text-muted-foreground">{t('admin.phone')}:</span>
                            <span>{customer.phone || '-'}</span>
                          </div>
                          <div className="flex justify-between py-2 border-b border-border/50">
                            <span className="text-muted-foreground">{t('admin.birthdate')}:</span>
                            <span>{customer.birthdate || '-'}</span>
                          </div>
                          {!isAgentProfile && <div className="flex justify-between py-2 border-b border-border/50">
                            <span className="text-muted-foreground">{t('admin.caseNumber')}:</span>
                            <span className="flex items-center gap-2">{customer.case_number || '-'}
                              {customer.case_number && <ChangeClientCaseNumberDialog customerId={customer.id} customerName={`${customer.first_name || ''} ${customer.last_name || ''}`.trim() || customer.email || 'Client'} caseNumber={customer.case_number} compact
                                onSuccess={() => void fetchCustomerData()} />}
                            </span>
                          </div>}
                          <div className="flex justify-between py-2 border-b border-border/50">
                            <span className="text-muted-foreground">{t('common.status')}:</span>
                            <Select value={customer.status || 'active'} onValueChange={(v) => handleStatusChange(v)}>
                              <SelectTrigger className="w-32 h-7 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="active">{t('common.active')}</SelectItem>
                                <SelectItem value="inactive">{t('common.inactive')}</SelectItem>
                                <SelectItem value="suspended">{t('common.suspended')}</SelectItem>
                                <SelectItem value="invalid_language">{t('common.invalidLanguage')}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex justify-between py-2 border-b border-border/50">
                            <span className="text-muted-foreground">{t('customerDetail.currency')}:</span>
                            <span>{customer.preferred_currency || 'EUR'}</span>
                          </div>
                          <div className="flex justify-between py-2 border-b border-border/50">
                            <span className="text-muted-foreground">{t('admin.subscription')}:</span>
                            <span>{customer.subscription || 'BASIC'}</span>
                          </div>
                          <div className="flex justify-between py-2">
                            <span className="text-muted-foreground">{t('customerDetail.assignedAgent')}:</span>
                            <Select 
                              value={customer.assigned_to || 'unassigned'} 
                              onValueChange={(v) => handleAgentAssign(v)}
                              disabled={updatingGroup}
                            >
                              <SelectTrigger className="w-40 h-7 text-xs">
                                <SelectValue placeholder={t('customerDetail.unassigned')} />
                              </SelectTrigger>
                              <SelectContent className="bg-popover">
                                <SelectItem value="unassigned">{t('customerDetail.unassigned')}</SelectItem>
                                {agents.map((agent) => (
                                  <SelectItem key={agent.id} value={agent.id}>
                                    {agent.first_name} {agent.last_name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>

              {/* Notes */}
              <Collapsible open={notesOpen} onOpenChange={setNotesOpen}>
                <Card className="bg-card border-border">
                  <CollapsibleTrigger asChild>
                    <CardHeader className="border-b border-border cursor-pointer flex-row items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <ChevronDown className={`h-4 w-4 transition-transform ${notesOpen ? '' : '-rotate-90'}`} />
                        {t('customerDetail.notes').toUpperCase()}: <Badge variant="secondary" className="bg-purple-500/20 text-purple-400">{notes.length}</Badge>
                      </CardTitle>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); fetchCustomerData(); }}>
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="text-primary" onClick={(e) => e.stopPropagation()}>
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="p-4">
                      <div className="flex gap-2 mb-4">
                        <Textarea 
                          value={newNote} 
                          onChange={(e) => setNewNote(e.target.value)}
                          placeholder={t('customerDetail.addNoteText')}
                          className="min-h-[80px]"
                        />
                      </div>
                      <Button 
                        size="sm" 
                        onClick={handleAddNote} 
                        disabled={addingNote || !newNote.trim()}
                        className="mb-4"
                      >
                        {addingNote ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                        {t('customerDetail.addNote')}
                      </Button>
                      {notes.length === 0 ? (
                        <p className="text-muted-foreground text-sm">{t('customerDetail.noNotes')}</p>
                      ) : (
                        <div className="space-y-2 max-h-[200px] overflow-y-auto">
                          {notes.map((note) => (
                            <div key={note.id} className="p-2 bg-secondary rounded text-sm">
                              <p>{note.content}</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                {note.created_at ? new Date(note.created_at).toLocaleString() : ''}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            </div>

            <div className="mt-6">
              <KycPanel
                customerId={customerId!}
                mode="staff"
                initialFirstName={customer.first_name}
                initialLastName={customer.last_name}
              />
            </div>
          </TabsContent>

          {/* Located Funds Tab */}
          <TabsContent value="funds">
            <RecoveryFundsPanel customerId={customerId!} casePhase={customer.case_phase} editable />
          </TabsContent>

          {/* Transaction Requests Tab */}
          <TabsContent value="transactions">
            <Card className="bg-card border-border">
              <CardHeader className="border-b border-border">
                <CardTitle className="text-sm">{t('transactions.allTypes').toUpperCase()}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border">
                      <TableHead>Id</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>{t('common.status')}</TableHead>
                      <TableHead>Processed by</TableHead>
                      <TableHead>Processed time</TableHead>
                      <TableHead>Payment details</TableHead>
                      <TableHead>Client message</TableHead>
                      <TableHead className="text-right">{t('common.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">{t('customerDetail.noTransactions')}</TableCell>
                      </TableRow>
                    ) : (
                      transactions.map((tx, idx) => (
                        <TableRow key={tx.id} className="border-border">
                          <TableCell>{idx + 1}</TableCell>
                          <TableCell className="capitalize">{tx.type}</TableCell>
                          <TableCell>{new Intl.NumberFormat(undefined, { style: 'currency', currency: tx.currency || 'EUR' }).format(tx.amount)}</TableCell>
                          <TableCell className="capitalize">{tx.method.replace('_', ' ')}</TableCell>
                          <TableCell>{tx.created_at ? new Date(tx.created_at).toLocaleString() : '-'}</TableCell>
                          <TableCell>
                            <Badge className={`${statusColors[tx.status]} border-0`}>
                              {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
                            </Badge>
                          </TableCell>
                          <TableCell>{tx.processed_by || '-'}</TableCell>
                          <TableCell>{tx.processed_at ? new Date(tx.processed_at).toLocaleString() : '-'}</TableCell>
                          <TableCell>
                            <TransactionPaymentDetailsDialog
                              transactionType={tx.type}
                              method={tx.method}
                              paymentDetails={tx.payment_details}
                              instructionSnapshot={tx.payment_instructions_snapshot}
                            />
                          </TableCell>
                          <TableCell className="max-w-56">
                            <p className="line-clamp-2 text-xs text-muted-foreground" title={tx.review_message || undefined}>{tx.review_message || '-'}</p>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-1 justify-end">
                              <TransactionReviewDialog transaction={tx} onReviewed={fetchCustomerData}>
                                <Button size="sm" variant="outline">Change status</Button>
                              </TransactionReviewDialog>
                              {tx.status === 'pending' && <>
                                <TransactionReviewDialog transaction={tx} action="approved" onReviewed={fetchCustomerData}>
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-green-400" title="Approve and message client"><Check className="h-4 w-4" /></Button>
                                </TransactionReviewDialog>
                                <TransactionReviewDialog transaction={tx} action="rejected" onReviewed={fetchCustomerData}>
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400" title="Reject and message client"><X className="h-4 w-4" /></Button>
                                </TransactionReviewDialog>
                              </>}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payment-details">
            <ClientPaymentDetailsCard customerId={customerId!} />
          </TabsContent>

          {/* Notifications Tab */}
          <TabsContent value="notifications">
            <Card className="bg-card border-border">
              <CardHeader className="border-b border-border flex-row items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Bell className="h-4 w-4" /> {t('common.notifications')}
                  <Badge variant="secondary">{notifications.length}</Badge>
                </CardTitle>
                <CreateNotificationDialog 
                  userId={customerId!}
                  userName={`${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Customer'}
                  onSuccess={fetchCustomerData}
                />
              </CardHeader>
              <CardContent className="p-0">
                {notifications.length === 0 ? (
                  <div className="py-12 text-center">
                    <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">{t('customerDetail.noNotifications')}</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {notifications.map((notif) => (
                      <div key={notif.id} className="p-4 flex items-start gap-3 hover:bg-secondary/50 transition-colors">
                        <div className="flex-shrink-0 mt-0.5">
                          {getNotificationIcon(notif.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm">{notif.title}</p>
                            {!notif.is_read && (
                              <Badge variant="secondary" className="bg-primary/20 text-primary text-xs">
                                {t('notifications.unread')}
                              </Badge>
                            )}
                          </div>
                          {notif.message && (
                            <p className="text-sm text-muted-foreground mt-1">{notif.message}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-2">
                            {notif.created_at ? formatDistanceToNow(new Date(notif.created_at), { addSuffix: true }) : ''}
                          </p>
                        </div>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="flex-shrink-0 h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDeleteNotification(notif.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="access">
            <Card className="bg-card border-border">
              <CardHeader className="border-b border-border flex-row items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Key className="h-4 w-4" /> {t('customerDetail.userAccess')}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <PasswordResetAction userId={customerId!} userEmail={customer.email}
                    caseNumber={customer.case_number} onSuccess={fetchCustomerData} />
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border">
                      <TableHead>{t('customerDetail.loginTime')}</TableHead>
                      <TableHead>{t('customerDetail.ip')}</TableHead>
                      <TableHead>{t('common.status')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">{t('customerDetail.noSessions')}</TableCell>
                      </TableRow>
                    ) : (
                      sessions.map((session) => (
                        <TableRow key={session.id} className="border-border">
                          <TableCell>{session.login_time ? new Date(session.login_time).toLocaleString() : '-'}</TableCell>
                          <TableCell className="font-mono text-sm">{session.login_ip || '-'}</TableCell>
                          <TableCell>
                            <Badge variant={session.is_active ? 'default' : 'secondary'}>
                              {session.is_active ? t('common.active') : t('common.inactive')}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          </div>
        </Tabs>
      </main>

    </div>
  );
};

const CustomerDetail = () => {
  const { customerId } = useParams();
  const { user } = useAuth();
  return <CustomerDetailSession key={`${user?.id}:${customerId}`} />;
};

export default CustomerDetail;

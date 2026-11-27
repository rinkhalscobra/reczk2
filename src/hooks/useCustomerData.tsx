import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import type { Json } from '@/integrations/supabase/types';
import { normalizeBalanceCurrency } from '@/lib/balances';
import type { CryptoBalance, CryptoBalanceAdjustment } from '@/lib/cryptoBalances';
import { useUserRole } from './useUserRole';

interface CustomerBalance {
  id: string;
  currency: string;
  balance: number;
  visible_on_dashboard: boolean;
}

interface Profile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  preferred_currency: string | null;
  display_currency: string;
  case_number: string | null;
  status: string | null;
  case_phase: string | null;
  recovery_search_started_at: string | null;
  recovery_search_duration_minutes: number;
  recovery_search_scope: string;
  recovery_result_type: string | null;
  recovery_result_details: Json;
  recovery_completed_at: string | null;
  assigned_to: string | null;
  created_at: string | null;
}

interface Transaction {
  id: string;
  type: 'deposit' | 'withdraw';
  amount: number;
  currency: string;
  method: string;
  status: string;
  created_at: string;
  notes: string | null;
  review_message: string | null;
}

interface CaseTimelineEvent {
  id: string;
  event_type: string;
  title: string;
  description: string | null;
  created_at: string;
}

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string | null;
  is_read: boolean;
  created_at: string;
}

const useCustomerDataState = (enabled: boolean) => {
  const { user } = useAuth();
  const userId = user?.id;
  const [balances, setBalances] = useState<CustomerBalance[]>([]);
  const [cryptoBalances, setCryptoBalances] = useState<CryptoBalance[]>([]);
  const [cryptoBalanceAdjustments, setCryptoBalanceAdjustments] = useState<CryptoBalanceAdjustment[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [timeline, setTimeline] = useState<CaseTimelineEvent[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const requestId = useRef(0);
  const loaded = useRef(false);

  const fetchData = useCallback(async () => {
    if (!userId || !enabled) return;
    const currentRequest = ++requestId.current;
    
    if (!loaded.current) setIsLoading(true);
    setError(null);
    try {
      const signal = AbortSignal.timeout(15_000);
      // Fetch all data in parallel
      const [balanceRes, cryptoBalanceRes, cryptoAdjustmentsRes, profileRes, transactionsRes, timelineRes, notificationsRes] = await Promise.all([
        supabase.from('customer_balances').select('*').eq('customer_id', userId).order('currency').abortSignal(signal),
        supabase.from('portfolio_items').select('id, crypto_id, crypto_name, crypto_symbol, quantity, purchase_price, visible_on_dashboard').eq('user_id', userId).order('crypto_symbol').abortSignal(signal),
        supabase.from('crypto_balance_adjustments').select('id, adjustment_type, amount, balance_after, crypto_id, crypto_symbol, reason, created_at').eq('customer_id', userId).not('reason', 'is', null).order('created_at', { ascending: false }).abortSignal(signal),
        supabase.from('profiles').select('*').eq('id', userId).abortSignal(signal).maybeSingle(),
        supabase.from('transaction_requests').select('*').eq('customer_id', userId).order('created_at', { ascending: false }).abortSignal(signal),
        supabase.from('case_timeline').select('*').eq('customer_id', userId).order('created_at', { ascending: false }).abortSignal(signal),
        supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).abortSignal(signal),
      ]);

      if (currentRequest !== requestId.current) return;
      if (profileRes.error) throw new Error(profileRes.error.message);
      if (!profileRes.data) throw new Error('Your account profile is unavailable. Please contact your administrator.');

      if (balanceRes.data) setBalances(balanceRes.data);
      if (cryptoBalanceRes.data) setCryptoBalances(cryptoBalanceRes.data);
      if (cryptoAdjustmentsRes.data) setCryptoBalanceAdjustments(cryptoAdjustmentsRes.data as CryptoBalanceAdjustment[]);
      if (profileRes.data) setProfile(profileRes.data);
      if (transactionsRes.data) setTransactions(transactionsRes.data as Transaction[]);
      if (timelineRes.data) setTimeline(timelineRes.data);
      if (notificationsRes.data) setNotifications(notificationsRes.data);
      loaded.current = true;
    } catch (error) {
      if (currentRequest === requestId.current) {
        setError(error instanceof Error ? error : new Error('Unable to load your account data'));
      }
    } finally {
      if (currentRequest === requestId.current) setIsLoading(false);
    }
  }, [userId, enabled]);

  useEffect(() => {
    if (!userId || !enabled) return;

    fetchData();

    // Share one channel across the customer's tables and all dashboard pages.
    const suffix = `${userId}-${Math.random().toString(36).slice(2, 10)}`;

    const channel = supabase
      .channel(`customer-data-${suffix}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (payload) => {
        setNotifications(prev => [payload.new as Notification, ...prev]);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transaction_requests', filter: `customer_id=eq.${userId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setTransactions(prev => [payload.new as Transaction, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setTransactions(prev => prev.map(t => t.id === payload.new.id ? payload.new as Transaction : t));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_balances', filter: `customer_id=eq.${userId}` }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const removed = payload.old as Pick<CustomerBalance, 'id'>;
          setBalances((current) => current.filter((balance) => balance.id !== removed.id));
          return;
        }

        const changed = payload.new as CustomerBalance;
        setBalances((current) => {
          const exists = current.some((balance) => balance.id === changed.id);
          return exists
            ? current.map((balance) => balance.id === changed.id ? changed : balance)
            : [...current, changed].sort((a, b) => a.currency.localeCompare(b.currency));
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portfolio_items', filter: `user_id=eq.${userId}` }, (payload) => {
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
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'crypto_balance_adjustments', filter: `customer_id=eq.${userId}` }, (payload) => {
        const adjustment = payload.new as CryptoBalanceAdjustment;
        if (adjustment.reason) {
          setCryptoBalanceAdjustments((current) => [adjustment, ...current]);
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, (payload) => {
        setProfile(payload.new as Profile);
      })
      .subscribe();

    return () => {
      // Invalidate in-flight responses when this account's subscriptions stop.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      requestId.current++;
      supabase.removeChannel(channel);
    };
  }, [userId, enabled, fetchData]);

  const markNotificationRead = async (notificationId: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', notificationId);
    setNotifications(prev => prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n));
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;
  const selectedCurrency = normalizeBalanceCurrency(profile?.preferred_currency || profile?.display_currency);
  const balance = useMemo(
    () => balances.find((item) => item.currency.toUpperCase() === selectedCurrency) || balances[0] || null,
    [balances, selectedCurrency],
  );

  return {
    balance,
    balances,
    cryptoBalances,
    cryptoBalanceAdjustments,
    profile,
    transactions,
    timeline,
    notifications,
    unreadCount,
    isLoading,
    error,
    markNotificationRead,
    refetch: fetchData,
  };
};

const CustomerDataContext = createContext<ReturnType<typeof useCustomerDataState> | null>(null);

const CustomerDataSession = ({ children, enabled }: { children: ReactNode; enabled: boolean }) => {
  const data = useCustomerDataState(enabled);
  return <CustomerDataContext.Provider value={data}>{children}</CustomerDataContext.Provider>;
};

export const CustomerDataProvider = ({ children }: { children: ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const { isUser } = useUserRole();
  const { pathname } = useLocation();
  return <CustomerDataSession key={user?.id ?? 'signed-out'} enabled={isUser && !authLoading && pathname.startsWith('/dashboard')}>
    {children}
  </CustomerDataSession>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useCustomerData = () => {
  const data = useContext(CustomerDataContext);
  if (!data) throw new Error('useCustomerData must be used within CustomerDataProvider');
  return data;
};

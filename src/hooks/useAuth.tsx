import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { authRequestError } from '@/lib/authRequests';

type SignUpResult = { error: Error | null; session: Session | null };
type SignInResult = { error: Error | null; mfaRequired?: boolean; ticket?: string };

interface AuthContextType {
  user: User | null;
  session: Session | null;
  signUp: (email: string, password: string, firstName: string, lastName: string, caseNumber: string) => Promise<SignUpResult>;
  signIn: (email: string, password: string, caseNumber?: string) => Promise<SignInResult>;
  completeSignIn: (ticket: string, code?: string) => Promise<SignInResult>;
  signOut: () => Promise<void>;
  loading: boolean;
  error: Error | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null>(null);
  const { toast } = useToast();

  const userId = user?.id ?? null;
  useEffect(() => {
    const previous = previousUserId.current;
    previousUserId.current = userId;
    if (previous && previous !== userId) {
      // Never reuse private query results after logout or an account switch.
      queryClient.removeQueries({ predicate: query => query.queryKey.includes(previous) });
    }
  }, [userId, queryClient]);

  useEffect(() => {
    let isMounted = true;
    let lastLoginUserId: string | null = null;
    const applySession = (nextSession: Session | null) => {
      setSession(nextSession);
      const nextUser = nextSession?.user ?? null;
      // Token renewals and focus events return fresh objects for the same
      // account. Preserve the user reference unless account details changed.
      setUser(current => JSON.stringify(current) === JSON.stringify(nextUser) ? current : nextUser);
    };

    // Set up auth state listener FIRST (for ongoing changes)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!isMounted) return;
        applySession(session);
        if (session) setError(null);
        if (event === 'SIGNED_OUT') {
          lastLoginUserId = null;
        }

        // Update last_login on sign in (defer to avoid deadlocks)
        if (event === 'SIGNED_IN' && session?.user && lastLoginUserId !== session.user.id) {
          lastLoginUserId = session.user.id;
          setTimeout(() => {
            if (!isMounted) return;
            supabase.from('profiles')
              .update({ last_login: new Date().toISOString() })
              .eq('id', session.user.id)
              .then();
          }, 0);
        }
      }
    );

    // THEN check for existing session (controls initial loading state)
    const initializeAuth = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!isMounted) return;
        applySession(session);
      } catch (error: unknown) {
        if (isMounted) {
          setError(error instanceof Error ? error : new Error('Unable to restore your session'));
          setSession(null);
          setUser(null);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    initializeAuth();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signUp = useCallback(async (email: string, password: string, firstName: string, lastName: string, caseNumber: string) => {
    setAuthenticating(true);
    setError(null);
    try {
      const { data, error: requestError } = await supabase.functions.invoke('register-client', {
        body: { email: email.trim().toLowerCase(), password, firstName, lastName, caseNumber: caseNumber.trim() },
        timeout: 30_000,
      });
      if (requestError) throw await authRequestError(requestError);
      if (data?.success !== true) throw new Error('Unable to confirm account creation. Please try again.');
      let session: Session | null = null;
      if (data.session) {
        const result = await supabase.auth.setSession(data.session);
        if (result.error) throw new Error('Your account was created. Please sign in with your email and password.');
        session = result.data.session;
      }
      toast({
        title: "Success!",
        description: session
          ? "Your account is ready to use."
          : "Your account was created. Please check your email before signing in.",
      });

      return { error: null, session };
    } catch (error: unknown) {
      const normalizedError = error instanceof Error ? error : new Error("An unexpected error occurred");
      toast({
        title: "Sign up failed",
        description: normalizedError.message,
        variant: "destructive",
      });
      return { error: normalizedError, session: null };
    } finally {
      setAuthenticating(false);
    }
  }, [toast]);

  const authenticate = useCallback(async (body: { email: string; password: string; caseNumber?: string } | { ticket: string; code?: string }): Promise<SignInResult> => {
    setAuthenticating(true);
    setError(null);
    let signedIn = false;
    try {
      const { data, error: requestError } = await supabase.functions.invoke('account-login', { body, timeout: 30_000 });
      if (requestError) throw await authRequestError(requestError);
      if (data?.mfaRequired === true && typeof data.ticket === 'string') return { error: null, mfaRequired: true, ticket: data.ticket };
      if (!data?.session?.access_token || !data.session.refresh_token) throw new Error('Unable to complete sign in. Please try again.');
      const { data: signInData, error } = await supabase.auth.setSession(data.session);
      if (error) throw new Error('Unable to complete sign in. Please try again.');

      signedIn = true;

      const { data: validation, error: validationError } = await supabase.functions.invoke('validate-staff-ip', {
        body: {},
        timeout: 15_000,
      });

      if (validationError || validation?.allowed !== true) {
        await supabase.auth.signOut();
        const validationMessage = validation?.reason || 'Unable to validate this login location.';
        const accessError = new Error(validationMessage);
        toast({
          title: 'Access denied',
          description: validationMessage,
          variant: 'destructive',
        });
        return { error: accessError };
      }

      if (!signInData.user) {
        await supabase.auth.signOut();
        return { error: new Error('Sign in completed without a valid user') };
      }

      toast({
        title: "Welcome back!",
        description: "You have successfully signed in.",
      });

      return { error: null };
    } catch (error: unknown) {
      if (signedIn) await supabase.auth.signOut({ scope: 'local' });
      return { error: error instanceof Error ? error : new Error("An unexpected error occurred") };
    } finally {
      setAuthenticating(false);
    }
  }, [toast]);

  const signIn = useCallback((email: string, password: string, caseNumber?: string) => authenticate({
    email: email.trim().toLowerCase(), password,
    ...(caseNumber?.trim() ? { caseNumber: caseNumber.trim() } : {}),
  }), [authenticate]);
  const completeSignIn = useCallback((ticket: string, code?: string) => authenticate({ ticket, code }), [authenticate]);

  const signOut = useCallback(async () => {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      toast({ title: 'Sign out failed', description: signOutError.message, variant: 'destructive' });
      return;
    }
    setError(null);
    toast({
      title: "Signed out",
      description: "You have been signed out successfully.",
    });
  }, [toast]);

  const value = useMemo(() => ({
    user, session, signUp, signIn, completeSignIn, signOut, loading: loading || authenticating, error,
  }), [user, session, signUp, signIn, completeSignIn, signOut, loading, authenticating, error]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

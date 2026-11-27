import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Eye,
  EyeOff,
  Files,
  MessagesSquare,
  Wallet,
  LockKeyhole,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MFAVerificationDialog } from "@/components/auth/MFAVerificationDialog";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { useUserRole } from "@/hooks/useUserRole";
import { roleHome } from "@/lib/roles";
import { RouteStatus } from "@/components/RouteStatus";
import { PortalBrand } from "@/components/client/PortalBrand";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useClientCopy } from "@/i18n/clientExperience";

const Auth = () => {
  const {
    signIn,
    completeSignIn,
    signUp,
    signOut,
    user,
    loading: authLoading,
    error: authError,
  } = useAuth();
  const {
    role,
    isLoading: roleLoading,
    error: roleError,
    refetch: retryRole,
  } = useUserRole();
  const { toast } = useToast();
  const { t } = useLanguage();
  const copy = useClientCopy();
  const navigate = useNavigate();

  const [mode, setMode] = useState<"login" | "signup">(() =>
    new URLSearchParams(window.location.search).get("mode") === "signup"
      ? "signup"
      : "login",
  );
  const [isLoading, setIsLoading] = useState(false);
  const [showMfaDialog, setShowMfaDialog] = useState(false);
  const [mfaTicket, setMfaTicket] = useState<string | null>(null);
  const [loginCaseNumber, setLoginCaseNumber] = useState("");
  const [signupCaseNumber, setSignupCaseNumber] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    if (
      user &&
      role &&
      !authLoading &&
      !roleLoading &&
      !roleError &&
      !isLoading
    ) {
      navigate(roleHome[role], { replace: true });
    }
  }, [user, role, authLoading, roleLoading, roleError, navigate, isLoading]);

  const showLoginResult = (result: Awaited<ReturnType<typeof signIn>>) => {
    if (result.error) {
      toast({
        title: t("auth.loginFailed"),
        description: result.error.message,
        variant: "destructive",
      });
    } else if (result.mfaRequired && result.ticket) {
      setMfaTicket(result.ticket);
      setLoginPassword("");
      setShowMfaDialog(true);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      showLoginResult(await signIn(loginEmail, loginPassword, loginCaseNumber));
    } catch {
      toast({
        title: t("auth.error"),
        description: t("auth.unexpectedError"),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (signupPassword !== confirmPassword) {
      toast({
        title: t("auth.signupFailed"),
        description: t("auth.passwordsDoNotMatch"),
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const email = signupEmail.trim().toLowerCase();
      const { error, session } = await signUp(
        email,
        signupPassword,
        firstName.trim(),
        lastName.trim(),
        signupCaseNumber,
      );
      if (error) return;

      if (!session?.user) {
        setMode("login");
        setLoginEmail(email);
        setLoginCaseNumber(signupCaseNumber.trim());
      }
    } catch {
      toast({
        title: t("auth.error"),
        description: t("auth.unexpectedError"),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleMfaVerify = async (code: string) => {
    if (!mfaTicket) throw new Error(t("auth.unexpectedError"));
    const result = await completeSignIn(mfaTicket, code);
    if (result.error) throw result.error;
    if (result.mfaRequired) throw new Error(t("auth.unexpectedError"));
    setShowMfaDialog(false);
    setMfaTicket(null);
  };

  const handleMfaCancelled = () => {
    setMfaTicket(null);
    setShowMfaDialog(false);
  };

  if (user && roleError && !authLoading) {
    return (
      <RouteStatus
        error="We couldn't load your account access. Please try again."
        onRetry={() => void retryRole()}
        onSignOut={() => void signOut()}
      />
    );
  }

  if (user)
    return (
      <RouteStatus
        message={
          authLoading ? "Completing sign in…" : "Loading your workspace…"
        }
      />
    );

  return (
    <div className="portal-auth">
      <header className="portal-auth-header">
        <PortalBrand to="/auth" />
        <div className="portal-auth-header-tools">
          <span>
            <LockKeyhole size={14} />
            {copy("privateAccess")}
          </span>
          <LanguageSelector />
        </div>
      </header>
      <main className="portal-auth-main">
        <section className="portal-auth-story">
          <p className="portal-overline">{copy("access")}</p>
          <h1>
            {copy("intro")
              .split("\n")
              .map((line, index) => (
                <span key={line} className={index ? "portal-auth-accent" : ""}>
                  {line}
                </span>
              ))}
          </h1>
          <p className="portal-auth-story-description">{copy("introText")}</p>
          <div className="portal-auth-art" aria-hidden="true">
            <div className="portal-art-orbit portal-art-orbit-one" />
            <div className="portal-art-orbit portal-art-orbit-two" />
            <div className="portal-art-gateway">
              <i />
              <i />
              <i />
              <i />
            </div>
            <span className="portal-art-label">userportal.</span>
          </div>
          <div className="portal-auth-features">
            {[
              { icon: Files, label: t("nav.myCase") },
              { icon: Wallet, label: t("nav.wallet") },
              { icon: MessagesSquare, label: t("nav.messages") },
            ].map((item) => (
              <div key={item.label}>
                <item.icon size={19} strokeWidth={1.5} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </section>
        <section
          className="portal-auth-form-shell"
          aria-labelledby="auth-form-title"
        >
          <div className="portal-auth-form-heading">
            <span className="portal-auth-tag">
              <LockKeyhole size={13} />
              {copy("privateAccess")}
            </span>
            <h2 id="auth-form-title">
              {mode === "login" ? copy("welcome") : copy("create")}
            </h2>
            <p>{mode === "login" ? copy("loginHint") : copy("signupHint")}</p>
          </div>
          <div
            className="portal-auth-tabs"
            role="tablist"
            aria-label="Authentication mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              className={mode === "login" ? "is-active" : ""}
              onClick={() => setMode("login")}
            >
              {t("auth.login")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signup"}
              className={mode === "signup" ? "is-active" : ""}
              onClick={() => setMode("signup")}
            >
              {t("auth.signUp")}
            </button>
          </div>
          <div className="portal-auth-form-body">
            {authError && (
              <p role="alert" className="mb-4 text-sm text-destructive">
                Your saved session could not be restored. Please sign in again.
              </p>
            )}
            {mode === "login" ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">{t("auth.email")}</Label>
                  <Input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-case-number">
                    {t("admin.caseNumber")}
                  </Label>
                  <Input
                    id="login-case-number"
                    value={loginCaseNumber}
                    maxLength={100}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(event) => setLoginCaseNumber(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">{t("auth.password")}</Label>
                  <div className="relative">
                    <Input
                      id="login-password"
                      type={showLoginPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      className="pr-12"
                      required
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="absolute right-0 top-0 h-full"
                      onClick={() =>
                        setShowLoginPassword((visible) => !visible)
                      }
                      aria-label={t(
                        showLoginPassword
                          ? "passwordControl.hide"
                          : "passwordControl.show",
                      )}
                      aria-controls="login-password"
                      aria-pressed={showLoginPassword}
                    >
                      {showLoginPassword ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading || authLoading}
                >
                  {isLoading ? t("auth.loggingIn") : t("auth.login")}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="first-name">{t("auth.firstName")}</Label>
                    <Input
                      id="first-name"
                      autoComplete="given-name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="last-name">{t("auth.lastName")}</Label>
                    <Input
                      id="last-name"
                      autoComplete="family-name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">{t("auth.contactEmail")}</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("auth.sharedEmailHint")}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-case-number">
                    {t("admin.caseNumber")}
                  </Label>
                  <Input
                    id="signup-case-number"
                    value={signupCaseNumber}
                    maxLength={100}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                    onChange={(event) =>
                      setSignupCaseNumber(event.target.value)
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("auth.caseRegistrationHint")}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">{t("auth.password")}</Label>
                  <div className="relative">
                    <Input
                      id="signup-password"
                      type={showSignupPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="••••••••"
                      minLength={6}
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                      className="pr-12"
                      required
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="absolute right-0 top-0 h-full"
                      onClick={() =>
                        setShowSignupPassword((visible) => !visible)
                      }
                      aria-label={t(
                        showSignupPassword
                          ? "passwordControl.hide"
                          : "passwordControl.show",
                      )}
                      aria-controls="signup-password"
                      aria-pressed={showSignupPassword}
                    >
                      {showSignupPassword ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">
                    {t("auth.confirmPassword")}
                  </Label>
                  <div className="relative">
                    <Input
                      id="confirm-password"
                      type={showConfirmPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="••••••••"
                      minLength={6}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="pr-12"
                      required
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="absolute right-0 top-0 h-full"
                      onClick={() =>
                        setShowConfirmPassword((visible) => !visible)
                      }
                      aria-label={t(
                        showConfirmPassword
                          ? "passwordControl.hide"
                          : "passwordControl.show",
                      )}
                      aria-controls="confirm-password"
                      aria-pressed={showConfirmPassword}
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading || authLoading}
                >
                  {isLoading
                    ? t("auth.creatingAccount")
                    : t("auth.createAccount")}
                </Button>
              </form>
            )}
          </div>
          <p className="portal-auth-switch">
            {mode === "login"
              ? t("auth.needAccount")
              : t("auth.alreadyHaveAccount")}{" "}
            <button
              type="button"
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
            >
              {mode === "login" ? t("auth.signUp") : t("auth.login")}
            </button>
          </p>
        </section>
      </main>
      <footer className="portal-auth-footer">
        <span>
          {String.fromCharCode(169)} {new Date().getFullYear()} User Portal
        </span>
        <span>{copy("workspace")}</span>
      </footer>
      <MFAVerificationDialog
        open={showMfaDialog}
        onOpenChange={setShowMfaDialog}
        onVerify={handleMfaVerify}
        onCancel={handleMfaCancelled}
      />
    </div>
  );
};

export default Auth;

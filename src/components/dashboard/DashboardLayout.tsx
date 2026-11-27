import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutGrid,
  Wallet,
  ArrowDownUp,
  Files,
  Bell,
  LogOut,
  MessagesSquare,
  Menu,
  X,
  Star,
  ChevronDown,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCustomerData } from "@/hooks/useCustomerData";
import { useLanguage } from "@/contexts/LanguageContext";
import { useUnreadCounts } from "@/hooks/useUnreadCounts";
import { RouteStatus } from "@/components/RouteStatus";
import { PortalBrand } from "@/components/client/PortalBrand";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useClientCopy } from "@/i18n/clientExperience";

export const DashboardLayout = ({ children }: { children: ReactNode }) => {
  const { user, signOut } = useAuth();
  const { profile, error, refetch } = useCustomerData();
  const { messages, notifications } = useUnreadCounts();
  const { t } = useLanguage();
  const copy = useClientCopy();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const items = [
    { path: "/dashboard", label: t("nav.overview"), icon: LayoutGrid },
    { path: "/dashboard/case", label: t("nav.myCase"), icon: Files },
    { path: "/dashboard/wallet", label: t("nav.wallet"), icon: Wallet },
    {
      path: "/dashboard/transactions",
      label: t("nav.transactions"),
      icon: ArrowDownUp,
    },
    { path: "/watchlist", label: t("crypto.myWatchlist"), icon: Star },
    {
      path: "/dashboard/messages",
      label: t("nav.messages"),
      icon: MessagesSquare,
      count: messages,
    },
  ];
  useEffect(() => {
    if (!user) navigate("/auth");
  }, [user, navigate]);
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);
  if (!user) return null;
  if (error)
    return (
      <RouteStatus
        error={error.message}
        onRetry={() => void refetch()}
        onSignOut={() => void signOut()}
      />
    );
  const email =
    profile?.email || String(user.user_metadata?.display_email || "");
  const name =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    copy("account");
  const initials =
    `${profile?.first_name?.[0] || email[0] || "U"}${profile?.last_name?.[0] || ""}`.toUpperCase();
  const current =
    items.find((item) => item.path === location.pathname)?.label ||
    (["/dashboard/deposit", "/dashboard/withdraw"].includes(location.pathname)
      ? copy("finance")
      : location.pathname === "/dashboard/funds"
        ? copy("caseFile")
        : t("notifications.title"));
  const navLink = (item: (typeof items)[number]) => (
    <Link
      key={item.path}
      to={item.path}
      className={`portal-nav-link${location.pathname === item.path ? " is-active" : ""}`}
      aria-current={location.pathname === item.path ? "page" : undefined}
      onClick={() => setMenuOpen(false)}
    >
      <item.icon size={18} strokeWidth={1.7} />
      <span>{item.label}</span>
      {!!item.count && <span className="portal-count">{item.count}</span>}
    </Link>
  );
  return (
    <div className="client-portal portal-workspace">
      <a className="portal-skip" href="#client-main">
        Skip to content
      </a>
      <header className="portal-topbar">
        <div className="portal-topbar-inner">
          <PortalBrand />
          <nav className="portal-desktop-nav" aria-label="Dashboard navigation">
            {items.map(navLink)}
          </nav>
          <div className="portal-header-tools">
            <LanguageSelector />
            <Link
              to="/dashboard/notifications"
              className="portal-icon-button portal-notification-button"
              aria-label={t("notifications.title")}
            >
              <Bell size={20} />
              {!!notifications && (
                <span className="portal-count">{notifications}</span>
              )}
            </Link>
            <details className="portal-account">
              <summary aria-label={copy("account")}>
                <span className="portal-avatar">{initials}</span>
                <ChevronDown size={14} />
              </summary>
              <div className="portal-account-menu">
                <p className="portal-overline">{copy("account")}</p>
                <strong>{name}</strong>
                {profile?.case_number && (
                  <span>
                    {t("admin.caseNumber")}: {profile.case_number}
                  </span>
                )}
                <button type="button" onClick={() => void signOut()}>
                  <LogOut size={16} />
                  {t("nav.signOut")}
                </button>
              </div>
            </details>
            <button
              className="portal-icon-button portal-menu-trigger"
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={menuOpen}
              aria-controls="client-mobile-menu"
            >
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav
            id="client-mobile-menu"
            className="portal-mobile-menu"
            aria-label="Mobile dashboard navigation"
          >
            {items.map(navLink)}
          </nav>
        )}
      </header>
      <div className="portal-workspace-bar">
        <div className="portal-breadcrumb">
          <span>{copy("workspace")}</span>
          <span aria-hidden="true">/</span>
          <strong>{current}</strong>
        </div>
        {profile?.case_number && (
          <Link to="/dashboard/case" className="portal-case-chip">
            <Files size={14} />
            <span>{copy("caseReference")}</span>
            <strong>{profile.case_number}</strong>
          </Link>
        )}
      </div>
      <main id="client-main" className="portal-main" tabIndex={-1}>
        {children}
      </main>
      <footer className="portal-workspace-footer">
        <span>userportal.</span>
        <span className="portal-footer-email">{email}</span>
        <span>{copy("privateAccess")}</span>
        <Link to="/dashboard/messages">{copy("support")}</Link>
      </footer>
      <nav className="portal-bottom-nav" aria-label="Quick navigation">
        {items
          .filter((item) =>
            [
              "/dashboard",
              "/dashboard/case",
              "/dashboard/wallet",
              "/dashboard/messages",
            ].includes(item.path),
          )
          .map(navLink)}
      </nav>
    </div>
  );
};

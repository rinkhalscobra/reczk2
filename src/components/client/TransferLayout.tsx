import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { WalletCards, MessagesSquare } from "lucide-react";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { useLanguage } from "@/contexts/LanguageContext";
import { useClientCopy } from "@/i18n/clientExperience";

export const TransferLayout = ({
  mode,
  children,
}: {
  mode: "deposit" | "withdraw";
  children: ReactNode;
}) => {
  const { t } = useLanguage();
  const copy = useClientCopy();
  return (
    <div className="portal-page-stack">
      <DashboardPageHeader
        eyebrow={copy("account")}
        title={copy("finance")}
        description={copy("financeHint")}
      />
      <div className="portal-finance-layout">
        <aside className="portal-finance-info">
          <WalletCards size={37} strokeWidth={1.2} />
          <h2>
            {mode === "deposit" ? t("deposit.title") : t("withdraw.title")}
          </h2>
          <p>
            {mode === "deposit"
              ? t("deposit.subtitle")
              : t("withdraw.subtitle")}
          </p>
          <Link to="/dashboard/messages" className="portal-text-link">
            <MessagesSquare size={16} />
            {copy("help")}
          </Link>
        </aside>
        <section className="min-w-0">
          <nav className="portal-finance-tabs" aria-label={copy("finance")}>
            <Link
              to="/dashboard/deposit"
              aria-current={mode === "deposit" ? "page" : undefined}
            >
              {t("balance.deposit")}
            </Link>
            <Link
              to="/dashboard/withdraw"
              aria-current={mode === "withdraw" ? "page" : undefined}
            >
              {t("balance.withdraw")}
            </Link>
          </nav>
          {children}
        </section>
      </div>
    </div>
  );
};

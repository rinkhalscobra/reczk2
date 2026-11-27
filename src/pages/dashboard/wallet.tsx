import { Plus, Minus, Clock3 } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { BalanceCard } from "@/components/dashboard/BalanceCard";
import { TransactionList } from "@/components/dashboard/TransactionList";
import { useCustomerData } from "@/hooks/useCustomerData";
import { useLanguage } from "@/contexts/LanguageContext";
import { useClientCopy } from "@/i18n/clientExperience";
import { BALANCE_CURRENCIES } from "@/lib/balances";
import { formatCurrency } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const WalletPage = () => {
  const {
    balances,
    cryptoBalances,
    cryptoBalanceAdjustments,
    transactions,
    isLoading,
  } = useCustomerData();
  const { t } = useLanguage();
  const copy = useClientCopy();
  const totals = (type: "deposit" | "withdraw", currency: string) =>
    transactions
      .filter(
        (tx) =>
          tx.type === type &&
          tx.status === "approved" &&
          tx.currency.toUpperCase() === currency,
      )
      .reduce((sum, tx) => sum + tx.amount, 0);
  const pending = transactions.filter((tx) => tx.status === "pending").length;
  return (
    <DashboardLayout>
      <div className="portal-page-stack">
        <DashboardPageHeader
          eyebrow={copy("account")}
          title={t("wallet.title")}
          description={copy("balanceHint")}
        />
        {isLoading ? (
          <Skeleton className="h-96" />
        ) : (
          <>
            <div className="portal-page-columns">
              <BalanceCard
                balances={balances}
                cryptoBalances={cryptoBalances}
                cryptoBalanceAdjustments={cryptoBalanceAdjustments}
              />
              <aside className="portal-page-stack">
                {(["deposit", "withdraw"] as const).map((type) => (
                  <section key={type} className="portal-surface">
                    <div className="portal-section-heading">
                      <h2 className="portal-section-title">
                        {t(
                          type === "deposit"
                            ? "wallet.totalDeposits"
                            : "wallet.totalWithdrawals",
                        )}
                      </h2>
                      {type === "deposit" ? (
                        <Plus size={18} className="text-success" />
                      ) : (
                        <Minus size={18} className="text-destructive" />
                      )}
                    </div>
                    <dl className="portal-wallet-totals">
                      {BALANCE_CURRENCIES.map((currency) => (
                        <div key={currency}>
                          <dt>{currency}</dt>
                          <dd>
                            {formatCurrency(totals(type, currency), currency)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <p className="mt-4 text-xs text-muted-foreground">
                      {t(
                        type === "deposit"
                          ? "wallet.approvedDeposits"
                          : "wallet.approvedWithdrawals",
                      )}
                    </p>
                  </section>
                ))}
              </aside>
            </div>
            {pending > 0 && (
              <div className="portal-surface flex items-center gap-3">
                <Clock3 size={20} className="text-primary" />
                <p className="text-sm">
                  {t("wallet.pendingTransactions").replace(
                    "{count}",
                    String(pending),
                  )}
                </p>
              </div>
            )}
            <TransactionList transactions={transactions.slice(0, 10)} />
          </>
        )}
      </div>
    </DashboardLayout>
  );
};
export default WalletPage;

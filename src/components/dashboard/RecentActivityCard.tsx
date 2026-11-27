import { Plus, Minus, ReceiptText } from "lucide-react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { useLanguage } from "@/contexts/LanguageContext";
import { useClientCopy } from "@/i18n/clientExperience";
import { formatCurrency } from "@/lib/utils";

interface Transaction {
  id: string;
  type: "deposit" | "withdraw";
  amount: number;
  currency: string;
  status: string;
  created_at: string;
}
export const RecentActivityCard = ({
  transactions,
}: {
  transactions: Transaction[];
}) => {
  const { t } = useLanguage();
  const copy = useClientCopy();
  return (
    <section className="portal-activity">
      <div className="portal-activity-header">
        <h2>{t("dashboard.recentActivity")}</h2>
        <Link className="portal-text-link" to="/dashboard/transactions">
          {t("nav.transactions")}
        </Link>
      </div>
      {!transactions.length ? (
        <div className="portal-activity-empty">
          <span className="portal-empty-symbol">
            <ReceiptText size={25} />
          </span>
          <div>
            <strong>{copy("noActivity")}</strong>
            <p>{copy("noActivityHint")}</p>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          {transactions.slice(0, 5).map((tx) => (
            <div key={tx.id} className="portal-activity-row">
              <span className="portal-empty-symbol">
                {tx.type === "deposit" ? (
                  <Plus size={17} />
                ) : (
                  <Minus size={17} />
                )}
              </span>
              <div className="portal-activity-row-main">
                {tx.type === "deposit"
                  ? t("balance.deposit")
                  : t("balance.withdraw")}
                <small>
                  {formatDistanceToNow(new Date(tx.created_at), {
                    addSuffix: true,
                  })}
                </small>
              </div>
              <div className="portal-activity-row-value">
                <span>
                  {tx.type === "deposit" ? "+" : "−"}
                  {formatCurrency(tx.amount, tx.currency || "EUR")}
                </span>
                <small>{t(`transactions.${tx.status}`)}</small>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

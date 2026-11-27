import { Plus, Minus, ReceiptText, MessageSquareText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { useLanguage } from "@/contexts/LanguageContext";
import { useClientCopy } from "@/i18n/clientExperience";
import { formatCurrency } from "@/lib/utils";
interface Transaction {
  id: string;
  type: "deposit" | "withdraw";
  amount: number;
  currency: string;
  method: string;
  status: string;
  created_at: string;
  notes: string | null;
  crypto_symbol?: string | null;
  quantity?: number | null;
  review_message?: string | null;
}
export const TransactionList = ({
  transactions,
  showAll = false,
}: {
  transactions: Transaction[];
  showAll?: boolean;
}) => {
  const { t } = useLanguage();
  const copy = useClientCopy();
  const rows = showAll ? transactions : transactions.slice(0, 10);
  return (
    <section className="portal-transaction-sheet">
      <header>
        <h2>{t("transactions.transactionHistory")}</h2>
        <ReceiptText size={20} className="text-muted-foreground" />
      </header>
      {!rows.length ? (
        <div className="portal-empty-state">
          <ReceiptText />
          <h3>{t("transactions.noTransactions")}</h3>
          <p>{t("transactions.historyAppears")}</p>
        </div>
      ) : (
        rows.map((tx) => (
          <article key={tx.id} className="portal-transaction-row">
            <div className="portal-transaction-line">
              <span className="portal-empty-symbol">
                {tx.type === "deposit" ? (
                  <Plus size={19} />
                ) : (
                  <Minus size={19} />
                )}
              </span>
              <div>
                <h3>
                  {tx.type === "deposit"
                    ? t("balance.deposit")
                    : t("balance.withdraw")}
                </h3>
                <p>
                  {tx.method
                    .replace(/_/g, " ")
                    .replace(/\b\w/g, (l) => l.toUpperCase())}
                  {tx.crypto_symbol && tx.quantity
                    ? " · " + tx.quantity + " " + tx.crypto_symbol
                    : ""}
                  <br />
                  <time dateTime={tx.created_at}>
                    {format(new Date(tx.created_at), "MMM d, yyyy · h:mm a")}
                  </time>
                </p>
              </div>
              <div className="portal-transaction-value">
                <strong className={tx.type === "deposit" ? "text-success" : ""}>
                  {tx.type === "deposit" ? "+" : "−"}
                  {formatCurrency(tx.amount, tx.currency || "EUR")}
                </strong>
                <Badge
                  variant={tx.status === "rejected" ? "destructive" : "outline"}
                  className={
                    tx.status === "approved"
                      ? "border-success/30 text-success"
                      : ""
                  }
                >
                  {t("transactions." + tx.status)}
                </Badge>
              </div>
            </div>
            {tx.review_message && (
              <div className="portal-transaction-message">
                <MessageSquareText size={17} />
                <div>
                  <p className="portal-overline mb-1">{copy("support")}</p>
                  <p className="whitespace-pre-wrap">{tx.review_message}</p>
                </div>
              </div>
            )}
          </article>
        ))
      )}
    </section>
  );
};

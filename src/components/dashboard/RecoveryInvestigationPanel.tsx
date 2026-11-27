import { useEffect, useState } from "react";
import {
  Search,
  CircleCheck,
  Clock3,
  FileText,
  Landmark,
  Coins,
} from "lucide-react";
import type { Json } from "@/integrations/supabase/types";
import { formatCurrency } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { useClientCopy } from "@/i18n/clientExperience";
import { Progress } from "@/components/ui/progress";
import { TransactionAnalysisFlow } from "./TransactionAnalysisFlow";

export interface RecoveryInvestigationData {
  searchStartedAt?: string | null;
  searchDurationMinutes?: number | null;
  searchScope?: string | null;
  resultType?: string | null;
  resultDetails?: Json | null;
  completedAt?: string | null;
}
const labels: Record<string, string> = {
  amount: "Identified amount",
  currency: "Currency",
  bank_name: "Financial institution",
  beneficiary_name: "Beneficiary",
  account_reference: "Account reference",
  transaction_reference: "Transaction reference",
  transaction_date: "Transaction date",
  country: "Jurisdiction",
  asset: "Digital asset",
  network: "Network",
  wallet_address: "Wallet address",
  transaction_hash: "Transaction hash",
  exchange_name: "Exchange / service",
  evidence_reference: "Evidence reference",
  summary: "Investigation summary",
};
export const RecoveryInvestigationPanel = ({
  phase,
  searchStartedAt,
  searchDurationMinutes,
  searchScope,
  resultType,
  resultDetails,
  completedAt,
}: RecoveryInvestigationData & { phase: string | null | undefined }) => {
  const [now, setNow] = useState(Date.now());
  const { t } = useLanguage();
  const copy = useClientCopy();
  useEffect(() => {
    if (phase !== "review" || !searchStartedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [phase, searchStartedAt]);
  if (phase !== "review" && phase !== "completed") return null;
  const complete = phase === "completed";
  const started = searchStartedAt ? new Date(searchStartedAt).getTime() : NaN;
  const duration = Math.max(1, searchDurationMinutes || 4320);
  const hasWindow = Number.isFinite(started);
  const elapsed = hasWindow ? Math.max(0, now - started) : 0;
  const percent = Math.min(100, (elapsed / (duration * 60000)) * 100);
  const remaining = Math.max(
    0,
    Math.ceil((duration * 60000 - elapsed) / 60000),
  );
  const details =
    resultDetails &&
    typeof resultDetails === "object" &&
    !Array.isArray(resultDetails)
      ? Object.fromEntries(
          Object.entries(resultDetails).filter(
            ([, value]) => value != null && value !== "",
          ),
        )
      : {};
  const published = complete && !!resultType && Object.keys(details).length > 0;
  const scope =
    searchScope === "bank"
      ? copy("scopeBank")
      : searchScope === "crypto"
        ? copy("scopeCrypto")
        : copy("scopeBoth");
  const fields = Object.entries(details).filter(
    ([key]) => !["amount", "currency"].includes(key),
  );
  const amount =
    details.amount != null && details.currency
      ? formatCurrency(Number(details.amount) || 0, String(details.currency))
      : null;
  return (
    <section className="portal-investigation">
      <header>
        <span className="portal-investigation-symbol">
          {complete ? <CircleCheck size={23} /> : <Search size={23} />}
        </span>
        <div>
          <p className="portal-overline">{copy("caseFile")}</p>
          <h2>
            {published
              ? copy("transactionPath")
              : complete
                ? copy("waitingFindings")
                : t("caseStatus.underReview")}
          </h2>
        </div>
        {published && amount && (
          <strong className="portal-investigation-value">{amount}</strong>
        )}
      </header>
      <p className="portal-investigation-description">
        {published
          ? copy("findingsHint")
          : complete
            ? copy("waitingFindingsHint")
            : copy("investigationHint")}
      </p>
      <TransactionAnalysisFlow scope={searchScope} complete={complete} />
      <div className="portal-investigation-facts">
        <div>
          {resultType === "crypto_transaction" || searchScope === "crypto" ? (
            <Coins size={17} />
          ) : (
            <Landmark size={17} />
          )}
          <span>{scope}</span>
        </div>
        {complete && completedAt ? (
          <div>
            <Clock3 size={17} />
            <time dateTime={completedAt}>
              {new Date(completedAt).toLocaleDateString()}
            </time>
          </div>
        ) : hasWindow ? (
          <div>
            <Clock3 size={17} />
            <span>
              {remaining > 0
                ? remaining >= 1440
                  ? Math.floor(remaining / 1440) +
                    "d " +
                    Math.floor((remaining % 1440) / 60) +
                    "h " +
                    copy("remaining")
                  : remaining >= 60
                    ? Math.floor(remaining / 60) +
                      "h " +
                      (remaining % 60) +
                      "m " +
                      copy("remaining")
                    : remaining + "m " + copy("remaining")
                : copy("windowComplete")}
            </span>
          </div>
        ) : (
          <div>
            <FileText size={17} />
            <span>{t("caseStatus.processingCase")}</span>
          </div>
        )}
      </div>
      {!complete && hasWindow && (
        <div className="portal-investigation-progress">
          <div>
            <span>{copy("window")}</span>
            <span>{Math.round(percent)}%</span>
          </div>
          <Progress value={percent} className="h-1.5" />
          <p>
            {duration.toLocaleString()} {copy("configured")}
            {remaining === 0 ? " · " + copy("awaitVerification") : ""}
          </p>
        </div>
      )}
      {published && fields.length > 0 && (
        <dl className="portal-finding-details">
          {fields.map(([key, value]) => (
            <div
              key={key}
              className={
                ["summary", "wallet_address", "transaction_hash"].includes(key)
                  ? "is-wide"
                  : ""
              }
            >
              <dt>{labels[key] || key.replace(/_/g, " ")}</dt>
              <dd>
                {typeof value === "object"
                  ? JSON.stringify(value)
                  : String(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
};

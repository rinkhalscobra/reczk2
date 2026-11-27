import { useState } from "react";
import { Plus, Minus, Coins } from "lucide-react";
import { Link } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { useClientCopy } from "@/i18n/clientExperience";
import { formatCurrency } from "@/lib/utils";
import {
  BALANCE_CURRENCIES,
  balanceForCurrency,
  type CurrencyBalance,
} from "@/lib/balances";
import {
  formatCryptoQuantity,
  type CryptoBalance,
  type CryptoBalanceAdjustment,
} from "@/lib/cryptoBalances";

export const BalanceCard = ({
  balances,
  cryptoBalances = [],
  cryptoBalanceAdjustments = [],
}: {
  balances: CurrencyBalance[];
  cryptoBalances?: CryptoBalance[];
  cryptoBalanceAdjustments?: CryptoBalanceAdjustment[];
}) => {
  const { t } = useLanguage();
  const copy = useClientCopy();
  const [selected, setSelected] = useState("EUR");
  const currencies = BALANCE_CURRENCIES.filter(
    (currency) =>
      balances.find((b) => b.currency.toUpperCase() === currency)
        ?.visible_on_dashboard !== false,
  );
  const activeCurrency = currencies.includes(
    selected as (typeof BALANCE_CURRENCIES)[number],
  )
    ? selected
    : currencies[0];
  const crypto = cryptoBalances.filter((b) => b.visible_on_dashboard !== false);
  return (
    <section className="portal-balance-panel" aria-label={copy("balances")}>
      <div className="portal-balance-top">
        <h2>{copy("balances")}</h2>
        {!!currencies.length && (
          <div className="portal-currency-tabs" aria-label={copy("currency")}>
            {currencies.map((currency) => (
              <button
                key={currency}
                type="button"
                aria-pressed={currency === activeCurrency}
                onClick={() => setSelected(currency)}
              >
                {currency}
              </button>
            ))}
          </div>
        )}
      </div>
      {activeCurrency ? (
        <div className="portal-balance-focus">
          <p>
            {copy("available")} · {activeCurrency}
          </p>
          <p className="portal-balance-number" aria-live="polite">
            {formatCurrency(
              balanceForCurrency(balances, activeCurrency),
              activeCurrency,
            )}
          </p>
          <div className="portal-balance-actions">
            <Link className="portal-button" to="/dashboard/deposit">
              <Plus size={16} />
              {t("balance.deposit")}
            </Link>
            <Link
              className="portal-button portal-button-secondary"
              to="/dashboard/withdraw"
            >
              <Minus size={16} />
              {t("balance.withdraw")}
            </Link>
          </div>
        </div>
      ) : (
        <div className="portal-balance-focus">
          <p>
            {t("balance.noBalances")}
          </p>
        </div>
      )}
      {!!currencies.length && (
        <div className="portal-currency-grid">
          {currencies.map((currency) => (
            <button
              className="portal-currency-account"
              key={currency}
              type="button"
              aria-pressed={currency === activeCurrency}
              onClick={() => setSelected(currency)}
            >
              <span>
                {currency === "EUR" ? "€" : currency === "CAD" ? "C$" : "$"}
                <span>{currency}</span>
              </span>
              <strong>
                {new Intl.NumberFormat(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }).format(balanceForCurrency(balances, currency))}
              </strong>
            </button>
          ))}
        </div>
      )}
      {!!crypto.length && (
        <div className="portal-crypto-accounts">
          <p className="portal-overline">{copy("assets")}</p>
          {crypto.map((b) => (
            <div
              key={b.id}
              className="portal-crypto-row"
              title={
                cryptoBalanceAdjustments.find(
                  (a) =>
                    a.crypto_id.toLowerCase() === b.crypto_id.toLowerCase(),
                )?.reason || undefined
              }
            >
              <span className="flex items-center gap-2">
                <Coins size={16} />
                {b.crypto_name}
              </span>
              <strong>
                {formatCryptoQuantity(
                  Number(b.quantity),
                  b.crypto_symbol.toUpperCase(),
                )}
              </strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

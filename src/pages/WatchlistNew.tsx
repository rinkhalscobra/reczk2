import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { AddWatchlistDialog } from "@/components/AddWatchlistDialog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { getCryptoPrices, CryptoPrice } from "@/services/cryptoApi";
import { Trash2, TrendingUp, TrendingDown, Star, Coins } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { RouteStatus } from "@/components/RouteStatus";
import { useClientCopy } from "@/i18n/clientExperience";

interface WatchlistItem {
  id: string;
  crypto_id: string;
  crypto_name: string;
  crypto_symbol: string;
  created_at: string;
}

const WatchlistNew = () => {
  const { t } = useLanguage();
  const copy = useClientCopy();
  const { user, loading: authLoading } = useAuth();
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [cryptoPrices, setCryptoPrices] = useState<Record<string, CryptoPrice>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchWatchlist = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    const { data, error } = await supabase
      .from("watchlist_items")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching watchlist:", error);
    } else {
      setWatchlistItems(data || []);

      // Fetch prices for all cryptos
      const cryptoIds = [...new Set(data?.map((item) => item.crypto_id) || [])];
      if (cryptoIds.length > 0) {
        const prices = await getCryptoPrices(cryptoIds);
        setCryptoPrices(prices);
      }
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (!authLoading) {
      fetchWatchlist();
    }
  }, [authLoading, fetchWatchlist]);

  // Refresh prices every 30 seconds
  useEffect(() => {
    if (watchlistItems.length === 0) return;

    const interval = setInterval(async () => {
      const cryptoIds = [
        ...new Set(watchlistItems.map((item) => item.crypto_id)),
      ];
      const prices = await getCryptoPrices(cryptoIds);
      setCryptoPrices(prices);
    }, 30000);

    return () => clearInterval(interval);
  }, [watchlistItems]);

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from("watchlist_items")
      .delete()
      .eq("id", id);

    if (error) {
      toast({
        title: t("common.error"),
        description: t("crypto.failedToRemove"),
        variant: "destructive",
      });
    } else {
      toast({
        title: t("common.success"),
        description: t("crypto.removedFromWatchlist"),
      });
      fetchWatchlist();
    }
  };

  if (authLoading) return <RouteStatus />;
  if (!user) return <Navigate to="/auth" replace />;
  return (
    <DashboardLayout>
      <div className="portal-page-stack">
        <DashboardPageHeader
          eyebrow={copy("assets")}
          title={t("crypto.myWatchlist")}
          description={t("crypto.trackFavorites")}
          action={<AddWatchlistDialog onSuccess={fetchWatchlist} />}
        />
        {loading ? (
          <div className="portal-surface portal-empty-state">
            <p>{t("crypto.loadingWatchlist")}</p>
          </div>
        ) : watchlistItems.length === 0 ? (
          <section className="portal-surface portal-empty-state">
            <Star />
            <h2>{t("crypto.watchlistEmptyNew")}</h2>
            <p>{t("crypto.startTracking")}</p>
            <AddWatchlistDialog onSuccess={fetchWatchlist} />
          </section>
        ) : (
          <div className="portal-watchlist-grid">
            {watchlistItems.map((item) => {
              const price = cryptoPrices[item.crypto_id];
              const change = price?.price_change_percentage_24h;
              return (
                <article className="portal-market-card" key={item.id}>
                  <header>
                    <span className="portal-market-icon">
                      {price?.image ? (
                        <img src={price.image} alt="" />
                      ) : (
                        <Coins size={26} />
                      )}
                    </span>
                    <div>
                      <h2>{item.crypto_name}</h2>
                      <p>{item.crypto_symbol.toUpperCase()}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void handleDelete(item.id)}
                      aria-label={t("common.delete") + " " + item.crypto_name}
                    >
                      <Trash2 size={17} />
                    </Button>
                  </header>
                  <div className="portal-market-price">
                    <div>
                      <span>{t("crypto.currentPrice")}</span>
                      <strong>
                        {price?.current_price != null
                          ? new Intl.NumberFormat(undefined, {
                              style: "currency",
                              currency: "EUR",
                            }).format(price.current_price)
                          : "—"}
                      </strong>
                    </div>
                    <div
                      className={
                        change != null && change < 0
                          ? "text-destructive"
                          : "text-success"
                      }
                    >
                      {change != null && (
                        <>
                          {change >= 0 ? (
                            <TrendingUp size={18} />
                          ) : (
                            <TrendingDown size={18} />
                          )}
                          <strong>
                            {change >= 0 ? "+" : ""}
                            {change.toFixed(2)}%
                          </strong>
                        </>
                      )}
                      <span>{t("crypto.change24h")}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};
export default WatchlistNew;

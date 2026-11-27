export interface CryptoBalance {
  id: string;
  crypto_id: string;
  crypto_name: string;
  crypto_symbol: string;
  quantity: number;
  purchase_price?: number;
  visible_on_dashboard?: boolean;
}

export interface CryptoBalanceAdjustment {
  id: string;
  adjustment_type: 'credit' | 'debit';
  amount: number;
  balance_after: number;
  crypto_id: string;
  crypto_symbol: string;
  reason: string | null;
  created_at: string;
}

export const COMMON_CRYPTO_ASSETS = [
  { id: 'btc', symbol: 'BTC', name: 'Bitcoin' },
  { id: 'eth', symbol: 'ETH', name: 'Ethereum' },
  { id: 'usdt', symbol: 'USDT', name: 'Tether' },
] as const;

export const formatCryptoQuantity = (quantity: number, symbol: string) =>
  `${Number(quantity).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  })} ${symbol.toUpperCase()}`;

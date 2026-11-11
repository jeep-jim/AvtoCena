import { CurrencyFlag } from "@/components/catalog/PriceTrend";
import type { CatalogMarket } from "@/lib/catalog/types";

// Use the same SVG flag renderer as the currency strip so Windows never falls
// back to the two regional-indicator letters (KR, CN, JP, etc.).
const MARKET_CURRENCY: Record<CatalogMarket, string> = {
  korea: "KRW",
  china: "CNY",
  japan: "JPY",
  uae: "AED",
  europe: "EUR",
  georgia: "GEL",
};

export function CatalogMarketFlag({ market, className = "h-4 w-6" }: { market: CatalogMarket | string; className?: string }) {
  const currency = MARKET_CURRENCY[String(market || "").toLowerCase() as CatalogMarket];
  return currency ? <CurrencyFlag currency={currency} className={className} /> : null;
}

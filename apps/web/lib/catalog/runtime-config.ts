import type { CatalogMarket } from "./types";

export const PUBLIC_CATALOG_MARKETS: CatalogMarket[] = [
  "korea",
  "china",
  "japan",
  "uae",
  "europe",
  "georgia",
  "kyrgyzstan",
];

export const PUBLIC_CATALOG_MARKET_SET = new Set<CatalogMarket>(PUBLIC_CATALOG_MARKETS);

export const CATALOG_MARKET_LABELS: Record<CatalogMarket, string> = {
  korea: "Корея",
  china: "Китай",
  japan: "Япония",
  uae: "ОАЭ",
  europe: "Европа",
  georgia: "Грузия",
  kyrgyzstan: "Кыргызстан",
};

export const CATALOG_MARKET_FLAGS: Record<CatalogMarket, string> = {
  korea: "🇰🇷",
  china: "🇨🇳",
  japan: "🇯🇵",
  uae: "🇦🇪",
  europe: "🇪🇺",
  georgia: "🇬🇪",
  kyrgyzstan: "🇰🇬",
};

export const CATALOG_CHUNK_SIZE = 250;
// Compatibility target for older incremental jobs. The source-scale production job uses
// CATALOG_DAILY_TARGET_PER_SOURCE and may publish many thousands of offers per market.
export const CATALOG_DAILY_TARGET_PER_MARKET = 1_000;
export const CATALOG_DAILY_TARGET_PER_SOURCE = 1_000;
export const CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET = 30_000;
export const CATALOG_DAILY_TARGET_TOTAL = PUBLIC_CATALOG_MARKETS.length * CATALOG_DAILY_TARGET_PER_MARKET;
export const CATALOG_RETENTION_MS = 3 * 24 * 60 * 60 * 1_000;

export function catalogMarketLabel(value: unknown) {
  return CATALOG_MARKET_LABELS[String(value || "").toLowerCase() as CatalogMarket]
    || String(value || "").trim()
    || "Рынок уточняется";
}

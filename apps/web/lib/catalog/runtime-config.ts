import type { CatalogMarket } from "./types";

// Manual production rebuild trigger after the vehicle-knowledge sync fix on 2026-07-29.
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
// Эти значения оставлены для совместимости старых incremental-задач.
// В Catalog V2 реальный предел задаёт catalog-v2-policy: не менее 100 000
// проверенных предложений на рынок. 1000 — ориентир обхода, а не лимит публикации.
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

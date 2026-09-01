import type { CatalogMarket } from "./types";

export const PUBLIC_CATALOG_MARKETS: CatalogMarket[] = [
  "korea",
  "china",
  "japan",
  "uae",
  "europe",
  "georgia",
];

export const PUBLIC_CATALOG_MARKET_SET = new Set<CatalogMarket>(PUBLIC_CATALOG_MARKETS);

export const CATALOG_MARKET_LABELS: Record<CatalogMarket, string> = {
  korea: "Корея",
  china: "Китай",
  japan: "Япония",
  uae: "ОАЭ",
  europe: "Европа",
  georgia: "Грузия",
};

export const CATALOG_MARKET_FLAGS: Record<CatalogMarket, string> = {
  korea: "🇰🇷",
  china: "🇨🇳",
  japan: "🇯🇵",
  uae: "🇦🇪",
  europe: "🇪🇺",
  georgia: "🇬🇪",
};

// JSON каталога хранится небольшими независимыми чанками. 500 записей —
// согласованный верхний предел одного файла, чтобы обновление одного рынка
// не требовало перечитывать весь каталог.
export const CATALOG_CHUNK_SIZE = 500;
export const CATALOG_DAILY_TARGET_PER_MARKET = 100_000;
export const CATALOG_DAILY_TARGET_PER_SOURCE = 100_000;
export const CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET = 100_000;
export const CATALOG_DAILY_TARGET_TOTAL = PUBLIC_CATALOG_MARKETS.length * CATALOG_DAILY_TARGET_PER_MARKET;
export const CATALOG_RETENTION_MS = 3 * 24 * 60 * 60 * 1_000;

export function catalogMarketLabel(value: unknown) {
  return CATALOG_MARKET_LABELS[String(value || "").toLowerCase() as CatalogMarket]
    || String(value || "").trim()
    || "Рынок уточняется";
}

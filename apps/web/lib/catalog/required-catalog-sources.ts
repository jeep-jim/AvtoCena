import type { CatalogMarket } from "./types";

export type RequiredCatalogSource = {
  sourceId: string;
  label: string;
  canonicalUrl: string;
  role: "primary" | "auction_history";
  required: true;
  anchor: true;
};

/**
 * Канонический обязательный набор источников каталога AvtoCena.
 *
 * Это единственный разрешённый production-набор каждого рынка:
 * - никакие дополнительные площадки не допускаются в сбор, retention или публикацию;
 * - каждый перечисленный источник проверяется и парсится отдельно;
 * - рынок не считается готовым, пока не подтверждён каждый источник из этого списка;
 * - sourceId и кликабельный sourceUrl обязаны принадлежать этому allowlist.
 */
export const REQUIRED_CATALOG_SOURCES: Record<CatalogMarket, readonly RequiredCatalogSource[]> = {
  uae: [
    { sourceId: "dubizzle_uae_open", label: "Dubizzle", canonicalUrl: "https://uae.dubizzle.com/", role: "primary", required: true, anchor: true },
    { sourceId: "dubicars_uae_exact", label: "DubiCars", canonicalUrl: "https://www.dubicars.com/", role: "primary", required: true, anchor: true },
    { sourceId: "carswitch_uae_open", label: "CarSwitch", canonicalUrl: "https://carswitch.com/", role: "primary", required: true, anchor: true },
  ],
  korea: [
    { sourceId: "encar_direct", label: "Encar", canonicalUrl: "https://www.encar.com/", role: "primary", required: true, anchor: true },
    { sourceId: "kcar_korea_open", label: "K Car", canonicalUrl: "https://www.kcar.com/", role: "primary", required: true, anchor: true },
  ],
  europe: [
    { sourceId: "mobile_de_open", label: "mobile.de", canonicalUrl: "https://www.mobile.de/", role: "primary", required: true, anchor: true },
    { sourceId: "autoscout_europe_open", label: "AutoScout24", canonicalUrl: "https://www.autoscout24.com/", role: "primary", required: true, anchor: true },
  ],
  georgia: [
    { sourceId: "myauto_georgia_list", label: "MyAuto", canonicalUrl: "https://www.myauto.ge/", role: "primary", required: true, anchor: true },
    { sourceId: "autopapa_georgia_open", label: "AutoPapa", canonicalUrl: "https://autopapa.ge/", role: "primary", required: true, anchor: true },
  ],
  china: [
    { sourceId: "autohome_used_china_open", label: "Che168 Global", canonicalUrl: "https://global.che168.com/", role: "primary", required: true, anchor: true },
    { sourceId: "autohome_new_china_open", label: "Autohome new cars", canonicalUrl: "https://www.autohome.com.cn/", role: "primary", required: true, anchor: true },
  ],
  // Owner decision 2026-09-18: Drom retired. Japan is collected by the
  // standalone ProAuctions workflow, using APPROVED_SAVED_CATALOG_SOURCES.
  // No legacy generic Japan adapter may collect or restore Drom inventory.
  japan: [],
};

// Owner-requested saved auction imports; no claim of an automated live adapter.
export const APPROVED_SAVED_CATALOG_SOURCES = [
  { market: "japan", sourceId: "jptrade_japan_stat", canonicalUrl: "https://jptrade.ru/stat/" },
  { market: "japan", sourceId: "proauctions_japan_stat", canonicalUrl: "https://demo.pro-auctions.ru/statistika/" },
] as const;
export function allowedCatalogSourceIds(market: CatalogMarket) {
  return [...sourcesForMarket(market).map(source => source.sourceId),
    ...APPROVED_SAVED_CATALOG_SOURCES.filter(source => source.market === market).map(source => source.sourceId)];
}

// Persisted maintenance rows may belong to retired or malformed markets.
// Unknown markets have no approved sources and must fail closed, not crash.
function sourcesForMarket(market: CatalogMarket) {
  const sources = REQUIRED_CATALOG_SOURCES[market];
  return Array.isArray(sources) ? sources : [];
}

export function requiredCatalogSourceIds(market: CatalogMarket) {
  return sourcesForMarket(market).map((source) => source.sourceId);
}

export function isAllowedCatalogSourceId(market: CatalogMarket, sourceId: unknown) {
  const id = String(sourceId || "").trim();
  return allowedCatalogSourceIds(market).includes(id);
}

function registrableHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  const suffix2 = parts.slice(-2).join(".");
  const multiLabel = new Set(["com.au", "com.cn", "co.kr", "co.jp"]);
  return multiLabel.has(suffix2) ? parts.slice(-3).join(".") : parts.slice(-2).join(".");
}

export function isAllowedCatalogSourceUrl(market: CatalogMarket, sourceId: unknown, urlValue: unknown) {
  const id = String(sourceId || "").trim();
  const allowed = [...sourcesForMarket(market), ...APPROVED_SAVED_CATALOG_SOURCES.filter(source => source.market === market)].find((source) => source.sourceId === id);
  if (!allowed) return false;
  try {
    const actual = new URL(String(urlValue || ""));
    const canonical = new URL(allowed.canonicalUrl);
    if (id === "proauctions_japan_stat") return actual.origin === "https://demo.pro-auctions.ru" && /^\/statistika\/[^/]+\/[^/]+\/\d+\.html$/.test(actual.pathname) && !actual.search && !actual.hash && !actual.username && !actual.password;
    if (id === "jptrade_japan_stat") return actual.origin === "https://jptrade.ru" && /^\/stat\/\d+$/.test(actual.pathname) && !actual.search && !actual.hash;
    if (market === "china" && id === "autohome_used_china_open" && !["global.che168.com"].includes(actual.hostname.toLowerCase())) return false;
    return /^https?:$/.test(actual.protocol) && registrableHost(actual.hostname) === registrableHost(canonical.hostname);
  } catch {
    return false;
  }
}

export function requiredCatalogSourceUrls(market: CatalogMarket) {
  return sourcesForMarket(market).map((source) => source.canonicalUrl);
}

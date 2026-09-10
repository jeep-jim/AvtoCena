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
    { sourceId: "autohome_used_china_open", label: "Che168", canonicalUrl: "https://www.che168.com/", role: "primary", required: true, anchor: true },
    { sourceId: "dongchedi_china_open", label: "Dongchedi", canonicalUrl: "https://www.dongchedi.com/", role: "primary", required: true, anchor: true },
    { sourceId: "guazi_china_open", label: "Guazi", canonicalUrl: "https://www.guazi.com/", role: "primary", required: true, anchor: true },
    { sourceId: "autohome_new_china_open", label: "Autohome new cars", canonicalUrl: "https://www.autohome.com.cn/", role: "primary", required: true, anchor: true },
  ],
  // Owner decision 2026-09-10: publish only Drom sold results. Retired
  // auction rows must not be retained or restored by subsequent refreshes.
  japan: [
    { sourceId: "drom_japan_stat", label: "Drom completed auctions", canonicalUrl: "https://www.drom.ru/world/japan/", role: "auction_history", required: true, anchor: true },
  ],
};

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
  return sourcesForMarket(market).some((source) => source.sourceId === id);
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
  const allowed = sourcesForMarket(market).find((source) => source.sourceId === id);
  if (!allowed) return false;
  try {
    const actual = new URL(String(urlValue || ""));
    const canonical = new URL(allowed.canonicalUrl);
    if (market === "china" && id === "autohome_used_china_open" && !["che168.com", "www.che168.com", "m.che168.com", "dealers.che168.com"].includes(actual.hostname.toLowerCase())) return false;
    return /^https?:$/.test(actual.protocol) && registrableHost(actual.hostname) === registrableHost(canonical.hostname);
  } catch {
    return false;
  }
}

export function requiredCatalogSourceUrls(market: CatalogMarket) {
  return sourcesForMarket(market).map((source) => source.canonicalUrl);
}

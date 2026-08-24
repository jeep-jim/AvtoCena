import type { CatalogMarket } from "./types";
import {
  REQUIRED_CATALOG_SOURCES,
  requiredCatalogSourceIds,
  type RequiredCatalogSource,
} from "./required-catalog-sources";

export type CatalogV2SourceSlot = {
  sourceId: string;
  label: string;
  canonicalUrl: string;
  role: "primary" | "secondary" | "auction_history" | "knowledge";
  required?: boolean;
  anchor?: boolean;
};

/**
 * Обязательное ядро берётся только из required-catalog-sources.ts.
 * Дополнительные источники разрешены, но не могут заменить обязательный сайт,
 * подменить его объявление или смешать фотографии разных карточек.
 */
export const CATALOG_V2_SOURCE_SLOTS: Record<CatalogMarket, readonly CatalogV2SourceSlot[]> = {
  korea: [
    ...REQUIRED_CATALOG_SOURCES.korea,
    { sourceId: "kbchachacha_korea_open", label: "KB ChaChaCha", canonicalUrl: "https://www.kbchachacha.com/", role: "secondary" },
    { sourceId: "bobaedream_korea_open", label: "Bobaedream", canonicalUrl: "https://www.bobaedream.co.kr/", role: "secondary" },
    { sourceId: "autowini_korea_open", label: "Autowini", canonicalUrl: "https://www.autowini.com/", role: "secondary" },
  ],
  china: [
    ...REQUIRED_CATALOG_SOURCES.china,
    { sourceId: "taoche_china_open", label: "Taoche", canonicalUrl: "https://www.taoche.com/", role: "secondary" },
    { sourceId: "uxin_china_open", label: "Uxin", canonicalUrl: "https://www.xin.com/", role: "secondary" },
  ],
  japan: [
    ...REQUIRED_CATALOG_SOURCES.japan,
    { sourceId: "japantransit_japan_stat_open", label: "Japan Transit auction statistics", canonicalUrl: "https://japantransit.ru/stat/", role: "auction_history" },
    { sourceId: "auctions22_japan_past_open", label: "Auctions22 auction results", canonicalUrl: "https://auctions22.com/past", role: "auction_history" },
    { sourceId: "jpauc_japan_current_open", label: "JPAuc current auctions", canonicalUrl: "https://jpauc.com/auction", role: "secondary" },
    { sourceId: "auctions22_japan_upcoming_open", label: "Auctions22 upcoming auctions", canonicalUrl: "https://auctions22.com/upcoming", role: "secondary" },
  ],
  uae: [
    ...REQUIRED_CATALOG_SOURCES.uae,
    { sourceId: "dubizzle_uae_open", label: "Dubizzle", canonicalUrl: "https://uae.dubizzle.com/", role: "secondary" },
    { sourceId: "yallamotor_uae_open", label: "YallaMotor", canonicalUrl: "https://uae.yallamotor.com/", role: "secondary" },
    { sourceId: "beforward_public", label: "BE FORWARD UAE", canonicalUrl: "https://www.beforward.jp/", role: "secondary" },
  ],
  europe: [
    ...REQUIRED_CATALOG_SOURCES.europe,
    { sourceId: "otomoto_europe_exact", label: "OTOMOTO", canonicalUrl: "https://www.otomoto.pl/", role: "secondary" },
    { sourceId: "lacentrale_fr_open", label: "La Centrale", canonicalUrl: "https://www.lacentrale.fr/", role: "secondary" },
    { sourceId: "leboncoin_fr_open", label: "Leboncoin", canonicalUrl: "https://www.leboncoin.fr/", role: "secondary" },
  ],
  georgia: [
    ...REQUIRED_CATALOG_SOURCES.georgia,
  ],
  kyrgyzstan: [
    ...REQUIRED_CATALOG_SOURCES.kyrgyzstan,
    { sourceId: "bazar_kyrgyzstan_open", label: "Bazar.kg", canonicalUrl: "https://www.bazar.kg/", role: "secondary" },
    { sourceId: "lalafo_kyrgyzstan_open", label: "Lalafo", canonicalUrl: "https://lalafo.kg/", role: "secondary" },
    { sourceId: "turbo_kyrgyzstan_open", label: "Turbo.kg", canonicalUrl: "https://turbo.kg/", role: "secondary" },
    { sourceId: "omarket_kyrgyzstan_open", label: "O!Market", canonicalUrl: "https://market.o.kg/", role: "secondary" },
  ],
};

/** США сохраняем как следующий рынок, но не смешиваем с действующими семью. */
export const CATALOG_FUTURE_USA_ANCHORS = [
  { label: "Stat.vin", canonicalUrl: "https://stat.vin/" },
  { label: "BidCars", canonicalUrl: "https://bid.cars/" },
  { label: "AuctionStat", canonicalUrl: "https://auctionstat.com/" },
] as const;

export const CATALOG_V2_MIN_SOURCE_SLOTS = 5;

function sourceIsCollectible(market: CatalogMarket, source: CatalogV2SourceSlot) {
  // Обязательные сайты всегда входят в парсинг, включая Autohome New и JP Center.
  if (source.required) return true;
  if (source.role === "knowledge") return false;
  if (market === "japan") return source.role === "auction_history";
  return true;
}

export function catalogV2SourceIds(market: CatalogMarket) {
  return CATALOG_V2_SOURCE_SLOTS[market]
    .filter((source) => sourceIsCollectible(market, source))
    .map((source) => source.sourceId);
}

export function catalogV2RequiredSourceIds(market: CatalogMarket) {
  return requiredCatalogSourceIds(market);
}

export function catalogV2AnchorSourceIds(market: CatalogMarket) {
  return CATALOG_V2_SOURCE_SLOTS[market]
    .filter((source) => source.required && source.anchor && sourceIsCollectible(market, source))
    .map((source) => source.sourceId);
}

export function catalogV2KnowledgeSourceIds(market: CatalogMarket) {
  return CATALOG_V2_SOURCE_SLOTS[market]
    .filter((source) => source.role === "knowledge")
    .map((source) => source.sourceId);
}

function assertRequiredSourcesPresent() {
  const failures: string[] = [];

  for (const [marketName, requiredSources] of Object.entries(REQUIRED_CATALOG_SOURCES)) {
    const market = marketName as CatalogMarket;
    const registered = CATALOG_V2_SOURCE_SLOTS[market];
    const collectibleIds = new Set(catalogV2SourceIds(market));

    for (const required of requiredSources as readonly RequiredCatalogSource[]) {
      const source = registered.find((candidate) => candidate.sourceId === required.sourceId);
      if (!source) {
        failures.push(`${market}:${required.sourceId}:missing`);
        continue;
      }
      if (source.canonicalUrl !== required.canonicalUrl) failures.push(`${market}:${required.sourceId}:url_changed`);
      if (!source.required || !source.anchor) failures.push(`${market}:${required.sourceId}:not_required`);
      if (!collectibleIds.has(required.sourceId)) failures.push(`${market}:${required.sourceId}:excluded_from_collection`);
    }
  }

  if (failures.length) throw new Error(`catalog_required_sources_contract_broken:${failures.join(",")}`);
}

export function assertCatalogV2SourceRegistry() {
  assertRequiredSourcesPresent();

  const failures = Object.entries(CATALOG_V2_SOURCE_SLOTS)
    .filter(([market, sources]) => {
      const minimum = market === "georgia" ? REQUIRED_CATALOG_SOURCES.georgia.length : CATALOG_V2_MIN_SOURCE_SLOTS;
      return new Set(sources.filter((source) => sourceIsCollectible(market as CatalogMarket, source)).map((source) => source.sourceId)).size < minimum;
    })
    .map(([market]) => market);

  if (failures.length) throw new Error(`catalog_v2_source_slots_missing:${failures.join(",")}`);
  return true;
}

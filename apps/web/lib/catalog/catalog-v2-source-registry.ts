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
 * Production source registry is a hard allowlist. The only collectible source
 * slots are the exact sites declared in required-catalog-sources.ts. Historical
 * adapters may remain in the repository for diagnostics, but they cannot enter
 * collection, retention or publication until this allowlist itself is changed.
 */
export const CATALOG_V2_SOURCE_SLOTS: Record<CatalogMarket, readonly CatalogV2SourceSlot[]> = {
  korea: [...REQUIRED_CATALOG_SOURCES.korea],
  china: [...REQUIRED_CATALOG_SOURCES.china],
  japan: [...REQUIRED_CATALOG_SOURCES.japan],
  uae: [...REQUIRED_CATALOG_SOURCES.uae],
  europe: [...REQUIRED_CATALOG_SOURCES.europe],
  georgia: [...REQUIRED_CATALOG_SOURCES.georgia],
};

/** USA is future-only metadata and is not part of PUBLIC_CATALOG_MARKETS or collection. */
export const CATALOG_FUTURE_USA_ANCHORS = [
  { label: "Stat.vin", canonicalUrl: "https://stat.vin/" },
  { label: "BidCars", canonicalUrl: "https://bid.cars/" },
  { label: "AuctionStat", canonicalUrl: "https://auctionstat.com/" },
] as const;

// Compatibility export. Strict markets use their exact allowlist length instead
// of a synthetic minimum number of sources.
export const CATALOG_V2_MIN_SOURCE_SLOTS = 1;

function sourceIsCollectible(source: CatalogV2SourceSlot) {
  return source.required === true && source.anchor === true;
}

export function catalogV2SourceIds(market: CatalogMarket) {
  return CATALOG_V2_SOURCE_SLOTS[market]
    .filter(sourceIsCollectible)
    .map((source) => source.sourceId);
}

export function catalogV2RequiredSourceIds(market: CatalogMarket) {
  return requiredCatalogSourceIds(market);
}

export function catalogV2AnchorSourceIds(market: CatalogMarket) {
  return catalogV2SourceIds(market);
}

export function catalogV2KnowledgeSourceIds(_market: CatalogMarket) {
  return [];
}

function assertExactAllowedSources() {
  const failures: string[] = [];

  for (const [marketName, requiredSources] of Object.entries(REQUIRED_CATALOG_SOURCES)) {
    const market = marketName as CatalogMarket;
    const registered = CATALOG_V2_SOURCE_SLOTS[market];
    const expectedIds = requiredSources.map((source) => source.sourceId);
    const actualIds = registered.map((source) => source.sourceId);

    if (registered.length !== requiredSources.length) {
      failures.push(`${market}:unexpected_source_count:${registered.length}:${requiredSources.length}`);
    }
    if (actualIds.join("|") !== expectedIds.join("|")) {
      failures.push(`${market}:source_order_or_membership_changed`);
    }

    for (const required of requiredSources as readonly RequiredCatalogSource[]) {
      const source = registered.find((candidate) => candidate.sourceId === required.sourceId);
      if (!source) {
        failures.push(`${market}:${required.sourceId}:missing`);
        continue;
      }
      if (source.canonicalUrl !== required.canonicalUrl) failures.push(`${market}:${required.sourceId}:url_changed`);
      if (!source.required || !source.anchor) failures.push(`${market}:${required.sourceId}:not_required`);
      if (!sourceIsCollectible(source)) failures.push(`${market}:${required.sourceId}:excluded_from_collection`);
    }
  }

  if (failures.length) throw new Error(`catalog_strict_source_allowlist_broken:${failures.join(",")}`);
}

export function assertCatalogV2SourceRegistry() {
  assertExactAllowedSources();
  return true;
}

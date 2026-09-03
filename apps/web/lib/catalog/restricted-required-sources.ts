import type { CatalogFetchResult, CatalogImage, CatalogMarket, CatalogSourceAdapter, OfferStatus, SourceRunHealth, VehicleOffer } from "./types";

type RestrictedSourceConfig = {
  sourceId: string;
  market: CatalogMarket;
  reason: string;
  observedHttpStatus: number;
};

function restrictedSourceError(config: RestrictedSourceConfig) {
  const error = new Error(config.reason) as Error & { blocked?: boolean; status?: number };
  error.blocked = true;
  error.status = config.observedHttpStatus;
  return error;
}

class RestrictedRequiredSourceAdapter implements CatalogSourceAdapter {
  sourceId: string;
  market: CatalogMarket;
  accessMode = "partner_feed" as const;

  constructor(private readonly config: RestrictedSourceConfig) {
    this.sourceId = config.sourceId;
    this.market = config.market;
  }

  async fetchPage(): Promise<CatalogFetchResult> {
    throw restrictedSourceError(this.config);
  }

  normalizeOffer(_raw: unknown): VehicleOffer | null {
    return null;
  }

  async fetchImages(_offer: VehicleOffer): Promise<CatalogImage[]> {
    return [];
  }

  mapStatus(): OfferStatus {
    return "active";
  }

  async healthCheck(): Promise<SourceRunHealth> {
    return {
      ok: false,
      blocked: true,
      message: this.config.reason,
      checkedAt: new Date().toISOString(),
      httpStatus: this.config.observedHttpStatus,
    };
  }
}

export const dongchediRestrictedSource = new RestrictedRequiredSourceAdapter({
  sourceId: "dongchedi_china_open",
  market: "china",
  reason: "dongchedi_public_inventory_requires_login_or_permitted_partner_feed",
  observedHttpStatus: 200,
});

export const auctionDataSearchRestrictedSource = new RestrictedRequiredSourceAdapter({
  sourceId: "auctiondatasearch_japan_open",
  market: "japan",
  reason: "auctiondatasearch_search_and_statistics_require_login_or_permitted_partner_feed",
  observedHttpStatus: 200,
});

export const jpCenterRestrictedSource = new RestrictedRequiredSourceAdapter({
  sourceId: "jpcenter_japan_catalog_open",
  market: "japan",
  reason: "jpcenter_exact_vehicle_price_and_full_gallery_require_login_or_permitted_partner_feed",
  observedHttpStatus: 200,
});

export const prestigeJapanRestrictedSource = new RestrictedRequiredSourceAdapter({
  sourceId: "prestige_japan_auctions_open",
  market: "japan",
  reason: "prestige_exact_auction_details_are_robots_disallowed_and_turnstile_blocked_partner_feed_required",
  observedHttpStatus: 403,
});

export const restrictedRequiredSources: CatalogSourceAdapter[] = [
  dongchediRestrictedSource,
  auctionDataSearchRestrictedSource,
  jpCenterRestrictedSource,
  prestigeJapanRestrictedSource,
];

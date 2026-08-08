import { scaleMarketSources } from "./scale-market-sources";
import type { CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

const AUCTION_STAT_SOURCE_IDS = new Set([
  "jpauc_japan_past_open",
  "carvector_japan_stat_open",
]);

function verifiedResultPrice(offer: VehicleOffer) {
  const operational = offer.operational as (VehicleOffer["operational"] & {
    auctionResultPriceVerified?: boolean;
    auctionPriceKind?: string;
    raw?: Record<string, unknown>;
  }) | undefined;
  const raw = operational?.raw || {};
  return Boolean(
    operational?.auctionResultPriceVerified === true
      || raw.auctionResultPriceVerified === true
      || raw.resultPriceVerified === true
      || operational?.auctionPriceKind === "published_result",
  );
}

class AuctionStatisticsWrapper implements CatalogSourceAdapter {
  sourceId: string;
  market = "japan" as const;
  accessMode: CatalogSourceAdapter["accessMode"];

  constructor(private readonly base: CatalogSourceAdapter) {
    this.sourceId = base.sourceId;
    this.accessMode = base.accessMode;
  }

  fetchPage(cursor?: string | null, updatedSince?: string) {
    return this.base.fetchPage(cursor, updatedSince);
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const offer = this.base.normalizeOffer(raw);
    if (!offer?.sourcePrice || !offer.sourceCurrency) return null;
    const verified = verifiedResultPrice(offer);
    return {
      ...offer,
      offerType: "auction",
      status: verified ? "sold" : "active",
      catalogKind: verified ? "auction_result" : "listing",
      auctionResult: verified ? "sold" : undefined,
      auctionPriceKind: verified ? "published_result" : undefined,
      calculationStatus: offer.calculationStatus || "needs_data",
      operational: {
        ...offer.operational,
        sourceVenueName: offer.operational?.sourceVenueName || this.sourceId,
        auctionStatistics: true,
        auctionResultPriceVerified: verified,
        auctionStatus: verified ? "completed_price_verified" : "price_semantics_unverified",
      },
    };
  }

  fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    return this.base.fetchImages(offer);
  }

  mapStatus(): OfferStatus {
    // Per-offer final status is resolved only after final-price verification.
    return "active";
  }

  healthCheck() {
    return this.base.healthCheck();
  }
}

export const additionalJapanAuctionStatisticsSources: CatalogSourceAdapter[] = scaleMarketSources
  .filter((source) => AUCTION_STAT_SOURCE_IDS.has(source.sourceId))
  .map((source) => new AuctionStatisticsWrapper(source));

import { scaleMarketSources } from "./scale-market-sources";
import type { CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

const AUCTION_STAT_SOURCE_IDS = new Set([
  "jpauc_japan_past_open",
  "carvector_japan_stat_open",
]);

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
    return {
      ...offer,
      offerType: "auction",
      status: "active",
      catalogKind: "auction_result",
      auctionResult: "sold",
      // Generic public HTML can expose an end price or another published result.
      // Do not claim a hammer price until the source parser proves the label.
      auctionPriceKind: "published_result",
      calculationStatus: offer.calculationStatus || "needs_data",
      operational: {
        ...offer.operational,
        sourceVenueName: offer.operational?.sourceVenueName || this.sourceId,
        auctionStatistics: true,
      },
    };
  }

  fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    return this.base.fetchImages(offer);
  }

  mapStatus(): OfferStatus {
    return "active";
  }

  healthCheck() {
    return this.base.healthCheck();
  }
}

export const additionalJapanAuctionStatisticsSources: CatalogSourceAdapter[] = scaleMarketSources
  .filter((source) => AUCTION_STAT_SOURCE_IDS.has(source.sourceId))
  .map((source) => new AuctionStatisticsWrapper(source));

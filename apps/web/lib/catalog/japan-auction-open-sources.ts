import { OpenMarketAdapter, type OpenMarketSourceConfig } from "./open-market-sources";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

type JapanAuctionFeedKind = "upcoming" | "past";

function pageUrl(base: string, page: number) {
  const url = new URL(base);
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

class JapanAuctionFeedAdapter implements CatalogSourceAdapter {
  sourceId: string;
  market = "japan" as const;
  accessMode: CatalogSourceAdapter["accessMode"];

  constructor(
    private readonly base: CatalogSourceAdapter,
    private readonly kind: JapanAuctionFeedKind,
    private readonly venue: string,
  ) {
    this.sourceId = base.sourceId;
    this.accessMode = base.accessMode;
  }

  fetchPage(cursor?: string | null, updatedSince?: string): Promise<CatalogFetchResult> {
    return this.base.fetchPage(cursor, updatedSince);
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const offer = this.base.normalizeOffer(raw);
    if (!offer?.sourcePrice || !offer.sourceCurrency) return null;
    const completed = this.kind === "past";
    return {
      ...offer,
      offerType: "auction",
      status: completed ? "sold" : "active",
      catalogKind: completed ? "auction_result" : "listing",
      auctionResult: completed ? "sold" : undefined,
      auctionPriceKind: completed ? "published_result" : undefined,
      priceMode: completed ? "fixed" : "auction_start",
      calculationStatus: completed ? offer.calculationStatus : "auction_start",
      operational: {
        ...offer.operational,
        sourceVenueName: offer.operational?.sourceVenueName || this.venue,
        auctionStatus: completed ? "completed" : "upcoming",
        auctionFeed: true,
      },
    };
  }

  fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    return this.base.fetchImages(offer);
  }

  mapStatus(): OfferStatus {
    return this.kind === "past" ? "sold" : "active";
  }

  healthCheck() {
    return this.base.healthCheck();
  }
}

const configs: Array<{ config: OpenMarketSourceConfig; kind: JapanAuctionFeedKind; venue: string }> = [
  {
    config: {
      sourceId: "auctions22_japan_upcoming_open",
      market: "japan",
      label: "Auctions22 upcoming Japan auctions",
      baseUrl: "https://auctions22.com",
      currency: "USD",
      listUrls: (page) => [pageUrl("https://auctions22.com/upcoming", page)],
      detailPattern: /\/lot\/[a-f0-9]{16,}(?:[/?#]|$)/i,
      referer: "https://auctions22.com/upcoming",
    },
    kind: "upcoming",
    venue: "Auctions22 Japan auctions",
  },
  {
    config: {
      sourceId: "auctions22_japan_past_open",
      market: "japan",
      label: "Auctions22 past Japan auctions",
      baseUrl: "https://auctions22.com",
      currency: "USD",
      listUrls: (page) => [pageUrl("https://auctions22.com/past", page)],
      detailPattern: /\/lot\/[a-f0-9]{16,}(?:[/?#]|$)/i,
      referer: "https://auctions22.com/past",
    },
    kind: "past",
    venue: "Auctions22 Japan auction results",
  },
  {
    config: {
      sourceId: "jpauc_japan_current_open",
      market: "japan",
      label: "JPAuc current Japan auctions",
      baseUrl: "https://jpauc.com",
      currency: "JPY",
      listUrls: (page) => [pageUrl("https://jpauc.com/auction", page)],
      detailPattern: /\/auction\/(?!past(?:[/?#]|$)|listing-?\d+\/?$)[^?#]*(?:lot|vehicle|car)[^?#]*/i,
      referer: "https://jpauc.com/auction",
    },
    kind: "upcoming",
    venue: "JPAuc Japan auctions",
  },
];

export const japanAuctionOpenSources: CatalogSourceAdapter[] = configs.map(({ config, kind, venue }) =>
  new JapanAuctionFeedAdapter(new OpenMarketAdapter(config), kind, venue),
);

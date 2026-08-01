import { OpenMarketAdapter, type OpenMarketSourceConfig } from "./open-market-sources";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

type JapanAuctionFeedKind = "upcoming" | "past";

function pageUrl(base: string, page: number, key = "page") {
  const url = new URL(base);
  if (page > 1) url.searchParams.set(key, String(page));
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
      sourceId: "jpauc_japan_current_open",
      market: "japan",
      label: "JPAuc current Japan auctions",
      baseUrl: "https://jpauc.com",
      currency: "JPY",
      // /auction is only the date selector. The actual public result list is /auction/listing.
      listUrls: (page) => [
        pageUrl("https://jpauc.com/auction/listing", page),
        pageUrl("https://www.jpauc.com/auction/listing", page),
      ],
      detailPattern: /\/auction\/detail\/\d+(?:[/?#]|$)/i,
      referer: "https://jpauc.com/auction",
    },
    kind: "upcoming",
    venue: "JPAuc Japan auctions",
  },
  {
    config: {
      sourceId: "jpauc_japan_past_open",
      market: "japan",
      label: "JPAuc completed Japan auctions",
      baseUrl: "https://jpauc.com",
      currency: "JPY",
      listUrls: (page) => [
        page <= 1 ? "https://jpauc.com/auction/past" : `https://jpauc.com/auction/past/listing-${page}`,
        pageUrl("https://jpauc.com/auction/listing", page),
      ],
      detailPattern: /\/auction\/detail\/\d+(?:[/?#]|$)/i,
      referer: "https://jpauc.com/auction/past",
    },
    kind: "past",
    venue: "JPAuc completed auction results",
  },
  {
    config: {
      sourceId: "auctiondatasearch_japan_open",
      market: "japan",
      label: "Auction Data Search Japan",
      baseUrl: "https://www.auctiondatasearch.jp",
      currency: "JPY",
      listUrls: (page) => [
        pageUrl("https://www.auctiondatasearch.jp/", page),
        pageUrl("https://www.auctiondatasearch.jp/search", page),
      ],
      detailPattern: /\/(?:auction|vehicle|car|result|detail)\/[^?#]{4,}/i,
      referer: "https://www.auctiondatasearch.jp/",
    },
    kind: "past",
    venue: "Auction Data Search Japan",
  },
  // Дополнительный резервный источник. Он не заменяет пять эталонных площадок.
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
];

export const japanAuctionOpenSources: CatalogSourceAdapter[] = configs.map(({ config, kind, venue }) =>
  new JapanAuctionFeedAdapter(new OpenMarketAdapter(config), kind, venue),
);

import { OpenMarketAdapter, type OpenMarketSourceConfig } from "./open-market-sources";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

type JapanAuctionFeedKind = "upcoming" | "past";

const BAD_IMAGE_RE = /logo|favicon|icon|sprite|banner|placeholder|avatar|tracking|pixel|cookie|qrcode|qr-code|no[-_ ]?photo|no[-_ ]?image/i;

function pageUrl(base: string, page: number, key = "page") {
  const url = new URL(base);
  if (page > 1) url.searchParams.set(key, String(page));
  return url.toString();
}

function absoluteImageUrl(value: unknown, baseUrl: string) {
  const raw = String(value || "").trim().replace(/\\\//g, "/");
  if (!raw || /^(?:data:|javascript:)/i.test(raw)) return "";
  try {
    const url = new URL(raw, baseUrl).toString();
    return /^https?:/i.test(url) && !BAD_IMAGE_RE.test(url) ? url : "";
  } catch {
    return "";
  }
}

function remoteImage(url: string): CatalogImage {
  const extension = url.match(/\.(jpe?g|webp|avif|png)(?:[?#]|$)/i)?.[1]?.toLowerCase();
  const mimeType = extension === "png"
    ? "image/png"
    : extension === "webp"
      ? "image/webp"
      : extension === "avif"
        ? "image/avif"
        : "image/jpeg";
  return { id: "", url, objectKey: "", size: 0, checksum: "", mimeType };
}

function rawAuctionImageUrls(offer: VehicleOffer) {
  const raw = offer.operational?.raw as Record<string, unknown> | undefined;
  const values = [raw?.images, raw?.photos, raw?.gallery, raw?.imageUrls, raw?.photoUrls];
  return values.flatMap((value) => Array.isArray(value) ? value : [])
    .map((value) => typeof value === "string" ? value : (value as any)?.url || (value as any)?.src || (value as any)?.original || "")
    .map((value) => absoluteImageUrl(value, String(offer.operational?.sourceUrl || "https://jpauc.com")))
    .filter(Boolean);
}

async function remoteAuctionImages(offer: VehicleOffer) {
  const sourceUrl = String(offer.operational?.sourceUrl || "");
  const urls = new Set(rawAuctionImageUrls(offer));
  if (sourceUrl) {
    try {
      const response = await fetch(sourceUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(Math.max(5_000, Number(process.env.CATALOG_IMAGE_TIMEOUT_MS || 20_000))),
        headers: {
          accept: "text/html,application/xhtml+xml,image/avif,image/webp,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9,ja;q=0.8,ru;q=0.7",
          referer: new URL(sourceUrl).origin,
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
        },
      });
      if (response.ok) {
        const markup = await response.text();
        for (const match of markup.matchAll(/<(?:img|source)[^>]+(?:data-original|data-lazy-src|data-src|src)\s*=\s*["']([^"']+)["']/gi)) {
          const url = absoluteImageUrl(match[1], sourceUrl);
          if (url) urls.add(url);
        }
        for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) {
          const url = absoluteImageUrl(match[0], sourceUrl);
          if (url) urls.add(url);
        }
      }
    } catch {
      // Сбой кэширования или hotlink-защита не должны удалять сам реальный лот.
    }
  }
  return [...urls].slice(0, Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30))).map(remoteImage);
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

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const cached = await this.base.fetchImages(offer).catch(() => []);
    if (cached.length) return cached;
    return remoteAuctionImages(offer);
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

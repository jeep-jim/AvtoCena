import { cacheImageFromUrl, stableOfferId } from "./storage";
import type { CatalogFetchResult, CatalogImage, CatalogMarket, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

const BLOCK_RE = /captcha|challenge|access denied|forbidden|cloudflare/i;
const SOURCE_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.8",
  "user-agent": "AvtoCenaCatalog/1.0 (+https://avtocena.com)",
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function numberValue(value: unknown) {
  const number = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function nowIso() {
  return new Date().toISOString();
}

function blockedError(message: string, status?: number) {
  const error = new Error(message) as Error & { blocked?: boolean; status?: number };
  error.blocked = true;
  error.status = status;
  return error;
}

async function fetchHtml(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 20_000));
  try {
    const response = await fetch(url, { headers: SOURCE_HEADERS, signal: controller.signal });
    const html = await response.text();
    if ([401, 403, 429].includes(response.status) || BLOCK_RE.test(html.slice(0, 800))) {
      throw blockedError(`beforward_blocked_${response.status}`, response.status);
    }
    if (!response.ok) throw new Error(`beforward_http_${response.status}`);
    return { response, html };
  } finally {
    clearTimeout(timeout);
  }
}

function absoluteUrl(value: string) {
  if (!value) return "";
  try {
    return new URL(value, "https://www.beforward.jp").toString();
  } catch {
    return "";
  }
}

function valueAfterLabel(plain: string, label: string, stopLabels: string[]) {
  const stop = stopLabels.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = plain.match(new RegExp(`${label}\\s+(.+?)(?=\\s+(?:${stop})\\b|$)`, "i"));
  return text(match?.[1]);
}

function collectVehicleChunks(html: string) {
  const refs = [...html.matchAll(/Ref\.?\s*No\.?[\s\S]{0,180}?([A-Z]{2}\d{5,})/gi)];
  const chunks: Array<{ refNo: string; html: string }> = [];
  const seen = new Set<string>();

  refs.forEach((match, index) => {
    const refNo = text(match[1]).toUpperCase();
    if (!refNo || seen.has(refNo)) return;
    seen.add(refNo);
    const current = match.index || 0;
    const previous = index > 0 ? refs[index - 1].index || 0 : 0;
    const next = index + 1 < refs.length ? refs[index + 1].index || html.length : html.length;
    const start = Math.max(previous, current - 6_000);
    const end = Math.min(next, current + 12_000);
    chunks.push({ refNo, html: html.slice(start, end) });
  });

  if (chunks.length) return chunks;

  return (html.match(/<article[\s\S]*?<\/article>/gi) || []).map((card) => ({
    refNo: text(card.match(/([A-Z]{2}\d{5,})/i)?.[1]).toUpperCase(),
    html: card,
  }));
}

export type BeForwardRow = {
  refNo: string;
  title: string;
  make: string;
  model: string;
  year: string;
  mileage: string;
  engine: string;
  transmission: string;
  fuel: string;
  drive: string;
  body: string;
  location: string;
  price: string;
  auctionGrade: string;
  images: string[];
  detailUrl: string;
  status: string;
};

export function parseBeForwardMarketStocklist(html: string): BeForwardRow[] {
  const rows = collectVehicleChunks(html).map(({ refNo, html: card }) => {
    const plain = stripHtml(card);
    const titleFromRef = plain.match(new RegExp(`Ref\\.?\\s*No\\.?\\s*${refNo}\\s+(?:\\d+\\s+pts\\s+)?((?:19|20)\\d{2}\\s+.{2,140}?)(?=\\s+(?:Mileage|Price|\\$|SOLD|UNDER OFFER)\\b)`, "i"))?.[1];
    const titleFromHeading = stripHtml(card.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1] || "");
    const titleFromLink = stripHtml(card.match(/<a[^>]+href="[^"]*(?:stocklist|vehicle)[^"]*"[^>]*>([\s\S]{0,500}?(?:19|20)\d{2}[\s\S]{0,250}?)<\/a>/i)?.[1] || "");
    const title = text(titleFromRef || titleFromHeading || titleFromLink).replace(/^(?:\d+\s+pts\s+)?/i, "");
    const titleWithoutYear = title.replace(/^(?:19|20)\d{2}(?:\/\d+)?\s+/, "").trim();
    const titleParts = titleWithoutYear.split(/\s+/).filter(Boolean);
    const make = titleParts[0] || "";
    const model = titleParts.slice(1, 3).join(" ");
    const year = text(title.match(/(?:19|20)\d{2}/)?.[0] || valueAfterLabel(plain, "Year", ["Engine", "Trans", "Location", "Model code"]));
    const mileage = valueAfterLabel(plain, "Mileage", ["Year", "Engine", "Trans", "Location", "Model code"]);
    const engine = valueAfterLabel(plain, "Engine", ["Trans", "Location", "Model code", "Steering", "Fuel"]);
    const transmission = valueAfterLabel(plain, "Trans\\.?", ["Location", "Model code", "Steering", "Fuel"]);
    const location = valueAfterLabel(plain, "Location", ["Model code", "Steering", "Fuel", "Seats", "Engine code", "Auction grade", "Price", "Inquiry"]);
    const fuel = text(plain.match(/\bFuel\s+([^\s]+(?:\([^)]*\))?)/i)?.[1]);
    const drive = text(plain.match(/\bDrive\s+([24]WD|AWD|FWD|RWD|-)/i)?.[1]);
    const body = text(plain.match(/\bBody(?:\s+Type)?\s+([A-Za-z -]{2,30}?)(?=\s+(?:Mileage|Year|Engine|Trans|Location|Model code|$))/i)?.[1]);
    const auctionGrade = text(plain.match(/Auction grade\s+([^\s]+)/i)?.[1]);
    const price = text(plain.match(/\bPrice\s+\$\s*([0-9,]+)/i)?.[1] || plain.match(/\$\s*([0-9,]+)/)?.[1]);
    const status = /\bSOLD\b/i.test(plain) ? "sold" : /UNDER OFFER/i.test(plain) ? "stale" : "active";
    const imageUrls = [...card.matchAll(/<img[^>]+(?:data-src|data-original|src)="([^"]+)"/gi)]
      .map((match) => absoluteUrl(match[1]))
      .filter((url) => /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url) && !/cookie|icon|logo|flag|banner/i.test(url));
    const hrefs = [...card.matchAll(/href="([^"]+)"/gi)].map((match) => match[1]);
    const detailHref = hrefs.find((href) => href.toUpperCase().includes(refNo)) || hrefs.find((href) => /\/(?:stocklist|vehicle)\//i.test(href)) || "";

    return {
      refNo,
      title,
      make,
      model,
      year,
      mileage,
      engine,
      transmission,
      fuel,
      drive,
      body,
      location,
      price,
      auctionGrade,
      images: [...new Set(imageUrls)].slice(0, 12),
      detailUrl: absoluteUrl(detailHref),
      status,
    } satisfies BeForwardRow;
  });

  return rows.filter((row) => row.refNo && row.title && row.year && row.images.length > 0);
}

type BeForwardSourceConfig = {
  sourceId: string;
  market: CatalogMarket;
  stockCountryId: number;
  label: string;
};

export class BeForwardMarketAdapter implements CatalogSourceAdapter {
  sourceId: string;
  market: CatalogMarket;
  accessMode = "public_html" as const;
  private stockCountryId: number;
  private label: string;

  constructor(config: BeForwardSourceConfig) {
    this.sourceId = config.sourceId;
    this.market = config.market;
    this.stockCountryId = config.stockCountryId;
    this.label = config.label;
  }

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const base = process.env[`CATALOG_${this.sourceId.toUpperCase()}_LIST_URL`] || `https://www.beforward.jp/stocklist/stock_country%3D${this.stockCountryId}/sortkey%3Dn`;
    const url = new URL(base);
    url.searchParams.set("page", String(page));
    const { response, html } = await fetchHtml(url.toString());
    const items = parseBeForwardMarketStocklist(html);
    return {
      items,
      nextCursor: items.length ? String(page + 1) : null,
      finished: !items.length,
      count: items.length,
      health: {
        ok: items.length > 0,
        message: `${this.label}: parsed ${items.length}`,
        checkedAt: nowIso(),
        httpStatus: response.status,
        contentType: response.headers.get("content-type") || "",
      },
    };
  }

  mapStatus(raw: BeForwardRow): OfferStatus {
    return raw.status === "sold" ? "sold" : raw.status === "stale" ? "stale" : "active";
  }

  normalizeOffer(raw: BeForwardRow): VehicleOffer | null {
    const sourceOfferId = text(raw.refNo);
    const make = text(raw.make);
    const model = text(raw.model);
    const year = Number(text(raw.year).match(/\d{4}/)?.[0]);
    if (!sourceOfferId || !make || !model || !year) return null;
    const sourcePrice = numberValue(raw.price) || null;
    const timestamp = nowIso();
    return {
      id: stableOfferId(this.sourceId, sourceOfferId),
      sourceId: this.sourceId,
      sourceOfferId,
      market: this.market,
      offerType: "fixed",
      status: this.mapStatus(raw),
      make,
      model,
      trim: text(raw.title),
      year,
      mileageKm: numberValue(raw.mileage),
      engineCc: numberValue(raw.engine),
      fuel: text(raw.fuel),
      transmission: text(raw.transmission),
      drive: text(raw.drive),
      bodyType: text(raw.body),
      sourcePrice,
      sourceCurrency: sourcePrice ? "USD" : null,
      priceMode: sourcePrice ? "fixed" : "estimated",
      images: [],
      totalRub: null,
      calculationStatus: sourcePrice ? "ready" : "needs_data",
      firstSeenAt: timestamp,
      updatedAt: timestamp,
      auctionGrade: text(raw.auctionGrade),
      operational: {
        sourceUrl: text(raw.detailUrl),
        sourceVenueName: text(raw.location || this.label),
        raw,
      },
    };
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const raw = (offer.operational.raw || {}) as BeForwardRow;
    const limit = Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 10);
    const saved: CatalogImage[] = [];
    for (const url of (raw.images || []).slice(0, limit)) {
      const image = await cacheImageFromUrl(url, offer.market, { headers: SOURCE_HEADERS }).catch(() => null);
      if (image) saved.push(image);
    }
    return saved;
  }

  async healthCheck() {
    return { ok: true, message: `${this.label}: health is recorded during import`, checkedAt: nowIso() };
  }
}

export const publicMarketSources: CatalogSourceAdapter[] = [
  new BeForwardMarketAdapter({ sourceId: "beforward_japan", market: "japan", stockCountryId: 47, label: "BE FORWARD Japan" }),
  new BeForwardMarketAdapter({ sourceId: "beforward_uae", market: "uae", stockCountryId: 44, label: "BE FORWARD UAE" }),
  new BeForwardMarketAdapter({ sourceId: "beforward_uk", market: "europe", stockCountryId: 45, label: "BE FORWARD United Kingdom" }),
  new BeForwardMarketAdapter({ sourceId: "beforward_belgium", market: "europe", stockCountryId: 111, label: "BE FORWARD Belgium" }),
];

export const PUBLIC_CATALOG_SOURCE_IDS = [
  "encar_direct",
  "che168_global",
  ...publicMarketSources.map((source) => source.sourceId),
];

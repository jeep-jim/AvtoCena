import { cacheImageFromUrl, stableOfferId } from "./storage";
import type { CatalogFetchResult, CatalogImage, CatalogMarket, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

const BLOCK_RE = /captcha|challenge|access denied|forbidden|cloudflare/i;
const SOURCE_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  referer: "https://www.beforward.jp/stocklist",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
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
    const response = await fetch(url, { headers: SOURCE_HEADERS, signal: controller.signal, redirect: "follow" });
    const html = await response.text();
    if ([401, 403, 429].includes(response.status) || BLOCK_RE.test(html.slice(0, 1_200))) {
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
  const refs = [...html.matchAll(/Ref\.?\s*No\.?[\s\S]{0,220}?([A-Z]{1,4}-?\d{4,})/gi)];
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
    const end = Math.min(next, current + 14_000);
    chunks.push({ refNo, html: html.slice(start, end) });
  });

  if (chunks.length) return chunks;

  return (html.match(/<article[\s\S]*?<\/article>/gi) || []).map((card) => ({
    refNo: text(card.match(/([A-Z]{1,4}-?\d{4,})/i)?.[1]).toUpperCase(),
    html: card,
  }));
}

function collectImageUrls(markup: string) {
  const candidates: string[] = [];
  for (const match of markup.matchAll(/<img[^>]+(?:data-src|data-original|data-lazy|src)\s*=\s*["']([^"']+)["']/gi)) {
    candidates.push(match[1]);
  }
  for (const match of markup.matchAll(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi)) {
    for (const item of match[1].split(",")) candidates.push(item.trim().split(/\s+/)[0]);
  }
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp)(?:\?[^"'\\\s<>]*)?/gi)) {
    candidates.push(match[0].replace(/\\\//g, "/"));
  }

  return candidates
    .map((value) => value.replace(/&amp;/gi, "&"))
    .map(absoluteUrl)
    .filter((url) => /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url) && !/cookie|icon|logo|flag|banner|sprite|placeholder/i.test(url));
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
    const titleFromLink = stripHtml(card.match(/<a[^>]+href\s*=\s*["'][^"']*(?:stocklist|vehicle)[^"']*["'][^>]*>([\s\S]{0,700}?(?:19|20)\d{2}[\s\S]{0,350}?)<\/a>/i)?.[1] || "");
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
    const imageUrls = collectImageUrls(card);
    const hrefs = [...card.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
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
      images: [...new Set(imageUrls)].slice(0, 16),
      detailUrl: absoluteUrl(detailHref),
      status,
    } satisfies BeForwardRow;
  });

  return rows.filter((row) => row.refNo && row.title && row.year);
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

  private stockUrls(page: number) {
    const configured = process.env[`CATALOG_${this.sourceId.toUpperCase()}_LIST_URL`];
    const pathUrl = new URL(configured || `https://www.beforward.jp/stocklist/stock_country=${this.stockCountryId}/sortkey=n`);
    pathUrl.searchParams.set("page", String(page));

    const queryUrl = new URL("https://www.beforward.jp/stocklist");
    queryUrl.searchParams.set("stock_country", String(this.stockCountryId));
    queryUrl.searchParams.set("sortkey", "n");
    queryUrl.searchParams.set("page", String(page));

    return configured ? [pathUrl] : [pathUrl, queryUrl];
  }

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    let finalResponse: Response | null = null;
    let finalHtml = "";
    let items: BeForwardRow[] = [];

    for (const url of this.stockUrls(page)) {
      const { response, html } = await fetchHtml(url.toString());
      finalResponse = response;
      finalHtml = html;
      items = parseBeForwardMarketStocklist(html);
      if (items.length) break;
    }

    if (!items.length) {
      throw new Error(`beforward_parsed_zero_${this.sourceId}_status_${finalResponse?.status || 0}_bytes_${finalHtml.length}`);
    }

    return {
      items,
      nextCursor: String(page + 1),
      finished: false,
      count: items.length,
      health: {
        ok: true,
        message: `${this.label}: parsed ${items.length}`,
        checkedAt: nowIso(),
        httpStatus: finalResponse?.status,
        contentType: finalResponse?.headers.get("content-type") || "",
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
    let urls = [...(raw.images || [])];

    if (raw.detailUrl && urls.length < limit) {
      try {
        const { html } = await fetchHtml(raw.detailUrl);
        urls = [...urls, ...collectImageUrls(html)];
      } catch {
        // The stock-list images are still usable when a detail page is temporarily unavailable.
      }
    }

    const saved: CatalogImage[] = [];
    for (const url of [...new Set(urls)].slice(0, limit)) {
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

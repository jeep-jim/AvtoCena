import { cacheImageFromUrl, stableOfferId } from "./storage";
import type { CatalogFetchResult, CatalogImage, CatalogMarket, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

const SBT_BASE_URL = "https://www.sbtjapan.com";
const BLOCK_RE = /captcha|challenge|access denied|forbidden|cloudflare|temporarily unavailable/i;
const SBT_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  referer: "https://www.sbtjapan.com/used-cars/search",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function numberValue(value: unknown) {
  const number = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function decodeHtml(value: string) {
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

function absoluteUrl(value: string) {
  if (!value || /^(?:data:|javascript:)/i.test(value)) return "";
  try {
    return new URL(value.replace(/\\\//g, "/"), SBT_BASE_URL).toString();
  } catch {
    return "";
  }
}

function firstValue(object: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = object[key];
    if (value !== undefined && value !== null && text(value)) return value;
  }
  return undefined;
}

function nestedValue(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return firstValue(value as Record<string, unknown>, keys);
}

function collectObjects(value: unknown, result: Record<string, unknown>[], depth = 0) {
  if (depth > 10 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, result, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  result.push(object);
  for (const child of Object.values(object)) collectObjects(child, result, depth + 1);
}

function collectImageUrls(value: unknown): string[] {
  const candidates: string[] = [];
  const visit = (current: unknown, depth = 0) => {
    if (depth > 6 || current == null) return;
    if (typeof current === "string") {
      if (/\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(current) || /image|photo|picture/i.test(current)) candidates.push(current);
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
      return;
    }
    if (typeof current === "object") {
      for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
        if (/image|photo|picture|thumb|src|url/i.test(key)) visit(child, depth + 1);
      }
    }
  };
  visit(value);
  return [...new Set(candidates.map((item) => absoluteUrl(item)).filter((url) =>
    /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url) && !/logo|icon|flag|banner|sprite|placeholder|avatar/i.test(url),
  ))];
}

export type SbtRow = {
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
  images: string[];
  detailUrl: string;
  status: string;
};

function rowFromObject(object: Record<string, unknown>): SbtRow | null {
  const brandValue = firstValue(object, ["brand", "make", "maker", "manufacturer", "vehicleMake"]);
  const brand = typeof brandValue === "object"
    ? text(nestedValue(brandValue, ["name", "title", "label", "value"]))
    : text(brandValue);
  const modelValue = firstValue(object, ["model", "modelName", "vehicleModel", "series", "seriesName"]);
  const model = typeof modelValue === "object"
    ? text(nestedValue(modelValue, ["name", "title", "label", "value"]))
    : text(modelValue);
  const title = text(firstValue(object, ["name", "title", "vehicleName", "carName", "productName", "displayName"]));
  const detailUrl = absoluteUrl(text(firstValue(object, ["url", "detailUrl", "link", "href", "canonicalUrl"]))) ||
    absoluteUrl(text(nestedValue(firstValue(object, ["offers", "offer"]), ["url", "link"])));
  const refNo = text(firstValue(object, ["stockNo", "stockNumber", "stock_id", "stockId", "refNo", "reference", "sku", "productID", "vehicleId", "id"])) ||
    text(detailUrl.match(/\/([a-z0-9-]{5,})(?:[/?#]|$)/i)?.[1]);
  const year = text(firstValue(object, ["year", "modelYear", "registrationYear", "manufactureYear"])) || text(title.match(/(?:19|20)\d{2}/)?.[0]);
  const cleanTitle = title.replace(/^(?:19|20)\d{2}(?:\/\d+)?\s+/, "").trim();
  const titleParts = cleanTitle.split(/\s+/).filter(Boolean);
  const make = brand || titleParts[0] || "";
  const derivedModel = titleParts[0]?.toLowerCase() === make.toLowerCase() ? titleParts.slice(1, 3).join(" ") : titleParts.slice(0, 2).join(" ");
  const resolvedModel = model || derivedModel;
  if (!refNo || !make || !resolvedModel || !year) return null;

  const offers = firstValue(object, ["offers", "offer"]);
  const price = text(firstValue(object, ["price", "vehiclePrice", "fobPrice", "salePrice"])) ||
    text(nestedValue(offers, ["price", "lowPrice", "highPrice"]));
  const description = text(firstValue(object, ["description", "summary", "specification", "specs"]));
  const mileage = text(firstValue(object, ["mileage", "mileageKm", "odometer"])) || text(description.match(/(?:Mileage|Odometer)\s*[:\-]?\s*([0-9,]+\s*km)/i)?.[1]);
  const engine = text(firstValue(object, ["engine", "engineCc", "displacement"])) || text(description.match(/(?:Engine|Displacement)\s*[:\-]?\s*([0-9,.]+\s*(?:cc|L))/i)?.[1]);
  const images = collectImageUrls({
    image: firstValue(object, ["image", "images", "photos", "pictures", "photoList", "imageList"]),
    object,
  });

  return {
    refNo: refNo.toUpperCase(),
    title: title || `${year} ${make} ${resolvedModel}`,
    make,
    model: resolvedModel,
    year,
    mileage,
    engine,
    transmission: text(firstValue(object, ["transmission", "gearbox", "trans"])),
    fuel: text(firstValue(object, ["fuel", "fuelType"])),
    drive: text(firstValue(object, ["drive", "drivetrain", "driveType"])),
    body: text(firstValue(object, ["body", "bodyType", "vehicleType", "category"])),
    location: text(firstValue(object, ["location", "inventoryLocation", "country", "yard"])),
    price,
    images,
    detailUrl,
    status: /sold|unavailable|reserved/i.test(text(firstValue(object, ["status", "availability"]))) ? "sold" : "active",
  };
}

function parseJsonRows(html: string) {
  const objects: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/<script[^>]*(?:type=["']application\/ld\+json["']|id=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      collectObjects(JSON.parse(match[1].trim()), objects);
    } catch {
      // Ignore an individual malformed script and continue with the HTML fallback.
    }
  }
  return objects.map(rowFromObject).filter((row): row is SbtRow => Boolean(row));
}

function parseHtmlRows(html: string) {
  const matches = [...html.matchAll(/href\s*=\s*["']([^"']*\/used-cars\/(?!search)[^"'#?]+[^"']*)["']/gi)];
  return matches.map((match, index) => {
    const href = match[1];
    const current = match.index || 0;
    const previous = index ? matches[index - 1].index || 0 : 0;
    const next = index + 1 < matches.length ? matches[index + 1].index || html.length : html.length;
    const card = html.slice(Math.max(previous, current - 5_000), Math.min(next, current + 12_000));
    const plain = decodeHtml(card);
    const detailUrl = absoluteUrl(href);
    const title = decodeHtml(card.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1] || "") ||
      text(card.match(/<img[^>]+alt\s*=\s*["']([^"']+)["']/i)?.[1]);
    const year = text(title.match(/(?:19|20)\d{2}/)?.[0] || plain.match(/\bYear\s*[:\-]?\s*((?:19|20)\d{2})/i)?.[1]);
    const cleanTitle = title.replace(/^(?:19|20)\d{2}(?:\/\d+)?\s+/, "").trim();
    const titleParts = cleanTitle.split(/\s+/).filter(Boolean);
    const refNo = text(plain.match(/(?:Stock|Ref(?:erence)?)\s*(?:No\.?|ID)?\s*[:#-]?\s*([A-Z0-9-]{5,})/i)?.[1]) ||
      text(detailUrl.match(/\/([a-z0-9-]{5,})(?:[/?#]|$)/i)?.[1]);
    const price = text(plain.match(/(?:FOB|Vehicle|Sale)?\s*Price\s*[:\-]?\s*(?:US)?\$\s*([0-9,]+)/i)?.[1] || plain.match(/(?:US)?\$\s*([0-9,]+)/i)?.[1]);
    return {
      refNo: refNo.toUpperCase(),
      title,
      make: titleParts[0] || "",
      model: titleParts.slice(1, 3).join(" "),
      year,
      mileage: text(plain.match(/Mileage\s*[:\-]?\s*([0-9,]+\s*km)/i)?.[1]),
      engine: text(plain.match(/(?:Engine|Displacement)\s*[:\-]?\s*([0-9,.]+\s*(?:cc|L))/i)?.[1]),
      transmission: text(plain.match(/(?:Transmission|Trans\.)\s*[:\-]?\s*([^|,]{2,20})/i)?.[1]),
      fuel: text(plain.match(/Fuel\s*[:\-]?\s*([A-Za-z -]{2,20})/i)?.[1]),
      drive: text(plain.match(/Drive\s*[:\-]?\s*([24]WD|AWD|FWD|RWD)/i)?.[1]),
      body: text(plain.match(/Body(?:\s+Type)?\s*[:\-]?\s*([A-Za-z -]{2,25})/i)?.[1]),
      location: text(plain.match(/Location\s*[:\-]?\s*([A-Za-z -]{2,30})/i)?.[1]),
      price,
      images: collectImageUrls(card),
      detailUrl,
      status: /\bSOLD\b|unavailable/i.test(plain) ? "sold" : "active",
    } satisfies SbtRow;
  }).filter((row) => row.refNo && row.make && row.model && row.year);
}

export function parseSbtMarketStocklist(html: string): SbtRow[] {
  const rows = [...parseJsonRows(html), ...parseHtmlRows(html)];
  const unique = new Map<string, SbtRow>();
  for (const row of rows) {
    const previous = unique.get(row.refNo);
    if (!previous || row.images.length > previous.images.length) unique.set(row.refNo, row);
  }
  return [...unique.values()];
}

async function fetchHtml(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 25_000));
  try {
    const response = await fetch(url, { headers: SBT_HEADERS, signal: controller.signal, redirect: "follow" });
    const html = await response.text();
    if ([401, 403, 429].includes(response.status) || BLOCK_RE.test(html.slice(0, 1_500))) {
      const error = new Error(`sbt_blocked_${response.status}`) as Error & { blocked?: boolean; status?: number };
      error.blocked = true;
      error.status = response.status;
      throw error;
    }
    if (!response.ok) throw new Error(`sbt_http_${response.status}`);
    return { response, html };
  } finally {
    clearTimeout(timeout);
  }
}

export type SbtMarketSourceConfig = {
  sourceId: string;
  market: CatalogMarket;
  inventoryLocationId: number;
  label: string;
};

export class SbtMarketAdapter implements CatalogSourceAdapter {
  sourceId: string;
  market: CatalogMarket;
  accessMode = "public_html" as const;
  private inventoryLocationId: number;
  private label: string;

  constructor(config: SbtMarketSourceConfig) {
    this.sourceId = config.sourceId;
    this.market = config.market;
    this.inventoryLocationId = config.inventoryLocationId;
    this.label = config.label;
  }

  private stockUrls(page: number) {
    const configured = process.env[`CATALOG_${this.sourceId.toUpperCase()}_LIST_URL`];
    if (configured) {
      const url = new URL(configured);
      url.searchParams.set("page", String(page));
      return [url.toString()];
    }
    const query = new URLSearchParams({
      inventory_location: String(this.inventoryLocationId),
      s: "-pv",
      page: String(page),
    });
    return [
      `${SBT_BASE_URL}/used-cars/search?${query.toString()}`,
      `${SBT_BASE_URL}/used-cars/search/?${query.toString()}`,
    ];
  }

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    let lastStatus = 0;
    let lastBytes = 0;
    for (const url of this.stockUrls(page)) {
      try {
        const { response, html } = await fetchHtml(url);
        lastStatus = response.status;
        lastBytes = html.length;
        const items = parseSbtMarketStocklist(html);
        if (!items.length) continue;
        return {
          items,
          nextCursor: String(page + 1),
          finished: false,
          count: items.length,
          health: {
            ok: true,
            message: `${this.label}: parsed ${items.length}`,
            checkedAt: new Date().toISOString(),
            httpStatus: response.status,
            contentType: response.headers.get("content-type") || "",
          },
        };
      } catch (error) {
        if ((error as Error & { blocked?: boolean }).blocked) throw error;
      }
    }
    throw new Error(`sbt_parsed_zero_${this.sourceId}_status_${lastStatus}_bytes_${lastBytes}`);
  }

  mapStatus(raw: unknown): OfferStatus {
    const row = raw as SbtRow;
    return row.status === "sold" ? "sold" : "active";
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as SbtRow;
    const sourceOfferId = text(row.refNo);
    const make = text(row.make);
    const model = text(row.model);
    const year = Number(text(row.year).match(/\d{4}/)?.[0]);
    if (!sourceOfferId || !make || !model || !year) return null;
    const sourcePrice = numberValue(row.price) || null;
    const timestamp = new Date().toISOString();
    return {
      id: stableOfferId(this.sourceId, sourceOfferId),
      sourceId: this.sourceId,
      sourceOfferId,
      market: this.market,
      offerType: "fixed",
      status: this.mapStatus(row),
      make,
      model,
      trim: text(row.title),
      year,
      mileageKm: numberValue(row.mileage),
      engineCc: numberValue(row.engine),
      fuel: text(row.fuel),
      transmission: text(row.transmission),
      drive: text(row.drive),
      bodyType: text(row.body),
      sourcePrice,
      sourceCurrency: sourcePrice ? "USD" : null,
      priceMode: sourcePrice ? "fixed" : "estimated",
      images: [],
      totalRub: null,
      calculationStatus: sourcePrice ? "ready" : "needs_data",
      firstSeenAt: timestamp,
      updatedAt: timestamp,
      operational: {
        sourceUrl: text(row.detailUrl),
        sourceVenueName: text(row.location || this.label),
        raw: row,
      },
    };
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const row = (offer.operational.raw || {}) as SbtRow;
    const limit = Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 6));
    let urls = [...(row.images || [])];
    if (row.detailUrl && urls.length < limit) {
      try {
        const { html } = await fetchHtml(row.detailUrl);
        urls = [...urls, ...collectImageUrls(html)];
      } catch {
        // Keep the list-page images if a detail page is temporarily unavailable.
      }
    }
    const cached = await Promise.all([...new Set(urls)].slice(0, limit).map((url) =>
      cacheImageFromUrl(url, offer.market, { headers: SBT_HEADERS }).catch(() => null),
    ));
    return cached.filter((image): image is CatalogImage => Boolean(image));
  }

  async healthCheck() {
    return { ok: true, message: `${this.label}: health is recorded during import`, checkedAt: new Date().toISOString() };
  }
}

export const alternateMarketSources: CatalogSourceAdapter[] = [
  new SbtMarketAdapter({ sourceId: "sbt_japan", market: "japan", inventoryLocationId: 36, label: "SBT Japan" }),
  new SbtMarketAdapter({ sourceId: "sbt_china", market: "china", inventoryLocationId: 141, label: "SBT China" }),
  new SbtMarketAdapter({ sourceId: "sbt_uae", market: "uae", inventoryLocationId: 2, label: "SBT UAE" }),
  new SbtMarketAdapter({ sourceId: "sbt_uk", market: "europe", inventoryLocationId: 93, label: "SBT United Kingdom" }),
];

export const ALTERNATE_CATALOG_SOURCE_IDS = alternateMarketSources.map((source) => source.sourceId);
export const PRODUCTION_CATALOG_SOURCE_IDS = ["encar_direct", "che168_global", ...ALTERNATE_CATALOG_SOURCE_IDS];

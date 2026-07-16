import { cacheImageFromUrl, stableOfferId } from "./storage";
import type { CatalogFetchResult, CatalogImage, CatalogMarket, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "ru-RU,ru;q=0.9,en;q=0.8",
};

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(text).find(Boolean) || "";
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const key of ["name", "title", "label", "value", "text", "displayName"]) {
      const resolved = text(object[key]);
      if (resolved) return resolved;
    }
  }
  return "";
}

function numberValue(value: unknown) {
  const number = Number(text(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function absoluteUrl(value: unknown, baseUrl: string) {
  const raw = text(value);
  if (!raw || /^(?:data:|javascript:)/i.test(raw)) return "";
  try {
    return new URL(raw.replace(/\\\//g, "/"), baseUrl).toString();
  } catch {
    return "";
  }
}

function first(object: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (text(object[key])) return object[key];
  }
  return undefined;
}

function collectObjects(value: unknown, result: Record<string, unknown>[], depth = 0) {
  if (value == null || depth > 11) return;
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, result, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  result.push(object);
  for (const child of Object.values(object)) collectObjects(child, result, depth + 1);
}

function collectImages(value: unknown, baseUrl: string) {
  const candidates: string[] = [];
  const visit = (current: unknown, depth = 0) => {
    if (current == null || depth > 7) return;
    if (typeof current === "string") {
      if (/\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(current)) candidates.push(current);
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
      return;
    }
    if (typeof current === "object") {
      for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
        if (/image|photo|picture|gallery|thumb|src|url/i.test(key)) visit(child, depth + 1);
      }
    }
  };
  visit(value);
  return [...new Set(candidates.map((item) => absoluteUrl(item, baseUrl)).filter((url) =>
    url && !/logo|icon|banner|sprite|placeholder|avatar|favicon/i.test(url),
  ))];
}

function parseEmbeddedObjects(html: string) {
  const result: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/<script[^>]*(?:type=["'](?:application\/ld\+json|application\/json)["']|id=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      collectObjects(JSON.parse(match[1].trim()), result);
    } catch {
      // One malformed script should not stop parsing other embedded data.
    }
  }
  return result;
}

export type PublicFallbackRow = {
  id: string;
  title: string;
  make: string;
  model: string;
  year: number;
  mileageKm?: number;
  engineCc?: number;
  fuel: string;
  transmission: string;
  drive: string;
  bodyType: string;
  price?: number;
  currency: string;
  images: string[];
  detailUrl: string;
  location: string;
  status: "active" | "sold";
};

function rowFromObject(object: Record<string, unknown>, baseUrl: string, currency: string): PublicFallbackRow | null {
  const title = text(first(object, ["name", "title", "vehicleName", "carName", "productName", "displayName", "fullName"]));
  const explicitMake = text(first(object, ["brand", "make", "maker", "manufacturer", "vehicleMake", "mark"]));
  const explicitModel = text(first(object, ["model", "modelName", "vehicleModel", "series", "seriesName"]));
  const year = Number(text(first(object, ["year", "modelYear", "registrationYear", "manufactureYear", "productionYear"])).match(/(?:19|20)\d{2}/)?.[0] || title.match(/(?:19|20)\d{2}/)?.[0]);
  const cleaned = title.replace(/^(?:19|20)\d{2}(?:\/\d+)?\s+/, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const make = explicitMake || parts[0] || "";
  const model = explicitModel || (parts[0]?.toLowerCase() === make.toLowerCase() ? parts.slice(1, 4).join(" ") : parts.slice(0, 3).join(" "));
  const detailUrl = absoluteUrl(first(object, ["url", "detailUrl", "link", "href", "canonicalUrl", "webUrl"]), baseUrl);
  const images = collectImages(object, baseUrl);
  const price = numberValue(first(object, ["price", "vehiclePrice", "salePrice", "fobPrice", "currentPrice", "amount"]));
  const sourceId = text(first(object, ["stockNo", "stockNumber", "stockId", "refNo", "reference", "sku", "productID", "vehicleId", "carId", "id", "objectId"])) || detailUrl.split(/[/?#]/).filter(Boolean).pop() || `${year}-${make}-${model}-${price || 0}`;
  if (!sourceId || !make || !model || !year || (!images.length && !detailUrl)) return null;
  const statusText = text(first(object, ["status", "availability"]));
  return {
    id: sourceId,
    title: title || `${year} ${make} ${model}`,
    make,
    model,
    year,
    mileageKm: numberValue(first(object, ["mileage", "mileageKm", "odometer", "run"])),
    engineCc: numberValue(first(object, ["engine", "engineCc", "displacement", "engineVolume"])),
    fuel: text(first(object, ["fuel", "fuelType", "engineType"])),
    transmission: text(first(object, ["transmission", "gearbox", "trans"])),
    drive: text(first(object, ["drive", "drivetrain", "driveType"])),
    bodyType: text(first(object, ["body", "bodyType", "vehicleType", "category"])),
    price,
    currency: text(first(object, ["priceCurrency", "currency", "currencyCode"])) || currency,
    images,
    detailUrl,
    location: text(first(object, ["location", "inventoryLocation", "country", "city", "yard"])),
    status: /sold|unavailable|reserved|продан/i.test(statusText) ? "sold" : "active",
  };
}

export function parsePublicFallbackPage(html: string, baseUrl: string, currency: string) {
  const unique = new Map<string, PublicFallbackRow>();
  for (const object of parseEmbeddedObjects(html)) {
    const row = rowFromObject(object, baseUrl, currency);
    if (!row) continue;
    const previous = unique.get(row.id);
    if (!previous || row.images.length > previous.images.length) unique.set(row.id, row);
  }
  return [...unique.values()];
}

type SourceConfig = {
  sourceId: string;
  market: CatalogMarket;
  label: string;
  baseUrl: string;
  currency: string;
  urls: (page: number) => string[];
};

export class PublicFallbackAdapter implements CatalogSourceAdapter {
  sourceId: string;
  market: CatalogMarket;
  accessMode = "public_html" as const;
  private config: SourceConfig;

  constructor(config: SourceConfig) {
    this.sourceId = config.sourceId;
    this.market = config.market;
    this.config = config;
  }

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    let lastStatus = 0;
    let lastBytes = 0;
    for (const url of this.config.urls(page)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 30_000));
      try {
        const response = await fetch(url, { headers: HEADERS, redirect: "follow", signal: controller.signal });
        const html = await response.text();
        lastStatus = response.status;
        lastBytes = html.length;
        if (!response.ok) continue;
        const items = parsePublicFallbackPage(html, this.config.baseUrl, this.config.currency);
        if (!items.length) continue;
        return {
          items,
          nextCursor: String(page + 1),
          finished: false,
          count: items.length,
          health: {
            ok: true,
            message: `${this.config.label}: parsed ${items.length}`,
            checkedAt: new Date().toISOString(),
            httpStatus: response.status,
            contentType: response.headers.get("content-type") || "",
          },
        };
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(`${this.sourceId}_parsed_zero_status_${lastStatus}_bytes_${lastBytes}`);
  }

  mapStatus(raw: unknown): OfferStatus {
    return (raw as PublicFallbackRow).status;
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as PublicFallbackRow;
    if (!row.id || !row.make || !row.model || !row.year) return null;
    const now = new Date().toISOString();
    return {
      id: stableOfferId(this.sourceId, row.id),
      sourceId: this.sourceId,
      sourceOfferId: row.id,
      market: this.market,
      offerType: "fixed",
      status: this.mapStatus(row),
      make: row.make,
      model: row.model,
      trim: row.title,
      year: row.year,
      mileageKm: row.mileageKm,
      engineCc: row.engineCc,
      fuel: row.fuel,
      transmission: row.transmission,
      drive: row.drive,
      bodyType: row.bodyType,
      sourcePrice: row.price || null,
      sourceCurrency: row.price ? row.currency : null,
      priceMode: row.price ? "fixed" : "estimated",
      images: [],
      totalRub: null,
      calculationStatus: row.price ? "ready" : "needs_data",
      firstSeenAt: now,
      updatedAt: now,
      operational: { sourceUrl: row.detailUrl, sourceVenueName: row.location || this.config.label, raw: row },
    };
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const row = (offer.operational.raw || {}) as PublicFallbackRow;
    const limit = Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 10));
    const cached = await Promise.all((row.images || []).slice(0, limit).map((url) =>
      cacheImageFromUrl(url, offer.market, { headers: HEADERS }).catch(() => null),
    ));
    return cached.filter((image): image is CatalogImage => Boolean(image));
  }

  async healthCheck() {
    return { ok: true, message: `${this.config.label}: checked during import`, checkedAt: new Date().toISOString() };
  }
}

function withPage(value: string, page: number) {
  const url = new URL(value);
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

export const publicFallbackSources: CatalogSourceAdapter[] = [
  new PublicFallbackAdapter({
    sourceId: "japantransit_japan",
    market: "japan",
    label: "JapanTransit",
    baseUrl: "https://japantransit.ru",
    currency: "JPY",
    urls: (page) => [withPage("https://japantransit.ru/japan/stat", page)],
  }),
  new PublicFallbackAdapter({
    sourceId: "che168_html",
    market: "china",
    label: "Che168 public page",
    baseUrl: "https://www.che168.com",
    currency: "CNY",
    urls: (page) => [withPage("https://www.che168.com/china/", page), withPage("https://www.che168.com/china/list/", page)],
  }),
  new PublicFallbackAdapter({
    sourceId: "dubicars_uae",
    market: "uae",
    label: "DubiCars UAE",
    baseUrl: "https://www.dubicars.com",
    currency: "AED",
    urls: (page) => [withPage("https://www.dubicars.com/uae/used", page), withPage("https://www.dubicars.com/uae/used-cars", page)],
  }),
  new PublicFallbackAdapter({
    sourceId: "autoscout_europe",
    market: "europe",
    label: "AutoScout24 Europe",
    baseUrl: "https://www.autoscout24.com",
    currency: "EUR",
    urls: (page) => {
      const url = new URL("https://www.autoscout24.com/lst");
      url.searchParams.set("atype", "C");
      url.searchParams.set("ustate", "N,U");
      url.searchParams.set("page", String(page));
      return [url.toString()];
    },
  }),
];

export const PUBLIC_FALLBACK_SOURCE_IDS = publicFallbackSources.map((source) => source.sourceId);

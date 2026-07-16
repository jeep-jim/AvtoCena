import { cacheImageFromUrl, stableOfferId } from "./storage";
import type { CatalogFetchResult, CatalogImage, CatalogMarket, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

const BASE_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
  "upgrade-insecure-requests": "1",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
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

function integerValue(value: unknown) {
  const digits = text(value).replace(/[^0-9]/g, "");
  const number = Number(digits);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function mileageValue(value: unknown) {
  const raw = text(value);
  const tenThousands = raw.match(/([0-9]+(?:[.,][0-9]+)?)\s*万(?:公里|\s*km)?/i);
  if (tenThousands) {
    const number = Number(tenThousands[1].replace(",", "."));
    if (Number.isFinite(number) && number > 0) return Math.round(number * 10_000);
  }
  return integerValue(raw);
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value: string) {
  return decodeHtml(value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "));
}

function absoluteUrl(value: unknown, baseUrl: string) {
  const raw = text(value);
  if (!raw || /^(?:data:|javascript:|mailto:|tel:)/i.test(raw)) return "";
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
    url && !/logo|icon|banner|sprite|placeholder|avatar|favicon|cookie/i.test(url),
  ))];
}

function collectMarkupImages(markup: string, baseUrl: string) {
  const candidates: string[] = [];
  for (const match of markup.matchAll(/<(?:img|source)[^>]+(?:data-src|data-original|data-lazy-src|src)\s*=\s*["']([^"']+)["']/gi)) {
    candidates.push(match[1]);
  }
  for (const match of markup.matchAll(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi)) {
    for (const item of match[1].split(",")) candidates.push(item.trim().split(/\s+/)[0]);
  }
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) {
    candidates.push(match[0].replace(/\\\//g, "/"));
  }
  return [...new Set(candidates
    .map((item) => decodeHtml(item))
    .map((item) => absoluteUrl(item, baseUrl))
    .filter((url) => url && !/logo|icon|banner|sprite|placeholder|avatar|favicon|cookie|tracking/i.test(url)))];
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

function deriveMakeModel(title: string) {
  const cleaned = title
    .replace(/^(?:used|new|featured|promoted|premium|save)\s+/i, "")
    .replace(/^(?:19|20)\d{2}(?:\/\d+)?\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  const knownMakes = [
    "Mercedes Benz", "Mercedes-Benz", "Land Rover", "Rolls Royce", "Alfa Romeo", "Aston Martin",
    "Great Wall", "Hongqi", "Range Rover", "Toyota", "Lexus", "Nissan", "Infiniti", "Honda",
    "Mazda", "Mitsubishi", "Subaru", "Suzuki", "Hyundai", "Genesis", "Kia", "KGM", "SsangYong",
    "BMW", "Audi", "Volkswagen", "Volvo", "Porsche", "Ford", "Chevrolet", "Cadillac", "Jeep",
    "Dodge", "Renault", "Peugeot", "Citroen", "Skoda", "Seat", "Mini", "BYD", "Geely", "Changan",
    "Chery", "GAC", "Haval", "Zeekr", "Li Auto", "Nio", "XPeng", "Jetour", "Denza", "Rox",
  ];
  const lower = cleaned.toLocaleLowerCase("en-US");
  const matched = knownMakes.find((make) => lower.startsWith(make.toLocaleLowerCase("en-US") + " ") || lower === make.toLocaleLowerCase("en-US"));
  if (matched) {
    const rest = cleaned.slice(matched.length).trim();
    return { make: matched === "Mercedes Benz" ? "Mercedes-Benz" : matched, model: rest.split(/\s+/).slice(0, 4).join(" ") || matched };
  }
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return { make: parts[0] || "", model: parts.slice(1, 5).join(" ") || parts[0] || "" };
}

function rowFromObject(object: Record<string, unknown>, baseUrl: string, currency: string): PublicFallbackRow | null {
  const title = text(first(object, ["name", "title", "vehicleName", "carName", "productName", "displayName", "fullName"]));
  const explicitMake = text(first(object, ["brand", "make", "maker", "manufacturer", "vehicleMake", "mark"]));
  const explicitModel = text(first(object, ["model", "modelName", "vehicleModel", "series", "seriesName"]));
  const year = Number(text(first(object, ["year", "modelYear", "registrationYear", "manufactureYear", "productionYear"])).match(/(?:19|20)\d{2}/)?.[0] || title.match(/(?:19|20)\d{2}/)?.[0]);
  const derived = deriveMakeModel(title);
  const make = explicitMake || derived.make;
  const model = explicitModel || derived.model;
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
    mileageKm: mileageValue(first(object, ["mileage", "mileageKm", "odometer", "run"])),
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

function isVehicleDetailUrl(url: string, baseUrl: string) {
  try {
    const host = new URL(baseUrl).hostname.replace(/^www\./, "");
    const parsed = new URL(url, baseUrl);
    const path = `${parsed.pathname}${parsed.search}`;
    if (host.includes("dubicars.com")) return /-\d{5,}\.html(?:[?#]|$)/i.test(path);
    if (host.includes("autoscout24.com")) return /\/offers\//i.test(path);
    if (host.includes("che168.com")) return /\/(?:dealer|ershouche|usedcar|car|detail|spec)\//i.test(path) || /\d{6,}\.html/i.test(path);
    if (host.includes("japantransit.ru")) return /\/japan\/(?:stat|auction|lot|car)(?:\/|\?)/i.test(path) && path !== "/japan/stat";
    return /\/(?:vehicle|vehicles|stock|listing|listings|used-car|used-cars|car)\//i.test(path);
  } catch {
    return false;
  }
}

function titleFromCard(anchorText: string, card: string) {
  const candidates = [
    stripHtml(anchorText),
    decodeHtml(card.match(/<img[^>]+alt\s*=\s*["']([^"']+)["']/i)?.[1] || ""),
    stripHtml(card.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1] || ""),
    decodeHtml(card.match(/(?:aria-label|title)\s*=\s*["']([^"']+)["']/i)?.[1] || ""),
  ];
  return candidates.find((candidate) => candidate.length >= 4 && candidate.length <= 220 && !/^(?:call|whatsapp|email|save|details?|view|image|loading|next|previous)$/i.test(candidate)) || "";
}

function detectPrice(plain: string, fallbackCurrency: string) {
  const patterns: Array<{ regex: RegExp; currency: string }> = [
    { regex: /(?:USD|US\$|\$)\s*([0-9][0-9,.'\s]{2,})/i, currency: "USD" },
    { regex: /(?:AED|د\.?إ\.?)\s*([0-9][0-9,.'\s]{2,})/i, currency: "AED" },
    { regex: /(?:EUR|€)\s*([0-9][0-9,.'\s]{2,})/i, currency: "EUR" },
    { regex: /(?:CNY|RMB|CN¥|￥)\s*([0-9][0-9,.'\s]{2,})/i, currency: "CNY" },
    { regex: /(?:JPY|JP¥|円)\s*([0-9][0-9,.'\s]{2,})/i, currency: "JPY" },
    { regex: /([0-9][0-9,.'\s]{2,})\s*(?:AED|USD|EUR|CNY|RMB|JPY|円|万元|万)/i, currency: fallbackCurrency },
  ];
  for (const pattern of patterns) {
    const match = plain.match(pattern.regex);
    const value = integerValue(match?.[1]);
    if (value) return { price: value, currency: pattern.currency };
  }
  return { price: undefined, currency: fallbackCurrency };
}

function detectBody(plain: string) {
  const match = plain.match(/\b(SUV\/Crossover|SUV|Crossover|Sedan|Hatchback|Coupe|Convertible|Pickup|Pick Up Truck|Wagon|Estate|Minivan|Van|Bus|Truck|Liftback)\b/i);
  return match?.[1] || "";
}

function detectLocation(plain: string) {
  return plain.match(/\b(Dubai|Abu Dhabi|Sharjah|Ajman|Fujairah|Al Ain|Ras al-Khaimah|Belgium|Germany|France|Italy|Spain|Netherlands|Japan|Tokyo|Yokohama|Nagoya|Osaka|China|Beijing|Shanghai|Guangzhou|Shenzhen)\b/i)?.[1] || "";
}

function parseHtmlRows(html: string, baseUrl: string, fallbackCurrency: string) {
  const anchors = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: match[1], inner: match[2], index: match.index || 0 }))
    .filter((match) => isVehicleDetailUrl(match.href, baseUrl));
  const rows: PublicFallbackRow[] = [];
  const seen = new Set<string>();

  anchors.forEach((anchor, index) => {
    const detailUrl = absoluteUrl(anchor.href, baseUrl);
    if (!detailUrl || seen.has(detailUrl)) return;
    const previous = index > 0 ? anchors[index - 1].index : 0;
    const next = index + 1 < anchors.length ? anchors[index + 1].index : html.length;
    const start = Math.max(previous, anchor.index - 5_000);
    const end = Math.min(next + 2_500, anchor.index + 13_000);
    const card = html.slice(start, end);
    const plain = stripHtml(card);
    const title = titleFromCard(anchor.inner, card);
    const year = Number(title.match(/(?:19|20)\d{2}/)?.[0] || plain.match(/\b(?:19|20)\d{2}\b/)?.[0]);
    if (!title || !year) return;
    const derived = deriveMakeModel(title);
    if (!derived.make || !derived.model) return;
    const amount = detectPrice(plain, fallbackCurrency);
    const mileageMatch = plain.match(/([0-9]+(?:[.,][0-9]+)?\s*万|[0-9][0-9,.'\s]{0,12})\s*(?:Km|公里)\b/i);
    const liters = plain.match(/\b([0-9]+(?:[.,][0-9]+)?)\s*L\b/i);
    const cc = plain.match(/\b([0-9][0-9,.'\s]{2,5})\s*(?:cc|cm3|см³)\b/i);
    const id = detailUrl.match(/(?:-|\/)(\d{5,})(?:\.html|[/?#]|$)/i)?.[1] || detailUrl.split(/[/?#]/).filter(Boolean).pop() || stableOfferId("html", detailUrl);
    const fuel = plain.match(/\b(Petrol|Gasoline|Diesel|Hybrid|Electric|EV|PHEV|LPG|Бензин|Дизель|Гибрид|Электро)\b/i)?.[1] || "";
    const transmission = plain.match(/\b(Automatic|Manual|CVT|DCT|AT|MT|Автомат|Механика|Вариатор|Робот)\b/i)?.[1] || "";
    const drive = plain.match(/\b(AWD|4WD|2WD|FWD|RWD|Front Wheel Drive|Rear Wheel Drive|Four Wheel Drive)\b/i)?.[1] || "";
    seen.add(detailUrl);
    rows.push({
      id,
      title,
      make: derived.make,
      model: derived.model,
      year,
      mileageKm: mileageValue(mileageMatch?.[1]),
      engineCc: cc ? integerValue(cc[1]) : liters ? Math.round(Number(liters[1].replace(",", ".")) * 1_000) : undefined,
      fuel,
      transmission,
      drive,
      bodyType: detectBody(plain),
      price: amount.price,
      currency: amount.currency,
      images: collectMarkupImages(card, baseUrl),
      detailUrl,
      location: detectLocation(plain),
      status: /\b(?:sold|unavailable|reserved|продан)\b/i.test(plain) ? "sold" : "active",
    });
  });

  return rows;
}

export function parsePublicFallbackPage(html: string, baseUrl: string, currency: string) {
  const unique = new Map<string, PublicFallbackRow>();
  for (const object of parseEmbeddedObjects(html)) {
    const row = rowFromObject(object, baseUrl, currency);
    if (!row) continue;
    const previous = unique.get(row.id);
    if (!previous || row.images.length > previous.images.length) unique.set(row.id, row);
  }
  for (const row of parseHtmlRows(html, baseUrl, currency)) {
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
  referer?: string;
  warmupUrl?: string;
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

  private headers(referer?: string, cookie?: string) {
    return {
      ...BASE_HEADERS,
      referer: referer || this.config.referer || `${this.config.baseUrl}/`,
      ...(cookie ? { cookie } : {}),
    };
  }

  private async request(url: string, cookie?: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 30_000));
    try {
      const response = await fetch(url, { headers: this.headers(this.config.referer, cookie), redirect: "follow", signal: controller.signal });
      return { response, html: await response.text() };
    } finally {
      clearTimeout(timer);
    }
  }

  private async warmCookie() {
    if (!this.config.warmupUrl) return "";
    try {
      const { response } = await this.request(this.config.warmupUrl);
      return (response.headers.get("set-cookie") || "").split(";")[0];
    } catch {
      return "";
    }
  }

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    let lastStatus = 0;
    let lastBytes = 0;
    let cookie = "";
    for (const url of this.config.urls(page)) {
      let result = await this.request(url, cookie).catch(() => null);
      if (result?.response.status === 403 && this.config.warmupUrl) {
        cookie = await this.warmCookie();
        result = await this.request(url, cookie).catch(() => null);
      }
      if (!result) continue;
      const { response, html } = result;
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
    let urls = [...(row.images || [])];
    if (row.detailUrl && urls.length < limit) {
      const result = await this.request(row.detailUrl).catch(() => null);
      if (result?.response.ok) {
        urls = [...urls, ...collectMarkupImages(result.html, this.config.baseUrl)];
        for (const object of parseEmbeddedObjects(result.html)) urls.push(...collectImages(object, this.config.baseUrl));
      }
    }
    const cached: CatalogImage[] = [];
    for (const url of [...new Set(urls)].slice(0, limit)) {
      const image = await cacheImageFromUrl(url, offer.market, { headers: this.headers(row.detailUrl) }).catch(() => null);
      if (image) cached.push(image);
    }
    return cached;
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
    referer: "https://japantransit.ru/japan",
    warmupUrl: "https://japantransit.ru/",
    urls: (page) => [withPage("https://japantransit.ru/japan/stat", page)],
  }),
  new PublicFallbackAdapter({
    sourceId: "che168_html",
    market: "china",
    label: "Che168 public page",
    baseUrl: "https://www.che168.com",
    currency: "CNY",
    referer: "https://www.che168.com/",
    warmupUrl: "https://www.che168.com/",
    urls: (page) => [withPage("https://www.che168.com/china/", page), withPage("https://www.che168.com/china/list/", page)],
  }),
  new PublicFallbackAdapter({
    sourceId: "dubicars_uae",
    market: "uae",
    label: "DubiCars UAE",
    baseUrl: "https://www.dubicars.com",
    currency: "AED",
    referer: "https://www.dubicars.com/uae/used",
    urls: (page) => [withPage("https://www.dubicars.com/uae/used", page), withPage("https://www.dubicars.com/uae/used-cars", page)],
  }),
  new PublicFallbackAdapter({
    sourceId: "autoscout_europe",
    market: "europe",
    label: "AutoScout24 Europe",
    baseUrl: "https://www.autoscout24.com",
    currency: "EUR",
    referer: "https://www.autoscout24.com/",
    warmupUrl: "https://www.autoscout24.com/",
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

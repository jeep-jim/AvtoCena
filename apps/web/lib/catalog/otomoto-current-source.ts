import { cacheImageFromUrl, stableOfferId } from "./storage";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

export type OtomotoRow = {
  id: string;
  url: string;
  title: string;
  make: string;
  model: string;
  year: number;
  publishedAt?: string;
  price?: number;
  currency?: string;
  mileageKm?: number;
  engineCc?: number;
  powerHp?: number;
  fuel?: string;
  transmission?: string;
  drive?: string;
  bodyType?: string;
  images: string[];
};

export const OTOMOTO_HEADERS = {
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "accept-language": "pl-PL,pl;q=0.9,en;q=0.8",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};

const MAKES = ["Mercedes-Benz", "Land Rover", "Rolls-Royce", "Alfa Romeo", "Aston Martin", "DS Automobiles", "Toyota", "Lexus", "Nissan", "Infiniti", "Honda", "Mazda", "Mitsubishi", "Subaru", "Suzuki", "Hyundai", "Genesis", "Kia", "BMW", "Audi", "Volkswagen", "Volvo", "Porsche", "Ford", "Chevrolet", "Cadillac", "Jeep", "Dodge", "Renault", "Peugeot", "Citroen", "Skoda", "SEAT", "MINI", "Opel", "Fiat", "Tesla", "Cupra", "BYD", "MG", "Omoda", "RAM", "Jaguar", "Dacia", "Smart", "Polestar"].sort((a, b) => b.length - a.length);
const BRAND_PATHS = ["audi", "bmw", "mercedes-benz", "volkswagen", "toyota", "volvo", "skoda", "ford", "opel", "renault", "peugeot", "citroen", "seat", "cupra", "kia", "hyundai", "honda", "mazda", "nissan", "lexus", "porsche", "jeep", "land-rover", "jaguar", "mini", "fiat", "dacia", "tesla", "mitsubishi", "subaru"];
const BAD_IMAGE = /logo|icon|avatar|qrcode|qr-code|placeholder|banner|seller|dealer|tracking|pixel|finance|appstore|googleplay|favicon|sprite|badge|flag/i;

export function decodeOtomoto(value: string) {
  return String(value || "")
    .replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003A/gi, ":")
    .replace(/\\u003D/gi, "=")
    .replace(/\\u0022/gi, '"')
    .replace(/\\\//g, "/")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function cleanOtomoto(value: unknown) {
  return decodeOtomoto(String(value || ""))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\s\u00a0\u202f]+/g, " ")
    .trim();
}

export function otomotoInteger(value: unknown) {
  const result = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(result) && result >= 0 ? result : undefined;
}

function absoluteUrl(value: string, base: string) {
  try { return new URL(decodeOtomoto(value), base).toString(); } catch { return ""; }
}

function normalizeImageUrl(value: string, base: string) {
  const url = absoluteUrl(value, base);
  if (!url || BAD_IMAGE.test(url)) return "";
  if (!/\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(url) && !/apollo\.olxcdn\.com|ireland\.apollo\.olxcdn\.com|\/image(?:[;/?#]|$)/i.test(url)) return "";
  return url;
}

function imageCanonicalKey(url: string) {
  try {
    const parsed = new URL(url);
    const file = parsed.pathname.match(/\/v1\/files\/([^/]+)\/image/i)?.[1];
    if (file) return `${parsed.hostname.toLowerCase()}:${file.toLowerCase()}`;
    const path = parsed.pathname.replace(/\/image(?:;[^/?#]*)?$/i, "/image");
    return `${parsed.hostname.toLowerCase()}${path}`;
  } catch {
    return url.replace(/[?#].*$/, "").replace(/;s=\d+x\d+/i, "");
  }
}

function imageResolutionScore(url: string) {
  const size = url.match(/(?:[;?&](?:s|size)=|\/)(\d{2,5})x(\d{2,5})(?:[;&/?#]|$)/i);
  if (size) return Number(size[1]) * Number(size[2]);
  const width = Number(url.match(/[?&](?:w|width)=(\d{2,5})/i)?.[1] || 0);
  const height = Number(url.match(/[?&](?:h|height)=(\d{2,5})/i)?.[1] || 0);
  return width * Math.max(height, 1);
}

function uniqueImageUrls(values: string[], base: string, limit = 80) {
  const selected = new Map<string, { url: string; score: number; order: number }>();
  let order = 0;
  for (const value of values) {
    const url = normalizeImageUrl(value, base);
    if (!url) continue;
    const key = imageCanonicalKey(url);
    const score = imageResolutionScore(url);
    const previous = selected.get(key);
    if (!previous || score > previous.score) selected.set(key, { url, score, order: previous?.order ?? order++ });
  }
  return [...selected.values()].sort((a, b) => a.order - b.order).map((item) => item.url).slice(0, limit);
}

function collectJsonImageValues(value: unknown, output: string[], depth = 0) {
  if (value == null || depth > 12) return;
  if (typeof value === "string") {
    const decoded = decodeOtomoto(value);
    if (/^https?:/i.test(decoded) && /olxcdn|otomoto|\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(decoded)) output.push(decoded);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectJsonImageValues(item, output, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(object)) {
    if (/image|photo|gallery|media|url/i.test(key)) collectJsonImageValues(child, output, depth + 1);
    else if (depth < 6 && typeof child === "object") collectJsonImageValues(child, output, depth + 1);
  }
}

export function extractOtomotoImages(markup: string, base: string) {
  const values: string[] = [];
  const decodedMarkup = decodeOtomoto(markup);
  for (const match of decodedMarkup.matchAll(/<(?:img|source)[^>]+(?:data-src|data-original|data-lazy-src|src)\s*=\s*["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of decodedMarkup.matchAll(/(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']/gi)) {
    for (const part of match[1].split(",")) values.push(part.trim().split(/\s+/)[0]);
  }
  for (const match of decodedMarkup.matchAll(/https?:\/\/[^"'<>\s\\]+(?:\.(?:jpe?g|png|webp|avif)|apollo\.olxcdn\.com|\/image(?:[;/?#]|$))[^"'<>\s\\]*/gi)) values.push(match[0]);
  for (const match of markup.matchAll(/<script[^>]+type=["'](?:application\/ld\+json|application\/json)["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const payload = decodeOtomoto(match[1]);
    try { collectJsonImageValues(JSON.parse(payload), values); } catch { /* ignore malformed JSON payloads */ }
  }
  return uniqueImageUrls(values, base, 80);
}

const CURRENCY_PATTERNS: Array<{ code: string; token: string }> = [
  { code: "PLN", token: "(?:PLN|zł)" },
  { code: "EUR", token: "(?:EUR|€)" },
  { code: "SEK", token: "SEK" },
  { code: "NOK", token: "NOK" },
  { code: "DKK", token: "DKK" },
  { code: "CHF", token: "CHF" },
  { code: "GBP", token: "(?:GBP|£)" },
  { code: "CZK", token: "(?:CZK|Kč)" },
  { code: "HUF", token: "(?:HUF|Ft)" },
  { code: "RON", token: "RON" },
  { code: "BGN", token: "BGN" },
];

export function parseOtomotoPrice(value: string) {
  const amount = "([0-9]{1,3}(?:[ .\\u00a0\\u202f]\\d{3})+|[0-9]{4,9})(?![0-9])";
  for (const item of CURRENCY_PATTERNS) {
    const matches = [...decodeOtomoto(value).matchAll(new RegExp(`${amount}\\s*${item.token}\\b`, "gi"))]
      .map((match) => otomotoInteger(match[1]) || 0)
      .filter((price) => price >= 500 && price <= 500_000_000);
    if (matches.length) return { price: Math.max(...matches), currency: item.code };
  }
  return { price: undefined, currency: undefined };
}

export function parseOtomotoMileage(value: string) {
  const decoded = decodeOtomoto(value);
  const plain = cleanOtomoto(value);
  const candidates = [
    plain.match(/(?:mileage|przebieg)\s*[:：]?\s*([0-9][0-9 .\u00a0\u202f]{0,14})\s*km\b/i)?.[1],
    decoded.match(/["'](?:mileageKm|mileage|mileageFromOdometer|odometer)["']\s*:\s*(?:\{[\s\S]{0,180}?["'](?:value|amount)["']\s*:\s*)?["']?([0-9][0-9 .\u00a0\u202f]{0,14})/i)?.[1],
    decoded.match(/["'](?:key|code|name)["']\s*:\s*["'](?:mileageKm|mileage|mileageFromOdometer|przebieg)["'][\s\S]{0,220}?["'](?:value|amount)["']\s*:\s*["']?([0-9][0-9 .\u00a0\u202f]{0,14})/i)?.[1],
    decoded.match(/(?:Przebieg|mileage)[\s\S]{0,160}?([0-9][0-9 .\u00a0\u202f]{0,14})\s*km\b/i)?.[1],
    plain.match(/\b([0-9][0-9 .\u00a0\u202f]{0,14})\s*km\b/i)?.[1],
  ];
  for (const candidate of candidates) {
    const mileage = otomotoInteger(candidate);
    if (mileage !== undefined && mileage <= 5_000_000) return mileage;
  }
  return undefined;
}

function makeModel(raw: string) {
  const title = cleanOtomoto(raw).replace(/^Używany\s+/i, "").trim();
  const lower = title.toLocaleLowerCase("pl-PL");
  const make = MAKES.find((item) => lower === item.toLocaleLowerCase("pl-PL") || lower.startsWith(`${item.toLocaleLowerCase("pl-PL")} `)) || "";
  return { title, make, model: make ? title.slice(make.length).trim().split(/\s+/).slice(0, 8).join(" ") : "" };
}

export function normalizeOtomotoFuel(value: string) {
  return /Hybryda Plug-in|Plug[- ]?in|PHEV/i.test(value) ? "phev"
    : /Hybryda|Hybrid/i.test(value) ? "hybrid"
      : /Diesel|Olej napędowy/i.test(value) ? "diesel"
        : /Elektrycz|Electric|BEV/i.test(value) ? "electric"
          : /Benzyna\s*\+\s*LPG|LPG/i.test(value) ? "lpg"
            : /Benzyna|Petrol|Gasoline/i.test(value) ? "petrol" : "";
}

export function normalizeOtomotoTransmission(value: string) {
  return /Automatyczna|Automat|Automatic|S tronic|Tiptronic|DCT|CVT/i.test(value) ? "automatic"
    : /Manualna|Manual/i.test(value) ? "manual" : "";
}

export function normalizeOtomotoDrive(value: string) {
  return /4x4|AWD|4-Matic|4MATIC|quattro|xDrive|Allrad|na cztery koła|all[- ]wheel/i.test(value) ? "awd"
    : /przedni|na przednie koła|front[- ]wheel|FWD/i.test(value) ? "fwd"
      : /tylny|na tylne koła|rear[- ]wheel|RWD/i.test(value) ? "rwd" : "";
}

export function normalizeOtomotoBody(value: string) {
  return /SUV|Crossover/i.test(value) ? "suv"
    : /Kombi|Wagon|Estate|Avant|Touring/i.test(value) ? "wagon"
      : /Hatchback|Auta miejskie/i.test(value) ? "hatchback"
        : /Coupe/i.test(value) ? "coupe"
          : /Kabriolet|Convertible|Cabrio|Roadster/i.test(value) ? "convertible"
            : /Sedan|Limuzyna/i.test(value) ? "sedan"
              : /Van|Minivan|MPV/i.test(value) ? "minivan"
                : /Pickup|Pick-up/i.test(value) ? "pickup" : "";
}

async function request(url: string, referer = "https://www.otomoto.pl/osobowe") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 35_000));
  try {
    const response = await fetch(url, { headers: { ...OTOMOTO_HEADERS, referer }, redirect: "follow", signal: controller.signal });
    return { response, markup: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

function titleFrom(block: string) {
  const candidates = [
    ...[...block.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map((match) => cleanOtomoto(match[1])),
    ...[...block.matchAll(/<a\b[^>]*href=["'][^"']*\/osobowe\/oferta\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi)].map((match) => cleanOtomoto(match[1])),
    ...[...block.matchAll(/<img[^>]+alt=["']([^"']+)["']/gi)].map((match) => cleanOtomoto(match[1])),
  ];
  return candidates.find((candidate) => candidate.length >= 4 && candidate.length <= 220 && !/^(?:ad link|image|zobacz|więcej|promowane|wyróżnione|save|loading)$/i.test(candidate) && makeModel(candidate).make) || "";
}

function extractPublishedAt(block: string) {
  const value = block.match(/(?:datePublished|publishedAt|createdAt|publicationDate)["']?\s*[:=]\s*["']([^"']+)["']/i)?.[1];
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function parseBlock(block: string, listUrl: string): OtomotoRow | null {
  const href = block.match(/href=["']([^"']*\/osobowe\/oferta\/[^"']+-ID[A-Za-z0-9]+\.html[^"']*)["']/i)?.[1];
  const url = href ? absoluteUrl(href, listUrl) : "";
  if (!url) return null;
  const parsed = makeModel(titleFrom(block));
  const plain = cleanOtomoto(block);
  const engineCc = otomotoInteger(plain.match(/([0-9][0-9 .]{2,})\s*cm(?:3|³)\b/i)?.[1]);
  const labeledYear = plain.match(/\b(?:year|rok produkcji)\s*[:：]?\s*((?:19|20)\d{2})\b/i)?.[1];
  const htmlYear = block.match(/(?:data-testid|aria-label)=["'][^"']*(?:year|rok[-_ ]?produkcji)[^"']*["'][^>]*>[\s\S]{0,240}?\b((?:19|20)\d{2})\b/i)?.[1];
  const titleYear = parsed.title.match(/\b((?:19|20)\d{2})\b/)?.[1];
  const year = Number(labeledYear || htmlYear || titleYear);
  if (!parsed.make || !parsed.model || !year || year === engineCc) return null;
  const parsedPrice = parseOtomotoPrice(plain);
  return {
    id: url.match(/-ID([A-Za-z0-9]+)\.html/i)?.[1] || stableOfferId("otomoto", url),
    url,
    title: parsed.title,
    make: parsed.make,
    model: parsed.model,
    year,
    publishedAt: extractPublishedAt(block),
    price: parsedPrice.price,
    currency: parsedPrice.currency,
    mileageKm: parseOtomotoMileage(block),
    engineCc,
    powerHp: otomotoInteger(plain.match(/([0-9]{2,4})\s*KM\b/)?.[1]),
    fuel: normalizeOtomotoFuel(plain),
    transmission: normalizeOtomotoTransmission(plain),
    drive: normalizeOtomotoDrive(plain),
    bodyType: normalizeOtomotoBody(plain),
    images: extractOtomotoImages(block, listUrl),
  };
}

export function parseOtomotoCurrentPage(markup: string, listUrl: string) {
  const result: OtomotoRow[] = [];
  const seen = new Set<string>();
  const articles = [...markup.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/gi)].map((match) => match[0]);
  for (const article of articles) {
    const row = parseBlock(article, listUrl);
    if (row && !seen.has(row.url)) { seen.add(row.url); result.push(row); }
  }
  if (result.length) return result;
  const anchors = [...markup.matchAll(/<a\b[^>]*href=["']([^"']*\/osobowe\/oferta\/[^"']+-ID[A-Za-z0-9]+\.html[^"']*)["'][^>]*>/gi)];
  for (const anchor of anchors) {
    const anchorIndex = anchor.index || 0;
    const articleStart = markup.lastIndexOf("<article", anchorIndex);
    const articleEnd = markup.indexOf("</article>", anchorIndex);
    const start = articleStart >= 0 ? articleStart : Math.max(0, anchorIndex - 800);
    const end = articleEnd >= 0 ? articleEnd + 10 : Math.min(markup.length, anchorIndex + 8_000);
    const row = parseBlock(markup.slice(start, end), listUrl);
    if (row && !seen.has(row.url)) { seen.add(row.url); result.push(row); }
  }
  return result;
}

export class OtomotoCurrentAdapter implements CatalogSourceAdapter {
  sourceId = "otomoto_europe_exact";
  market = "europe" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    let index = Math.max(0, Number(cursor || 0));
    while (index < BRAND_PATHS.length) {
      const brand = BRAND_PATHS[index];
      const listUrl = `https://www.otomoto.pl/osobowe/${brand}?search%5Border%5D=created_at_first%3Adesc`;
      const listing = await request(listUrl);
      if (!listing.response.ok) { index += 1; continue; }
      const rows = parseOtomotoCurrentPage(listing.markup, listUrl).slice(0, 40);
      if (rows.length) return { items: rows, nextCursor: String(index + 1), finished: index + 1 >= BRAND_PATHS.length, count: rows.length, health: { ok: true, message: `OTOMOTO ${brand}: ${rows.length}`, checkedAt: new Date().toISOString(), httpStatus: listing.response.status, contentType: listing.response.headers.get("content-type") || "" } };
      index += 1;
    }
    return { items: [], nextCursor: null, finished: true, count: 0, health: { ok: true, message: "OTOMOTO brand catalog exhausted", checkedAt: new Date().toISOString() } };
  }

  mapStatus(): OfferStatus { return "active"; }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as OtomotoRow;
    if (!row.id || !row.make || !row.model || !row.year || !row.images.length) return null;
    const observedAt = row.publishedAt || new Date().toISOString();
    return normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, row.id), sourceId: this.sourceId, sourceOfferId: row.id, market: "europe", offerType: "fixed", status: "active",
      make: row.make, model: row.model, trim: row.title, year: row.year, mileageKm: row.mileageKm, engineCc: row.engineCc, powerHp: row.powerHp,
      fuel: row.fuel, transmission: row.transmission, drive: row.drive, bodyType: row.bodyType,
      sourcePrice: row.price || null, sourceCurrency: row.price ? (row.currency || "PLN") : null, priceMode: row.price ? "fixed" : "estimated",
      images: [], totalRub: null, calculationStatus: row.price ? "ready" : "needs_data", firstSeenAt: observedAt, updatedAt: observedAt,
      operational: { sourceUrl: row.url, sourceVenueName: "OTOMOTO", sourcePublishedAt: row.publishedAt, raw: row },
    } as VehicleOffer);
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const row = offer.operational.raw as OtomotoRow;
    const limit = Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 80));
    let urls = [...(row.images || [])];
    if (urls.length < limit) {
      const detail = await request(row.url, row.url).catch(() => null);
      if (detail?.response.ok) urls = [...extractOtomotoImages(detail.markup, row.url), ...urls];
    }
    urls = uniqueImageUrls(urls, row.url, limit * 2);
    const saved: CatalogImage[] = [];
    const seen = new Set<string>();
    const concurrency = Math.max(1, Math.min(8, Number(process.env.CATALOG_IMAGE_FETCH_CONCURRENCY || 6)));
    for (let index = 0; index < urls.length && saved.length < limit; index += concurrency) {
      const batch = await Promise.all(urls.slice(index, index + concurrency).map((url) => cacheImageFromUrl(url, "europe", { headers: { ...OTOMOTO_HEADERS, referer: row.url } }).catch(() => null)));
      for (const image of batch) {
        if (!image || image.size <= 8_000) continue;
        const key = String(image.checksum || image.id || image.objectKey || image.url || "");
        if (!key || seen.has(key)) continue;
        seen.add(key);
        saved.push(image);
        if (saved.length >= limit) break;
      }
    }
    return saved;
  }

  async healthCheck() { return { ok: true, message: "OTOMOTO clean brand catalogs", checkedAt: new Date().toISOString() }; }
}

export const otomotoEuropeCurrentSource = new OtomotoCurrentAdapter();

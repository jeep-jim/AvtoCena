import { cacheImageFromUrl, stableOfferId } from "./storage";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

type Row = {
  id: string;
  url: string;
  title: string;
  make: string;
  model: string;
  year: number;
  price?: number;
  currency?: string;
  mileageKm?: number;
  engineCc?: number;
  fuel?: string;
  transmission?: string;
  drive?: string;
  bodyType?: string;
  color?: string;
  images: string[];
};

const H = {
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ja;q=0.8",
  referer: "https://www.goo-net-exchange.com/usedcars/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};

const MAKES = [
  "MERCEDES-BENZ", "LAND ROVER", "ROLLS-ROYCE", "TOYOTA", "LEXUS", "NISSAN", "INFINITI", "HONDA", "MAZDA",
  "MITSUBISHI", "SUBARU", "SUZUKI", "DAIHATSU", "ISUZU", "BMW", "AUDI", "VOLKSWAGEN", "PORSCHE", "VOLVO",
  "MINI", "JEEP", "JAGUAR", "FORD", "CHEVROLET", "TESLA", "HYUNDAI", "KIA",
].sort((a, b) => b.length - a.length);

const MODEL_PAGES = [
  "TOYOTA/ALPHARD", "TOYOTA/RAV4", "TOYOTA/PRIUS", "TOYOTA/VOXY", "TOYOTA/NOAH", "TOYOTA/LAND_CRUISER_PRADO",
  "TOYOTA/COROLLA_CROSS", "TOYOTA/HARRIER", "TOYOTA/SIENTA", "TOYOTA/YARIS_CROSS", "NISSAN/SERENA", "NISSAN/NOTE",
  "NISSAN/X_TRAIL", "NISSAN/ROOX", "NISSAN/LEAF", "HONDA/FREED", "HONDA/FIT", "HONDA/VEZEL", "HONDA/N_BOX",
  "MAZDA/CX-5", "MAZDA/CX-30", "MITSUBISHI/DELICA_D5", "MITSUBISHI/OUTLANDER_PHEV", "SUBARU/FORESTER",
  "SUBARU/LEVORG", "SUZUKI/JIMNY", "SUZUKI/SOLIO", "LEXUS/RX", "LEXUS/NX", "BMW/3_SERIES",
];

function clean(value: unknown) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;|\u0026/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodedUrl(value: unknown) {
  return String(value || "")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/&amp;/gi, "&")
    .trim();
}

function abs(value: string, base: string) {
  try { return new URL(decodedUrl(value), base).toString(); } catch { return ""; }
}

function num(value: unknown) {
  const result = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(result) && result > 0 ? result : undefined;
}

async function html(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 35_000));
  try {
    const response = await fetch(url, { headers: { ...H, referer: url }, redirect: "follow", signal: controller.signal });
    return { response, markup: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

function jsonLd(markup: string) {
  const result: any[] = [];
  const visit = (value: any, depth = 0) => {
    if (value == null || depth > 10) return;
    if (Array.isArray(value)) return value.forEach((item) => visit(item, depth + 1));
    if (typeof value !== "object") return;
    result.push(value);
    Object.values(value).forEach((item) => visit(item, depth + 1));
  };
  for (const match of markup.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1])); } catch { /* malformed source JSON */ }
  }
  return result;
}

function imageValues(value: any, depth = 0): string[] {
  if (!value || depth > 10) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => imageValues(item, depth + 1));
  if (typeof value === "object") return Object.entries(value)
    .filter(([key]) => /image|photo|picture|gallery|contentUrl|thumbnail|url/i.test(key))
    .flatMap(([, child]) => imageValues(child, depth + 1));
  return [];
}

function isVehicleImage(value: string) {
  try {
    const url = new URL(value);
    if (!/\.(?:jpe?g|png|webp)$/i.test(url.pathname)) return false;
    if (/(?:logo|icon|avatar|qrcode|qr-code|placeholder|banner|recommend|loading|noimage|common\/img)/i.test(url.pathname)) return false;
    return /(?:^|\.)picture\d*\.goo-net\.com$/i.test(url.hostname)
      || /(?:^|\.)goo-net\.com$/i.test(url.hostname)
      || /(?:^|\.)goo-net-exchange\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function imageIdentity(value: string) {
  try {
    const url = new URL(value);
    return `${url.hostname.toLowerCase()}${decodeURIComponent(url.pathname).toLowerCase()}`;
  } catch {
    return value.toLowerCase();
  }
}

function collectPageImages(markup: string, pageUrl: string, structured: any[]) {
  const normalizedMarkup = decodedUrl(markup);
  const candidates: string[] = structured.flatMap((item) => imageValues(item.image || item.images || item.photo || item.photos));

  for (const match of normalizedMarkup.matchAll(/(?:src|href|content|data-src|data-original|data-lazy-src|data-image|data-large|data-full|data-zoom)\s*=\s*["']([^"']+)["']/gi)) {
    candidates.push(match[1]);
  }
  for (const match of normalizedMarkup.matchAll(/srcset\s*=\s*["']([^"']+)["']/gi)) {
    for (const part of match[1].split(",")) candidates.push(part.trim().split(/\s+/)[0]);
  }
  for (const match of normalizedMarkup.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) candidates.push(match[1]);
  for (const match of normalizedMarkup.matchAll(/https?:\/\/[^\s"'<>]+?\.(?:jpe?g|png|webp)(?:\?[^\s"'<>]*)?/gi)) candidates.push(match[0]);

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const url = abs(candidate, pageUrl);
    if (!url || !isVehicleImage(url)) continue;
    const key = imageIdentity(url);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(url);
  }
  return unique;
}

function coherentImages(urls: string[], limit: number) {
  const groups = new Map<string, string[]>();
  for (const value of urls) {
    try {
      const parsed = new URL(value);
      const parts = parsed.pathname.split("/").filter(Boolean);
      const key = `${parsed.hostname.toLowerCase()}/${parts.slice(0, Math.max(1, parts.length - 1)).join("/")}`;
      groups.set(key, [...(groups.get(key) || []), value]);
    } catch { /* invalid source URL */ }
  }
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  const selected = best && best.length >= 3 ? best : urls;
  return selected.slice(0, limit);
}

function parse(markup: string, url: string): Row | null {
  const plain = clean(markup);
  const structured = jsonLd(markup);
  const vehicle = structured.find((item) => /vehicle|car|product/i.test(Array.isArray(item?.["@type"]) ? item["@type"].join(" ") : String(item?.["@type"] || ""))) || {};
  const rawTitle = clean(vehicle.name || markup.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || markup.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]);
  const title = rawTitle.replace(/^NEW\s+/i, "").replace(/^USED\s+/i, "").trim();
  const upper = title.toUpperCase();
  const makeRaw = clean(vehicle.brand?.name || vehicle.brand) || MAKES.find((make) => upper === make || upper.startsWith(`${make} `)) || "";
  const make = makeRaw === "MERCEDES_BENZ" ? "MERCEDES-BENZ" : makeRaw;
  const model = clean(vehicle.model || title.slice(makeRaw.length)).replace(/^[-–—| ]+/, "").split(/\s+/).slice(0, 8).join(" ");
  const year = Number(String(vehicle.vehicleModelDate || vehicle.modelDate || `${title} ${plain}`).match(/(?:19|20)\d{2}/)?.[0]);
  if (!make || !model || !year) return null;

  const offer = vehicle.offers || {};
  const currencyText = clean(offer.priceCurrency).toUpperCase();
  const pagePrice = plain.match(/(?:FOB|PRICE)[^¥$]{0,30}([¥$])\s*([0-9][0-9, ]+)/i);
  const price = num(offer.price) || num(pagePrice?.[2]);
  const currency = currencyText || (pagePrice?.[1] === "¥" ? "JPY" : pagePrice?.[1] === "$" ? "USD" : undefined);
  const mileageKm = num(String(vehicle.mileageFromOdometer?.value || vehicle.mileageFromOdometer || plain.match(/([0-9][0-9, ]+)\s*km/i)?.[1] || ""));
  const engineCc = num(String(vehicle.vehicleEngine?.engineDisplacement || plain.match(/([0-9][0-9, ]+)\s*cc/i)?.[1] || ""));
  const maxImages = Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 120));
  const images = coherentImages(collectPageImages(markup, url, structured), maxImages);
  if (!images.length) return null;

  return {
    id: url.match(/\/([0-9]{12,})\/?(?:[?#]|$)/)?.[1] || url,
    url,
    title,
    make,
    model,
    year,
    price,
    currency,
    mileageKm,
    engineCc,
    fuel: clean(vehicle.fuelType || plain.match(/Fuel\s*[:：]?\s*([^|•]{1,30})/i)?.[1]),
    transmission: clean(vehicle.vehicleTransmission || plain.match(/Transmission\s*[:：]?\s*([^|•]{1,30})/i)?.[1]),
    drive: clean(vehicle.driveWheelConfiguration || plain.match(/Drive\s*[:：]?\s*([^|•]{1,30})/i)?.[1]),
    bodyType: clean(vehicle.bodyType || vehicle.vehicleConfiguration),
    color: clean(vehicle.color),
    images,
  };
}

export class GoonetExactAdapter implements CatalogSourceAdapter {
  sourceId = "goonet_japan_exact";
  market = "japan" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const cursorPage = Math.max(1, Number(cursor || 1));
    const modelPath = MODEL_PAGES[(cursorPage - 1) % MODEL_PAGES.length];
    const modelPage = Math.floor((cursorPage - 1) / MODEL_PAGES.length) + 1;
    const base = `https://www.goo-net-exchange.com/usedcars/${modelPath}/`;
    const listUrls = modelPage === 1 ? [base] : [`${base}index-${modelPage}.html`, `${base}?page=${modelPage}`];

    for (const listUrl of listUrls) {
      const list = await html(listUrl).catch(() => null);
      if (!list?.response.ok) continue;
      const links = [...new Set([...list.markup.matchAll(/href=["']([^"']*\/usedcars\/[A-Z0-9_-]+\/[A-Z0-9_-]+\/[0-9]{12,}\/?)["']/gi)].map((match) => abs(match[1], listUrl)))].slice(0, 30);
      const rows: Row[] = [];
      for (let index = 0; index < links.length; index += 4) {
        const batch = await Promise.all(links.slice(index, index + 4).map(async (detailUrl) => {
          const detail = await html(detailUrl).catch(() => null);
          return detail?.response.ok ? parse(detail.markup, detailUrl) : null;
        }));
        rows.push(...batch.filter(Boolean) as Row[]);
      }
      if (rows.length) return { items: rows, nextCursor: String(cursorPage + 1), finished: false, count: rows.length };
    }
    throw new Error(`goonet_exact_zero_${modelPath}_${modelPage}`);
  }

  mapStatus(): OfferStatus { return "active"; }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as Row;
    if (!row.id || !row.images.length) return null;
    const now = new Date().toISOString();
    return normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, row.id), sourceId: this.sourceId, sourceOfferId: row.id, market: "japan", offerType: "fixed", status: "active",
      make: row.make, model: row.model, trim: row.title, year: row.year, mileageKm: row.mileageKm, engineCc: row.engineCc, fuel: row.fuel,
      transmission: row.transmission, drive: row.drive, bodyType: row.bodyType, color: row.color,
      sourcePrice: row.price || null, sourceCurrency: row.price ? (row.currency || "JPY") : null, priceMode: row.price ? "fixed" : "estimated",
      images: [], totalRub: null, calculationStatus: row.price ? "ready" : "needs_data", firstSeenAt: now, updatedAt: now,
      operational: { sourceUrl: row.url, sourceVenueName: "Goo-net Exchange", raw: row },
    } as VehicleOffer);
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const limit = Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 120));
    const sourceUrl = String(offer.operational?.sourceUrl || "");
    let row = offer.operational.raw as Row;
    if (sourceUrl) {
      const detail = await html(sourceUrl).catch(() => null);
      if (detail?.response.ok) {
        const reparsed = parse(detail.markup, sourceUrl);
        if (reparsed) {
          row = reparsed;
          (offer.operational as any).raw = reparsed;
        }
      }
    }

    const saved: CatalogImage[] = [];
    for (const url of [...new Set(row?.images || [])].slice(0, limit)) {
      const image = await cacheImageFromUrl(url, "japan", { headers: { ...H, referer: row.url || sourceUrl } }).catch(() => null);
      if (image && image.size > 8_000) saved.push(image);
    }
    (offer.operational as any).galleryImageCount = saved.length;
    (offer.operational as any).galleryRefreshedAt = new Date().toISOString();
    return saved.slice(0, limit);
  }

  async healthCheck() { return { ok: true, message: "Goo-net exact model and detail pages with complete galleries", checkedAt: new Date().toISOString() }; }
}

export const goonetJapanExactSource = new GoonetExactAdapter();
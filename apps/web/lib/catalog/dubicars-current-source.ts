import { CATALOG_BRANDS } from "./brands";
import { cacheImageFromUrl, stableOfferId } from "./storage";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import { isCatalogYearAllowed } from "./offer-quality";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

type Row = {
  id: string;
  url: string;
  title: string;
  make: string;
  model: string;
  trim?: string;
  year: number;
  price?: number;
  currency?: string;
  mileageKm?: number;
  engineCc?: number;
  powerHp?: number;
  fuel?: string;
  transmission?: string;
  drive?: string;
  bodyType?: string;
  color?: string;
  images: string[];
};

const HEADERS = {
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};

const MAKE_LABELS = [...new Map(CATALOG_BRANDS.flatMap((brand) => [
  brand.name,
  brand.name.replace(/-/g, " "),
].map((label) => [label.toLocaleLowerCase("en-US"), { label, make: brand.name }]))).values()]
  .sort((left, right) => right.label.length - left.label.length);

const BAD_IMAGE = /logo|icon|avatar|qrcode|qr-code|placeholder|banner|related|similar|people-also-viewed|dealer|tracking|pixel|calendar|calender|kilometers|share|email|heart|settings|feature_groups|social|homepage|mobile-mockup/i;

function clean(value: unknown) {
  return String(value || "")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value: string, base: string) {
  try { return new URL(value.replace(/&amp;/gi, "&").replace(/\\\//g, "/"), base).toString(); } catch { return ""; }
}

function integer(value: unknown) {
  const result = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(result) && result > 0 ? result : undefined;
}

function decimal(value: unknown) {
  const result = Number(String(value || "").replace(",", ".").replace(/[^0-9.]/g, ""));
  return Number.isFinite(result) && result > 0 ? result : undefined;
}

async function request(url: string, referer = "https://www.dubicars.com/uae/used") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 35_000));
  try {
    const response = await fetch(url, { headers: { ...HEADERS, referer }, redirect: "follow", signal: controller.signal });
    return { response, markup: await response.text() };
  } finally { clearTimeout(timer); }
}

function makeModel(raw: string) {
  const title = clean(raw).replace(/^\s*(?:19|20)\d{2}\s+/, "").replace(/^used\s+/i, "").trim();
  const lower = title.toLocaleLowerCase("en-US");
  const candidate = MAKE_LABELS.find((item) => lower === item.label.toLocaleLowerCase("en-US") || lower.startsWith(`${item.label.toLocaleLowerCase("en-US")} `));
  const make = candidate?.make || "";
  const model = candidate ? title.slice(candidate.label.length).replace(/^\s*[-–—|]\s*/, "").split(/\s+/).slice(0, 8).join(" ").trim() : "";
  return { make, model };
}

function amount(value: string) {
  const result = integer(value);
  return result && result >= 1_000 ? result : undefined;
}

function price(plain: string) {
  const token = "([0-9]{1,3}(?:[, ]\\d{3})+|[0-9]{4,7})(?![0-9])";
  const patterns: Array<[RegExp, string, number]> = [
    [new RegExp(`(?:AED|د\\.?إ\\.?)\\s*${token}`, "i"), "AED", 10_000_000],
    [new RegExp(`(?:USD|US\\$|\\$)\\s*${token}`, "i"), "USD", 2_000_000],
    [new RegExp(`(?:SAR|ر\\.?س\\.?)\\s*${token}`, "i"), "SAR", 10_000_000],
    [new RegExp(`${token}\\s*(?:AED|د\\.?إ\\.?)`, "i"), "AED", 10_000_000],
    [new RegExp(`${token}\\s*(?:USD|US\\$)`, "i"), "USD", 2_000_000],
  ];
  for (const [pattern, currency, maximum] of patterns) {
    const matches = [...plain.matchAll(new RegExp(pattern.source, "gi"))];
    for (const match of matches) {
      const parsed = amount(match[1] || "");
      const start = Math.max(0, Number(match.index || 0) - 24);
      const end = Math.min(plain.length, Number(match.index || 0) + String(match[0] || "").length + 36);
      const context = plain.slice(start, end);
      if (/\bP\.?\s*M\.?\b|per\s+month|\/\s*month|monthly|installment|downpayment/i.test(context)) continue;
      if (parsed && parsed <= maximum) return { price: parsed, currency };
    }
  }
  return { price: undefined, currency: undefined };
}

function listingExplicitlyHasNoPrice(markup: string) {
  const inquiryPrice = markup.match(/Price%3A(?:\+|%20)*([0-9][0-9%2C,.+]*)%0A/i)?.[1];
  if (!inquiryPrice) return false;
  const decoded = decodeURIComponent(inquiryPrice.replace(/\+/g, " "));
  return Number(decoded.replace(/[^0-9]/g, "")) === 0;
}

function labelValue(plain: string, labels: string[], stops: string[]) {
  const labelPattern = labels.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const stopPattern = stops.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const pattern = new RegExp(`(?:^|\\s)(?:${labelPattern})\\s*[:：]?\\s*(.{1,80}?)(?=\\s+(?:${stopPattern})\\s*[:：]?|$)`, "gi");
  const matches = [...plain.matchAll(pattern)];
  return clean(matches.at(-1)?.[1]);
}

function normalizeFuel(value: string) {
  if (/electric|bev|ev\b/i.test(value)) return "electric";
  if (/plug.?in|phev/i.test(value)) return "phev";
  if (/hybrid|hev/i.test(value)) return "hybrid";
  if (/diesel/i.test(value)) return "diesel";
  if (/petrol|gasoline|gas\b/i.test(value)) return "petrol";
  return clean(value);
}

function normalizeTransmission(value: string) {
  if (/automatic|\bat\b|cvt|dct|dsg/i.test(value)) return "automatic";
  if (/manual|\bmt\b/i.test(value)) return "manual";
  return clean(value);
}

function normalizeDrive(value: string) {
  if (/all wheel|four wheel|4wd|awd|4x4/i.test(value)) return "awd";
  if (/rear wheel|rwd/i.test(value)) return "rwd";
  if (/front wheel|fwd|two wheel/i.test(value)) return "fwd";
  return clean(value);
}

function normalizeBody(value: string) {
  if (/suv|crossover|off.?road/i.test(value)) return "suv";
  if (/sedan|saloon/i.test(value)) return "sedan";
  if (/hatchback/i.test(value)) return "hatchback";
  if (/coupe/i.test(value)) return "coupe";
  if (/convertible|cabrio/i.test(value)) return "convertible";
  if (/pickup|pick up/i.test(value)) return "pickup";
  if (/van|mpv|minivan/i.test(value)) return "minivan";
  if (/wagon|estate/i.test(value)) return "wagon";
  return clean(value);
}

function images(markup: string, url: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/(?:data-src|data-original|data-lazy-src|src|content|poster)\s*=\s*["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']/gi)) {
    for (const part of match[1].split(",")) values.push(part.trim().split(/\s+/)[0]);
  }
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'<>\s\\]+\.(?:jpe?g|webp)(?:\?[^"'<>\s\\]*)?/gi)) values.push(match[0]);
  const valid = [...new Set(values
    .map((value) => absoluteUrl(value, url))
    .filter((value) => value && !BAD_IMAGE.test(value) && /\/images\/[a-f0-9]{6}\/(?:w_?\d+x\d+|\d+x\d+|f_?\d+x\d+)\/[^/?#]+\/[a-f0-9-]+\.(?:jpe?g|webp)(?:[?#]|$)/i.test(value) && !/\/(?:130x76|f_500x282)\//i.test(value)))];
  const groups = new Map<string, string[]>();
  for (const value of valid) {
    try {
      const parsed = new URL(value);
      const parts = parsed.pathname.split("/").filter(Boolean);
      const key = `${parsed.hostname}/${parts.slice(0, Math.max(1, parts.length - 1)).join("/")}`;
      groups.set(key, [...(groups.get(key) || []), value]);
    } catch { /* skip */ }
  }
  const best = [...groups.values()].sort((left, right) => right.length - left.length)[0];
  return best && best.length >= 2 ? best : valid;
}

function yearFromUrl(url: string) {
  try {
    return Number(new URL(url).pathname.match(/^\/((?:19|20)\d{2})-/)?.[1] || 0);
  } catch {
    return 0;
  }
}

export function parseDubicarsCurrentListing(markup: string, url: string): Row | null {
  const fullPlain = clean(markup);
  const rawTitle = clean(
    markup.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    || markup.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1],
  );
  const title = rawTitle.replace(/\s+(?:19|20)\d{2}\s+for sale.*$/i, "").trim();
  const parsedName = makeModel(title);
  const pageYear = Number(fullPlain.match(/(?:^|\s)(?:Model year|Year)\s*[:：]?\s*((?:19|20)\d{2})\b/i)?.[1] || 0);
  const urlYear = yearFromUrl(url);
  if (pageYear && urlYear && pageYear !== urlYear) return null;
  const year = pageYear || urlYear;
  if (!isCatalogYearAllowed(year, "uae")) return null;

  const stops = ["Transmission", "Export status", "Interior color", "Steering side", "Horsepower", "Updated on", "Make", "Model", "Trim", "Color", "Engine capacity", "Cylinders", "Drive type", "Vehicle type", "Number of doors", "Seating capacity", "Wheel size", "Fuel Type", "Service history", "Location", "Specs"];
  const exactMakeRaw = labelValue(fullPlain, ["Make"], stops);
  const exactModelRaw = labelValue(fullPlain, ["Model"], stops);
  const exactTrim = labelValue(fullPlain, ["Trim"], stops);
  const exactIdentity = exactMakeRaw && exactModelRaw ? makeModel(`${exactMakeRaw} ${exactModelRaw}`) : { make: "", model: "" };
  const make = exactIdentity.make || parsedName.make;
  const model = exactIdentity.model || clean(exactModelRaw) || parsedName.model;
  if (!make || !model) return null;

  // DubiCars detail pages contain prices from recommendation cards after the
  // primary listing. The listing-specific enquiry link carries Price: 0 when
  // the seller selected "Price on request"; never borrow a neighbour's price.
  const parsedPrice = listingExplicitlyHasNoPrice(markup)
    ? { price: undefined, currency: undefined }
    : price(fullPlain);
  const mileageKm = integer(
    fullPlain.match(/(?:Kilometers?|Mileage)\s*[:：]?\s*([0-9][0-9, ]+)\s*Km\b/i)?.[1]
    || fullPlain.match(/([0-9][0-9, ]+)\s*Km\b/i)?.[1],
  );
  const liters = decimal(
    fullPlain.match(/Engine capacity\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)\s*L\b/i)?.[1]
    || fullPlain.match(/\b([0-9]+(?:\.[0-9]+)?)L\b/i)?.[1],
  );
  const engineCc = liters ? Math.round(liters * 1_000) : integer(fullPlain.match(/([0-9][0-9, ]+)\s*cc\b/i)?.[1]);
  const parsedPowerHp = integer(
    fullPlain.match(/Horsepower\s*[:：]?\s*([0-9]{2,4})\s*(?:HP|PS|BHP)?\b/i)?.[1]
    || fullPlain.match(/\b([0-9]{2,4})\s*(?:HP|PS|BHP)\b/i)?.[1]
    || title.match(/\b([0-9]{2,4})\s*HP\b/i)?.[1],
  );
  const powerHp = parsedPowerHp && parsedPowerHp <= 1_500 ? parsedPowerHp : undefined;

  const fuelRaw = labelValue(fullPlain, ["Fuel Type", "Fuel"], stops) || fullPlain.match(/\bFuel\s*:\s*([A-Za-z -]{3,24})/i)?.[1] || "";
  const transmissionRaw = labelValue(fullPlain, ["Transmission"], stops);
  const driveRaw = labelValue(fullPlain, ["Drive type", "Drive Train"], stops);
  const bodyRaw = labelValue(fullPlain, ["Vehicle type", "Body Style"], stops);
  const color = labelValue(fullPlain, ["Color", "Exterior color"], stops);
  const photos = images(markup, url);
  if (!photos.length) return null;

  return {
    id: url.match(/-(\d{5,})\.html/i)?.[1] || url,
    url,
    title,
    make,
    model,
    trim: exactTrim || undefined,
    year,
    price: parsedPrice.price,
    currency: parsedPrice.currency,
    mileageKm,
    engineCc,
    powerHp,
    fuel: normalizeFuel(fuelRaw),
    transmission: normalizeTransmission(transmissionRaw),
    drive: normalizeDrive(driveRaw),
    bodyType: normalizeBody(bodyRaw),
    color,
    images: photos,
  };
}

export class DubicarsCurrentAdapter implements CatalogSourceAdapter {
  sourceId = "dubicars_uae_exact";
  market = "uae" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const listUrl = `https://www.dubicars.com/uae/used?page=${page}`;
    const listing = await request(listUrl);
    if (!listing.response.ok) throw new Error(`dubicars_current_http_${listing.response.status}`);
    const links = [...new Set([...listing.markup.matchAll(/href=["']([^"']+-\d{5,}\.html)["']/gi)].map((match) => absoluteUrl(match[1], listUrl)))].slice(0, 40);
    const rows: Row[] = [];
    for (let index = 0; index < links.length; index += 4) {
      const batch = await Promise.all(links.slice(index, index + 4).map(async (detailUrl) => {
        const detail = await request(detailUrl, listUrl).catch(() => null);
        return detail?.response.ok ? parseDubicarsCurrentListing(detail.markup, detailUrl) : null;
      }));
      rows.push(...batch.filter(Boolean) as Row[]);
      if (index + 4 < links.length) await new Promise((resolve) => setTimeout(resolve, 160));
    }
    if (!rows.length) throw new Error("dubicars_current_zero");
    return {
      items: rows,
      nextCursor: String(page + 1),
      finished: false,
      count: rows.length,
      health: {
        ok: true,
        message: `DubiCars page ${page}: ${rows.length}`,
        checkedAt: new Date().toISOString(),
        httpStatus: listing.response.status,
        contentType: listing.response.headers.get("content-type") || "",
      },
    };
  }

  mapStatus(): OfferStatus { return "active"; }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as Row;
    if (!row.id || !row.make || !row.model || !isCatalogYearAllowed(row.year, "uae") || !row.images.length) return null;
    const now = new Date().toISOString();
    return normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, row.id), sourceId: this.sourceId, sourceOfferId: row.id, market: "uae", offerType: "fixed", status: "active",
      make: row.make, model: row.model, trim: row.trim || row.title, year: row.year, mileageKm: row.mileageKm, engineCc: row.engineCc, powerHp: row.powerHp,
      fuel: row.fuel, transmission: row.transmission, drive: row.drive, bodyType: row.bodyType, color: row.color,
      sourcePrice: row.price || null, sourceCurrency: row.price ? (row.currency || "AED") : null, priceMode: row.price ? "fixed" : "estimated",
      images: [], totalRub: null, calculationStatus: row.price ? "ready" : "needs_data", firstSeenAt: now, updatedAt: now,
      operational: { sourceUrl: row.url, sourceVenueName: "DubiCars UAE", raw: row },
    } as VehicleOffer);
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const row = offer.operational.raw as Row;
    const requested = Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30);
    const limit = Math.min(30, Math.max(4, Number.isFinite(requested) ? requested : 30));
    const cached: CatalogImage[] = [];
    for (let index = 0; index < row.images.length && cached.length < limit; index += 4) {
      const batch = await Promise.all(row.images.slice(index, index + 4).map((imageUrl) =>
        cacheImageFromUrl(imageUrl, "uae", { headers: { ...HEADERS, accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8", referer: row.url } }).catch(() => null),
      ));
      for (const image of batch) if (image && image.size > 8_000) cached.push(image);
      if (index + 4 < row.images.length) await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return cached.slice(0, limit);
  }

  async healthCheck() {
    return { ok: true, message: "DubiCars exact detail pages with complete real gallery photos", checkedAt: new Date().toISOString() };
  }
}

export const dubicarsUaeCurrentSource = new DubicarsCurrentAdapter();

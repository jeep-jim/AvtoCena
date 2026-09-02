import { CATALOG_BRANDS } from "./brands";
import { cacheImageFromUrl, stableOfferId } from "./storage";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import { parseCatalogHorsepowerToken } from "./power-sanity";
import { isCatalogYearAllowed } from "./offer-quality";
import { canonicalSourceFuel } from "./powertrain-safety";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

type DubicarsEvidenceStatus = "exact" | "ambiguous" | "conflict" | "missing";
type DubicarsEvidence<T> = { value?: T; rawValues: string[]; status: DubicarsEvidenceStatus };
export type DubicarsSpecificationEvidence = {
  year: DubicarsEvidence<number>;
  fuel: DubicarsEvidence<string>;
  engineCc: DubicarsEvidence<number>;
  powerHp: DubicarsEvidence<number>;
  powerKw: DubicarsEvidence<number>;
};

export type DubicarsCurrentRow = {
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
  semanticEvidence?: DubicarsSpecificationEvidence;
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

const BAD_IMAGE = /logo|icon|avatar|qrcode|qr-code|placeholder|banner|related|similar|people-also-viewed|tracking|pixel|calendar|calender|kilometers|share|email|heart|settings|feature_groups|social|homepage|mobile-mockup/i;

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

function labelValues(plain: string, labels: string[], stops: string[]) {
  const labelPattern = labels.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const stopPattern = stops.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const pattern = new RegExp(`(?:^|\\s)(?:${labelPattern})\\s*[:：]?\\s*(.{1,80}?)(?=\\s+(?:${stopPattern})\\s*[:：]?|$)`, "gi");
  return [...new Set([...plain.matchAll(pattern)].map((match) => clean(match[1])).filter(Boolean))];
}

function labelValue(plain: string, labels: string[], stops: string[]) {
  return labelValues(plain, labels, stops).at(-1) || "";
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

function specificationText(plain: string) {
  const start = plain.search(/(?:^|\s)(?:Model year|Year)\s*[:：]?\s*(?:19|20)\d{2}\b/i);
  if (start < 0) return "";
  const candidate = plain.slice(start, Math.min(plain.length, start + 3_000));
  const end = candidate.slice(20).search(/\b(?:Description|Seller description|Similar cars|People also viewed|Recommended cars|Location map)\b/i);
  return end >= 0 ? candidate.slice(0, end + 20) : candidate;
}

function exactYearEvidence(pageYear: number, urlYear: number): DubicarsEvidence<number> {
  const rawValues = [pageYear, urlYear].filter(Boolean).map(String);
  const values = [...new Set([pageYear, urlYear].filter((value) => Number.isInteger(value) && value >= 1900 && value <= new Date().getUTCFullYear() + 1))];
  if (values.length > 1) return { rawValues, status: "conflict" };
  if (values.length === 1) return { value: values[0], rawValues, status: "exact" };
  return { rawValues, status: rawValues.length ? "ambiguous" : "missing" };
}

function evidenceRawValues(rawValue: string | string[] | undefined) {
  return [...new Set((Array.isArray(rawValue) ? rawValue : [rawValue]).map(clean).filter(Boolean))];
}

function engineEvidence(rawValue: string | string[] | undefined): DubicarsEvidence<number> {
  const rawValues = evidenceRawValues(rawValue);
  if (!rawValues.length) return { rawValues, status: "missing" };
  const values: number[] = [];
  for (const raw of rawValues) {
    if (/(?:\d)\s*(?:-|–|—|to)\s*(?:\d)/i.test(raw)) return { rawValues, status: "ambiguous" };
    const liters = raw.match(/^([0-9]+(?:[.,][0-9]+)?)\s*l(?:itre|iter)?s?$/i);
    const cc = raw.match(/^([0-9][0-9, ]{2,7})\s*(?:cc|cm3|cm³)$/i);
    const value = liters ? Math.round(Number(liters[1].replace(",", ".")) * 1_000) : integer(cc?.[1]);
    if (!value || value < 300 || value > 10_000) return { rawValues, status: "ambiguous" };
    values.push(value);
  }
  const unique = [...new Set(values)];
  return unique.length === 1 ? { value: unique[0], rawValues, status: "exact" } : { rawValues, status: "conflict" };
}

function powerEvidence(rawValue: string | string[] | undefined): DubicarsEvidence<number> {
  const rawValues = evidenceRawValues(rawValue);
  if (!rawValues.length) return { rawValues, status: "missing" };
  const values: number[] = [];
  for (const raw of rawValues) {
    if (/(?:\d)\s*(?:-|–|—|to)\s*(?:\d)/i.test(raw)) return { rawValues, status: "ambiguous" };
    const value = /^[0-9][0-9, .]*\s*(?:hp|ps|bhp)$/i.test(raw) ? parseCatalogHorsepowerToken(raw) : undefined;
    if (!value || value < 20 || value > 1_500) return { rawValues, status: "ambiguous" };
    values.push(value);
  }
  const unique = [...new Set(values)];
  return unique.length === 1 ? { value: unique[0], rawValues, status: "exact" } : { rawValues, status: "conflict" };
}

function fuelEvidence(rawValue: string | string[] | undefined): DubicarsEvidence<string> {
  const rawValues = evidenceRawValues(rawValue);
  if (!rawValues.length) return { rawValues, status: "missing" };
  const values = rawValues.map(canonicalSourceFuel);
  if (values.some((value) => !value)) return { rawValues, status: "ambiguous" };
  const unique = [...new Set(values as string[])];
  return unique.length === 1 ? { value: unique[0], rawValues, status: "exact" } : { rawValues, status: "conflict" };
}

export function dubicarsSpecificationEvidence(input: {
  pageYear?: number;
  urlYear?: number;
  fuel?: string | string[];
  engine?: string | string[];
  power?: string | string[];
}): DubicarsSpecificationEvidence {
  const fuel = fuelEvidence(input.fuel);
  let engineCc = engineEvidence(input.engine);
  if (fuel.status === "exact" && fuel.value === "electric" && engineCc.status === "exact") {
    engineCc = { rawValues: engineCc.rawValues, status: "conflict" };
  }
  return {
    year: exactYearEvidence(Number(input.pageYear || 0), Number(input.urlYear || 0)),
    fuel,
    engineCc,
    powerHp: powerEvidence(input.power),
    powerKw: { rawValues: [], status: "missing" },
  };
}

function powertrainKindForFuel(fuel: string | undefined, identity = "") {
  if (fuel === "electric") return "electric" as const;
  if (fuel === "hybrid") return /series[ -]?hybrid|range[ -]?extender|\b(?:erev|reev)\b|\be[ -]?power\b/i.test(identity)
    ? "series_hybrid" as const
    : "other_hybrid" as const;
  if (fuel) return "combustion" as const;
  return "unknown" as const;
}

export function parseDubicarsCurrentListing(markup: string, url: string): DubicarsCurrentRow | null {
  const fullPlain = clean(markup);
  const rawTitle = clean(
    markup.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    || markup.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1],
  );
  const title = rawTitle.replace(/\s+(?:19|20)\d{2}\s+for sale.*$/i, "").trim();
  const parsedName = makeModel(title);
  const specsPlain = specificationText(fullPlain);
  const pageYear = Number(specsPlain.match(/(?:^|\s)(?:Model year|Year)\s*[:：]?\s*((?:19|20)\d{2})\b/i)?.[1] || 0);
  const urlYear = yearFromUrl(url);
  const yearEvidence = exactYearEvidence(pageYear, urlYear);
  if (yearEvidence.status !== "exact") return null;
  const year = yearEvidence.value || 0;
  if (!isCatalogYearAllowed(year, "uae")) return null;

  const stops = ["Transmission", "Export status", "Interior color", "Steering side", "Horsepower", "Updated on", "Make", "Model", "Trim", "Color", "Engine capacity", "Cylinders", "Drive type", "Vehicle type", "Number of doors", "Seating capacity", "Wheel size", "Fuel Type", "Service history", "Location", "Specs"];
  const exactMakeRaw = labelValue(specsPlain, ["Make"], stops);
  const exactModelRaw = labelValue(specsPlain, ["Model"], stops);
  const exactTrim = labelValue(specsPlain, ["Trim"], stops);
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
  const mileageKm = integer(specsPlain.match(/(?:Kilometers?|Mileage)\s*[:：]?\s*([0-9][0-9, ]+)\s*Km\b/i)?.[1]);
  const engineRaw = labelValues(specsPlain, ["Engine capacity"], stops);
  const powerRaw = labelValues(specsPlain, ["Horsepower"], stops);
  const fuelRaw = labelValues(specsPlain, ["Fuel Type", "Fuel"], stops);
  const semanticEvidence = dubicarsSpecificationEvidence({ pageYear, urlYear, fuel: fuelRaw, engine: engineRaw, power: powerRaw });
  const transmissionRaw = labelValue(specsPlain, ["Transmission"], stops);
  const driveRaw = labelValue(specsPlain, ["Drive type", "Drive Train"], stops);
  const bodyRaw = labelValue(specsPlain, ["Vehicle type", "Body Style"], stops);
  const color = labelValue(specsPlain, ["Color", "Exterior color"], stops);
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
    engineCc: semanticEvidence.engineCc.status === "exact" ? semanticEvidence.engineCc.value : undefined,
    powerHp: semanticEvidence.powerHp.status === "exact" ? semanticEvidence.powerHp.value : undefined,
    fuel: semanticEvidence.fuel.status === "exact" ? semanticEvidence.fuel.value : undefined,
    transmission: normalizeTransmission(transmissionRaw),
    drive: normalizeDrive(driveRaw),
    bodyType: normalizeBody(bodyRaw),
    color,
    images: photos,
    semanticEvidence,
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
    const rows: DubicarsCurrentRow[] = [];
    for (let index = 0; index < links.length; index += 4) {
      const batch = await Promise.all(links.slice(index, index + 4).map(async (detailUrl) => {
        const detail = await request(detailUrl, listUrl).catch(() => null);
        return detail?.response.ok ? parseDubicarsCurrentListing(detail.markup, detailUrl) : null;
      }));
      rows.push(...batch.filter(Boolean) as DubicarsCurrentRow[]);
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
    const row = raw as DubicarsCurrentRow;
    if (!row.id || !row.make || !row.model || !isCatalogYearAllowed(row.year, "uae") || !row.images.length) return null;
    const now = new Date().toISOString();
    const semanticEvidence = row.semanticEvidence || dubicarsSpecificationEvidence({ urlYear: row.year, fuel: row.fuel, engine: row.engineCc ? `${row.engineCc} cc` : "", power: row.powerHp ? `${row.powerHp} hp` : "" });
    const fuel = semanticEvidence.fuel.status === "exact" ? semanticEvidence.fuel.value : undefined;
    const engineCc = semanticEvidence.engineCc.status === "exact" ? semanticEvidence.engineCc.value : undefined;
    const powerHp = semanticEvidence.powerHp.status === "exact" ? semanticEvidence.powerHp.value : undefined;
    const identity = [row.make, row.model, row.trim, row.title].filter(Boolean).join(" ");
    const powertrainKind = powertrainKindForFuel(fuel, identity);
    const normalized = normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, row.id), sourceId: this.sourceId, sourceOfferId: row.id, market: "uae", offerType: "fixed", status: "active",
      make: row.make, model: row.model, trim: row.trim || row.title, year: row.year, mileageKm: row.mileageKm, engineCc, powerHp,
      fuel, powertrainKind, transmission: row.transmission, drive: row.drive, bodyType: row.bodyType, color: row.color,
      powerDataConfidence: powerHp ? "source_exact" : undefined,
      powerDataSource: powerHp ? `DubiCars exact detail:${row.id}:Horsepower` : undefined,
      sourcePrice: row.price || null, sourceCurrency: row.price ? (row.currency || "AED") : null, priceMode: row.price ? "fixed" : "estimated",
      images: [], totalRub: null, calculationStatus: "needs_data", firstSeenAt: now, updatedAt: now,
      operational: {
        sourceUrl: row.url,
        sourceVenueName: "DubiCars UAE",
        semanticEvidence: {
          year: { source: "dubicars_detail_and_url_year", ...semanticEvidence.year },
          fuel: { source: "dubicars_detail_fuel_type", ...semanticEvidence.fuel },
          engineCc: { source: "dubicars_detail_engine_capacity", ...semanticEvidence.engineCc },
          powerHp: { source: "dubicars_detail_horsepower", ...semanticEvidence.powerHp },
          powerKw: { source: "dubicars_source_missing", ...semanticEvidence.powerKw },
        },
        raw: row,
      },
    } as VehicleOffer);
    normalized.fuel = fuel;
    normalized.powertrainKind = powertrainKind;
    normalized.engineCc = engineCc;
    normalized.powerHp = powerHp;
    normalized.powerKw = powerHp ? Math.round((powerHp / 1.35962) * 100) / 100 : undefined;
    normalized.powerDataConfidence = powerHp ? "source_exact" : undefined;
    normalized.powerDataSource = powerHp ? `DubiCars exact detail:${row.id}:Horsepower` : undefined;
    if (!powerHp) {
      normalized.icePowerKw = undefined;
      normalized.utilizationPowerKw = undefined;
    }
    return normalized;
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const row = offer.operational.raw as DubicarsCurrentRow;
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

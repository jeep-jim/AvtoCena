import { isCatalogYearAllowed } from "./offer-quality";
import { stableOfferId } from "./storage";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

const BASE_URL = "https://carswitch.com";
const LIST_URL = "https://carswitch.com/uae/used-cars/search?app_route=listing";
const HEADERS = {
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
};
const BLOCK_RE = /captcha|access denied|request blocked|verify you are human|forbidden|cloudflare|pardon our interruption|incapsula|imperva/i;
const EXACT_PATH_RE = /^\/(?:dubai|abudhabi|sharjah|ajman|umm-al-quwain|ras-al-khaimah|fujairah)\/used-car\/([^/]+)\/([^/]+)\/((?:19|20)\d{2})\/(\d{5,12})\/?$/i;
const BAD_IMAGE_RE = /logo|icon|avatar|placeholder|banner|tracking|pixel|static\/icons|static\/images\/og-image/i;

const MAKE_MAP: Record<string, string> = {
  mercedes: "Mercedes-Benz",
  volkswagen: "Volkswagen",
  "land-rover": "Land Rover",
  "range-rover": "Land Rover",
  rollsroyce: "Rolls-Royce",
  "rolls-royce": "Rolls-Royce",
  toyota: "Toyota",
  nissan: "Nissan",
  lexus: "Lexus",
  infiniti: "Infiniti",
  honda: "Honda",
  hyundai: "Hyundai",
  kia: "Kia",
  bmw: "BMW",
  audi: "Audi",
  porsche: "Porsche",
  ford: "Ford",
  chevrolet: "Chevrolet",
  cadillac: "Cadillac",
  dodge: "Dodge",
  jeep: "Jeep",
  mazda: "Mazda",
  mitsubishi: "Mitsubishi",
  subaru: "Subaru",
  suzuki: "Suzuki",
  volvo: "Volvo",
  tesla: "Tesla",
  byd: "BYD",
  jetour: "Jetour",
  geely: "Geely",
  chery: "Chery",
  haval: "Haval",
};

export type CarSwitchExactRow = {
  id: string;
  sourceUrl: string;
  make: string;
  model: string;
  trim?: string;
  year: number;
  mileageKm?: number;
  price: number;
  currency: "AED";
  images: string[];
  vin?: string;
};

function clean(value: unknown) {
  return String(value ?? "").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim();
}

function titleCaseSlug(value: string) {
  return value.split(/[-_]+/).filter(Boolean).map((token) => {
    if (/^[a-z]\d+$/i.test(token) || /^\d+[a-z]?$/i.test(token)) return token.toUpperCase();
    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
  }).join(" ");
}

function integer(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function exactIdentity(url: string) {
  try {
    const parsed = new URL(url, BASE_URL);
    if (!/(^|\.)carswitch\.com$/i.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(EXACT_PATH_RE);
    if (!match) return null;
    const [, makeSlug, modelSlug, yearToken, id] = match;
    const year = Number(yearToken);
    if (!isCatalogYearAllowed(year, "uae")) return null;
    const make = MAKE_MAP[makeSlug.toLowerCase()] || titleCaseSlug(makeSlug);
    const model = titleCaseSlug(modelSlug);
    if (!make || !model || !/^\d{5,12}$/.test(id)) return null;
    return { id, sourceUrl: parsed.toString(), make, model, year };
  } catch {
    return null;
  }
}

function jsonScripts(markup: string) {
  return [...markup.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function decodeJsonScript(script: string) {
  try {
    return JSON.parse(script.replace(/&quot;/gi, '"').replace(/&amp;/gi, "&"));
  } catch {
    return null;
  }
}

function itemLists(value: unknown): any[] {
  if (Array.isArray(value)) return value.flatMap(itemLists);
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  const type = row["@type"];
  const types = Array.isArray(type) ? type.map(String) : [String(type || "")];
  const own = types.some((item) => item.toLowerCase() === "itemlist") ? [row] : [];
  const graph = Array.isArray(row["@graph"]) ? itemLists(row["@graph"]) : [];
  return [...own, ...graph];
}

function vehicleEntities(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(vehicleEntities);
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  const type = row["@type"];
  const types = Array.isArray(type) ? type.map(String) : [String(type || "")];
  const own = types.some((item) => ["car", "product", "vehicle"].includes(item.toLowerCase())) ? [row] : [];
  const nested = Object.values(row).flatMap((child) => child && typeof child === "object" ? vehicleEntities(child) : []);
  return [...own, ...nested];
}

function imagesFromEntity(entity: Record<string, unknown>) {
  const raw = entity.image;
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const urls = values.map((value) => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object") return String((value as any).url || (value as any).contentUrl || "");
    return "";
  });
  return [...new Set(urls.map(clean).filter((url) => {
    try {
      const parsed = new URL(url, BASE_URL);
      return /^https?:$/i.test(parsed.protocol) && !BAD_IMAGE_RE.test(parsed.toString()) && /cloudfront\.net|carswitch\.com/i.test(parsed.hostname);
    } catch { return false; }
  }))].slice(0, 30);
}

function entityMileage(entity: Record<string, unknown>) {
  const odometer = entity.mileageFromOdometer;
  if (!odometer || typeof odometer !== "object") return undefined;
  const value = integer((odometer as any).value);
  const unit = clean((odometer as any).unitCode || (odometer as any).unitText).toUpperCase();
  if (!value) return undefined;
  return /SMI|MILE/.test(unit) ? Math.round(value * 1.609344) : value;
}

function entityPrice(entity: Record<string, unknown>) {
  const offers = entity.offers;
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const currency = clean((raw as any).priceCurrency).toUpperCase();
    const value = integer((raw as any).price);
    if (currency === "AED" && value && value >= 1_000 && value <= 10_000_000) return value;
  }
  return undefined;
}

function rowTrim(entity: Record<string, unknown>, identity: NonNullable<ReturnType<typeof exactIdentity>>) {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let value = clean(entity.name);
  value = value.replace(new RegExp(`^${identity.year}\\s+`, "i"), "");
  value = value.replace(new RegExp(`^${escape(identity.make)}\\s+`, "i"), "");
  value = value.replace(new RegExp(`^${escape(identity.model)}\\s*`, "i"), "");
  return value.trim() || undefined;
}

function rowFromEntity(entity: Record<string, unknown>, identity: NonNullable<ReturnType<typeof exactIdentity>>, minimumImages: number): CarSwitchExactRow | null {
  const price = entityPrice(entity);
  const images = imagesFromEntity(entity);
  if (!price || images.length < minimumImages) return null;
  return {
    ...identity,
    trim: rowTrim(entity, identity),
    mileageKm: entityMileage(entity),
    price,
    currency: "AED",
    images,
    vin: clean(entity.vehicleIdentificationNumber) || undefined,
  };
}

export function parseCarSwitchExactListing(markup: string): CarSwitchExactRow[] {
  const output: CarSwitchExactRow[] = [];
  const seen = new Set<string>();
  for (const script of jsonScripts(markup)) {
    const decoded = decodeJsonScript(script);
    if (!decoded) continue;
    for (const list of itemLists(decoded)) {
      const elements = Array.isArray(list.itemListElement) ? list.itemListElement : [];
      for (const element of elements) {
        if (!element || typeof element !== "object") continue;
        const sourceUrl = clean((element as any).url || (element as any).item?.url);
        const identity = exactIdentity(sourceUrl);
        if (!identity || seen.has(identity.id)) continue;
        const mainEntity = ((element as any).mainEntity || (element as any).item?.mainEntity || (element as any).item) as Record<string, unknown> | undefined;
        if (!mainEntity || typeof mainEntity !== "object") continue;
        // CarSwitch list JSON-LD currently exposes one exact vehicle image. Keep
        // that row for discovery; fetchImages() binds the full gallery from the
        // same exact vehicle's detail JSON-LD before publication.
        const row = rowFromEntity(mainEntity, identity, 1);
        if (!row) continue;
        seen.add(identity.id);
        output.push(row);
      }
    }
  }
  return output;
}

export function parseCarSwitchExactDetail(markup: string, expectedSourceUrl: string): CarSwitchExactRow | null {
  const expected = exactIdentity(expectedSourceUrl);
  if (!expected) return null;
  for (const script of jsonScripts(markup)) {
    const decoded = decodeJsonScript(script);
    if (!decoded) continue;
    for (const entity of vehicleEntities(decoded)) {
      const identity = exactIdentity(clean(entity.url));
      if (!identity || identity.id !== expected.id || identity.sourceUrl !== expected.sourceUrl) continue;
      const row = rowFromEntity(entity, expected, 2);
      if (row) return row;
    }
  }
  return null;
}

async function request(url: string, referer = LIST_URL) {
  const timeoutMs = Math.max(5_000, Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 30_000));
  const retryDelayMs = Math.max(0, Number(process.env.CATALOG_CARSWITCH_RETRY_DELAY_MS || 750));
  let lastStatus = 0;
  let lastBytes = 0;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { headers: { ...HEADERS, referer }, redirect: "follow", signal: controller.signal });
      const markup = await response.text();
      lastStatus = response.status;
      lastBytes = markup.length;
      if ([401, 403, 429].includes(response.status) || BLOCK_RE.test(markup.slice(0, 10_000))) throw new Error(`carswitch_exact_blocked_${response.status}`);
      const transientShell = response.status === 202;
      if (transientShell) {
        if (attempt < 3) {
          if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
          continue;
        }
        throw new Error(`carswitch_exact_transient_status_${response.status}_bytes_${markup.length}`);
      }
      if (!response.ok) throw new Error(`carswitch_exact_http_${response.status}`);
      return { response, markup };
    } finally { clearTimeout(timer); }
  }
  throw new Error(`carswitch_exact_transient_status_${lastStatus}_bytes_${lastBytes}`);
}

function asImage(url: string): CatalogImage {
  return { id: "", url, objectKey: "", checksum: "", size: 0, mimeType: /\.webp(?:[?#]|$)/i.test(url) ? "image/webp" : "image/jpeg" };
}

export class CarSwitchUaeExactAdapter implements CatalogSourceAdapter {
  sourceId = "carswitch_uae_open";
  market = "uae" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const url = `${LIST_URL}&page=${page}`;
    const { response, markup } = await request(url);
    const items = parseCarSwitchExactListing(markup);
    if (!items.length) throw new Error(`carswitch_exact_parsed_zero_status_${response.status}_bytes_${markup.length}`);
    return {
      items,
      nextCursor: String(page + 1),
      finished: false,
      count: items.length,
      health: { ok: true, message: `CarSwitch exact JSON-LD page ${page}: ${items.length}`, checkedAt: new Date().toISOString(), httpStatus: response.status, contentType: response.headers.get("content-type") || "" },
    };
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as CarSwitchExactRow;
    if (!row?.id || !row.sourceUrl || !row.make || !row.model || !isCatalogYearAllowed(row.year, "uae") || !(row.price > 0) || row.images.length < 1) return null;
    const now = new Date().toISOString();
    const galleryVerified = row.images.length >= 2;
    return {
      id: stableOfferId(this.sourceId, row.id), sourceId: this.sourceId, sourceOfferId: row.id, market: "uae", offerType: "fixed", status: "active",
      sourceTitle: `${row.year} ${row.make} ${row.model}${row.trim ? ` ${row.trim}` : ""}`.trim(), make: row.make, model: row.model, trim: row.trim, year: row.year,
      mileageKm: row.mileageKm, sourcePrice: row.price, sourceCurrency: "AED", priceMode: "fixed", images: [], totalRub: null, calculationStatus: "needs_data",
      firstSeenAt: now, updatedAt: now,
      operational: {
        sourceUrl: row.sourceUrl, sourceVenueName: "CarSwitch UAE", exactDetail: false, exactFields: true, exactPhotos: galleryVerified,
        galleryVerified, galleryImageCount: row.images.length, gallerySafetyMode: galleryVerified ? "carswitch_exact_vehicle_detail_jsonld_v2" : "carswitch_itemlist_exact_vehicle_jsonld_discovery_v2", galleryStoredAs: "json_urls", photoIdentityVerified: galleryVerified,
        raw: { parsed: row, images: row.images, listingBoundImages: true, detailIdentityVerified: false, photoIdentityVerified: galleryVerified, cashPriceAuthority: "schema_org_offer_price", vehicleIdentificationNumber: row.vin || null },
      },
    } as VehicleOffer;
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const raw = offer.operational?.raw as { parsed?: CarSwitchExactRow; images?: string[] } | undefined;
    const row = raw?.parsed;
    if (!row || row.id !== String(offer.sourceOfferId || "") || exactIdentity(row.sourceUrl)?.id !== row.id) return [];
    const { response, markup } = await request(row.sourceUrl, LIST_URL);
    const responseIdentity = exactIdentity(response.url || row.sourceUrl);
    if (!responseIdentity || responseIdentity.id !== row.id) throw new Error(`carswitch_exact_detail_identity_${row.id}`);
    const detail = parseCarSwitchExactDetail(markup, row.sourceUrl);
    if (!detail || detail.id !== row.id || detail.images.length < 2) throw new Error(`carswitch_exact_detail_gallery_${row.id}`);

    offer.sourcePrice = detail.price;
    offer.sourceCurrency = "AED";
    offer.mileageKm = detail.mileageKm || offer.mileageKm;
    offer.trim = detail.trim || offer.trim;
    const op = offer.operational as any;
    op.exactDetail = true;
    op.exactFields = true;
    op.exactPhotos = true;
    op.galleryVerified = true;
    op.galleryImageCount = detail.images.length;
    op.gallerySafetyMode = "carswitch_exact_vehicle_detail_jsonld_v2";
    op.galleryStoredAs = "json_urls";
    op.photoIdentityVerified = true;
    op.raw = {
      ...(op.raw || {}),
      parsed: detail,
      images: detail.images,
      listingBoundImages: true,
      detailIdentityVerified: true,
      photoIdentityVerified: true,
      cashPriceAuthority: "schema_org_offer_price_exact_detail",
      vehicleIdentificationNumber: detail.vin || row.vin || null,
    };

    const limit = Math.min(30, Math.max(2, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
    return detail.images.slice(0, limit).map(asImage);
  }

  mapStatus(): OfferStatus { return "active"; }
  async healthCheck() { return { ok: true, message: "CarSwitch exact ItemList discovery + exact detail vehicle JSON-LD gallery", checkedAt: new Date().toISOString() }; }
}

export const carswitchUaeExactSource = new CarSwitchUaeExactAdapter();

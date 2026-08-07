import { stableOfferId } from "./storage";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

type ListingMeta = {
  id: string;
  url: string;
  make: string;
  model: string;
  year: number;
  sourcePrice: number;
  sourceCurrency: "AED";
  mileageKm?: number;
};

type Row = ListingMeta & {
  title: string;
  engineCc?: number;
  powerHp?: number;
  fuel?: string;
  transmission?: string;
  drive?: string;
  bodyType?: string;
  images: string[];
};

const HEADERS = {
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};
const BAD_IMAGE = /logo|icon|avatar|qrcode|qr-code|placeholder|banner|related|similar|dealer|tracking|pixel|calendar|share|email|heart|settings|feature_groups|social|inspection|diagram|sheet/i;

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/\\u002f/gi, "/").replace(/\\u003a/gi, ":").replace(/\\u0026/gi, "&").replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim();
}
function absolute(value: string, base: string) { try { return new URL(value.replace(/&amp;/gi, "&").replace(/\\\//g, "/"), base).toString(); } catch { return ""; } }
function int(value: unknown) { const n = Number(String(value ?? "").replace(/[^0-9]/g, "")); return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined; }
function decimal(value: unknown) { const n = Number(String(value ?? "").replace(",", ".").replace(/[^0-9.]/g, "")); return Number.isFinite(n) && n > 0 ? n : undefined; }

async function request(url: string, referer = "https://www.dubicars.com/uae/used") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 35_000));
  try {
    const response = await fetch(url, { headers: { ...HEADERS, referer }, redirect: "follow", signal: controller.signal });
    return { response, markup: await response.text() };
  } finally { clearTimeout(timer); }
}

function normalizeFuel(value: string) {
  if (/electric|\bbev\b|\bev\b/i.test(value)) return "electric";
  if (/plug.?in|phev/i.test(value)) return "phev";
  if (/hybrid|hev/i.test(value)) return "hybrid";
  if (/diesel/i.test(value)) return "diesel";
  if (/petrol|gasoline/i.test(value)) return "petrol";
  return clean(value);
}
function normalizeTransmission(value: string) {
  if (/automatic/i.test(value)) return "automatic";
  if (/cvt/i.test(value)) return "cvt";
  if (/dct|dsg|dual clutch/i.test(value)) return "dct";
  if (/manual/i.test(value)) return "manual";
  return clean(value);
}
function normalizeDrive(value: string) {
  if (/all wheel|four wheel|4wd|awd|4x4/i.test(value)) return "awd";
  if (/rear wheel|rwd/i.test(value)) return "rwd";
  if (/front wheel|fwd/i.test(value)) return "fwd";
  return clean(value);
}
function normalizeBody(value: string) {
  if (/suv|crossover/i.test(value)) return "suv";
  if (/sedan|saloon/i.test(value)) return "sedan";
  if (/hatch/i.test(value)) return "hatchback";
  if (/coupe/i.test(value)) return "coupe";
  if (/convertible|cabrio/i.test(value)) return "convertible";
  if (/pickup|pick up/i.test(value)) return "pickup";
  if (/van|mpv|minivan/i.test(value)) return "minivan";
  if (/wagon|estate/i.test(value)) return "wagon";
  return clean(value);
}

function listingMeta(markup: string, listUrl: string) {
  const byId = new Map<string, ListingMeta>();
  for (const match of markup.matchAll(/href=["'](whatsapp:\/\/send\?[^"']+)["']/gi)) {
    try {
      const rawHref = match[1].replace(/&amp;/gi, "&");
      const uri = new URL(rawHref);
      const message = uri.searchParams.get("text") || "";
      const id = message.match(/Reference:\s*dc-(\d+)/i)?.[1] || "";
      const make = clean(message.match(/Make:\s*([^\r\n]+)/i)?.[1]);
      const model = clean(message.match(/Model:\s*([^\r\n]+)/i)?.[1]);
      const sourcePrice = int(message.match(/Price:\s*([0-9, ]+)/i)?.[1]);
      const year = Number(message.match(/Year:\s*((?:19|20)\d{2})/i)?.[1] || 0);
      const mileageKm = int(message.match(/Mileage:\s*([0-9, ]+)/i)?.[1]);
      const link = clean(message.match(/Link:\s*(https?:\/\/[^\s]+)/i)?.[1]);
      const url = absolute(link, listUrl);
      if (!id || !make || !model || !sourcePrice || !year || !url || !new RegExp(`-${id}\\.html(?:[?#]|$)`, "i").test(url)) continue;
      byId.set(id, { id, url, make, model, year, sourcePrice, sourceCurrency: "AED", mileageKm });
    } catch {}
  }
  return [...byId.values()];
}

function exactGallery(markup: string, detailUrl: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/(?:data-src|data-original|data-lazy-src|src|content|poster)\s*=\s*["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']/gi)) for (const p of match[1].split(",")) values.push(p.trim().split(/\s+/)[0]);
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'<>\s\\]+\.(?:jpe?g|webp)(?:\?[^"'<>\s\\]*)?/gi)) values.push(match[0]);
  const highResolution = [...new Set(values
    .map((value) => absolute(value, detailUrl))
    .filter((url) => url
      && !BAD_IMAGE.test(url)
      && /\/images\/[a-f0-9]{6}\/w_1300x760\/approved-automotive\/[a-f0-9-]+\.(?:jpe?g|webp)(?:[?#]|$)/i.test(url)))];
  return highResolution.slice(0, 30);
}

function parseExactDetail(markup: string, meta: ListingMeta): Row | null {
  const plain = clean(markup);
  const h1 = clean(markup.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  if (!h1 || !new RegExp(`\\b${meta.make.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(h1)) return null;
  if (!new RegExp(`\\b${meta.model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(h1)) return null;

  const exactYear = Number(plain.match(/Model year\s*((?:19|20)\d{2})/i)?.[1] || 0);
  const exactMileage = int(plain.match(/Kilometers\s*([0-9][0-9, ]+)\s*Km\b/i)?.[1]);
  if (exactYear && exactYear !== meta.year) return null;
  if (exactMileage && meta.mileageKm && Math.abs(exactMileage - meta.mileageKm) > 5) return null;

  const liters = decimal(plain.match(/Engine capacity\s*([0-9]+(?:\.[0-9]+)?)\s*L\b/i)?.[1]);
  const engineCc = liters ? Math.round(liters * 1000) : int(plain.match(/Engine capacity\s*([0-9][0-9, ]+)\s*cc\b/i)?.[1]);
  const powerHp = int(plain.match(/Horsepower\s*([0-9]{2,4})\s*HP\b/i)?.[1]);
  const transmission = normalizeTransmission(clean(plain.match(/Transmission\s*(Automatic|Manual|CVT|DCT|DSG|Dual Clutch)/i)?.[1]));
  const drive = normalizeDrive(clean(plain.match(/Drive type\s*(All Wheel Drive|Four Wheel Drive|Front Wheel Drive|Rear Wheel Drive|AWD|4WD|FWD|RWD)/i)?.[1]));
  const bodyType = normalizeBody(clean(plain.match(/Vehicle type\s*([A-Za-z /-]{3,40}?)(?=\s+(?:Number of doors|Seating capacity|Wheel size|Fuel Type))/i)?.[1]));
  const fuel = normalizeFuel(clean(plain.match(/Fuel Type\s*(Petrol|Gasoline|Diesel|Electric|Hybrid|Plug-in Hybrid|PHEV|HEV)/i)?.[1]));
  const images = exactGallery(markup, meta.url);
  if (!engineCc || !powerHp || !fuel || !transmission || !drive || !bodyType || images.length < 5) return null;

  return { ...meta, title: h1, engineCc, powerHp, fuel, transmission, drive, bodyType, images };
}

function image(url: string): CatalogImage {
  return { id: "", url, objectKey: "", checksum: "", size: 0, mimeType: /\.webp(?:[?#]|$)/i.test(url) ? "image/webp" : "image/jpeg" };
}

export class DubicarsStrictAdapter implements CatalogSourceAdapter {
  sourceId = "dubicars_uae_exact";
  market = "uae" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const listUrl = `https://www.dubicars.com/uae/used?page=${page}`;
    const listing = await request(listUrl);
    if (!listing.response.ok) throw new Error(`dubicars_strict_list_http_${listing.response.status}`);
    const metas = listingMeta(listing.markup, listUrl).slice(0, 50);
    const rows: Row[] = [];
    for (let index = 0; index < metas.length; index += 5) {
      const batch = await Promise.all(metas.slice(index, index + 5).map(async (meta) => {
        const detail = await request(meta.url, listUrl).catch(() => null);
        return detail?.response.ok ? parseExactDetail(detail.markup, meta) : null;
      }));
      rows.push(...batch.filter(Boolean) as Row[]);
    }
    return {
      items: rows,
      nextCursor: String(page + 1),
      finished: false,
      count: rows.length,
      health: {
        ok: rows.length > 0,
        message: `DubiCars strict page ${page}: ${rows.length}/${metas.length}`,
        checkedAt: new Date().toISOString(),
        httpStatus: listing.response.status,
        contentType: listing.response.headers.get("content-type") || "",
      },
    };
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as Row;
    if (!row?.id || !row.make || !row.model || !row.year || !row.sourcePrice || !row.sourceCurrency || row.images.length < 5) return null;
    const now = new Date().toISOString();
    const fields = ["make", "model", "year", "sourcePrice", "sourceCurrency", ...(row.mileageKm != null ? ["mileageKm"] : []), "engineCc", "powerHp", "fuel", "transmission", "drive", "bodyType"];
    return {
      id: stableOfferId(this.sourceId, row.id), sourceId: this.sourceId, sourceOfferId: row.id, market: "uae", offerType: "fixed", status: "active",
      sourceTitle: row.title, make: row.make, model: row.model, trim: row.title, year: row.year, mileageKm: row.mileageKm,
      engineCc: row.engineCc, powerHp: row.powerHp, powerDataConfidence: "source_exact", powerDataSource: "dubicars_exact_detail",
      fuel: row.fuel, transmission: row.transmission, drive: row.drive, bodyType: row.bodyType,
      sourcePrice: row.sourcePrice, sourceCurrency: row.sourceCurrency, priceMode: "fixed", images: [], totalRub: null, calculationStatus: "needs_data",
      firstSeenAt: now, updatedAt: now,
      operational: {
        sourceUrl: row.url, sourceTitle: row.title, sourceVenueName: "DubiCars UAE",
        detailIdentityVerified: true, fieldIdentityVerified: true, sourceExactFields: fields,
        raw: { exactRow: row, detailIdentityVerified: true, fieldIdentityVerified: true, sourceExactFields: fields },
      },
    } as VehicleOffer;
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const row = (offer.operational.raw as any)?.exactRow as Row;
    const urls = [...new Set(row?.images || [])].slice(0, 30);
    const verified = urls.length >= 5;
    offer.operational = {
      ...(offer.operational || {}), galleryVerified: verified, photoIdentityVerified: verified, vehiclePhotoVerified: verified,
      detailIdentityVerified: true, fieldIdentityVerified: true, galleryImageCount: urls.length, galleryStoredAs: "json_urls",
      gallerySafetyMode: "dubicars_highres_exact_detail_only_v3",
      raw: { ...((offer.operational as any)?.raw || {}), photoIdentityVerified: verified, vehiclePhotoVerified: verified },
    } as any;
    return verified ? urls.map(image) : [];
  }

  mapStatus(): OfferStatus { return "active"; }
  async healthCheck() { return { ok: true, message: "DubiCars strict exact listing identity + exact detail specs + high-res detail photos", checkedAt: new Date().toISOString() }; }
}

export const dubicarsUaeStrictSource = new DubicarsStrictAdapter();

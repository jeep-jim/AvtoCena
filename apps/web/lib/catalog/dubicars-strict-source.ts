import { stableOfferId } from "./storage";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

type Row = {
  id: string;
  url: string;
  title: string;
  make: string;
  model: string;
  year: number;
  sourcePrice: number;
  sourceCurrency: string;
  mileageKm?: number;
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
const MAKES = [
  "Mercedes-Benz", "Land Rover", "Rolls-Royce", "Toyota", "Lexus", "Nissan", "Infiniti", "Honda", "Mazda", "Mitsubishi",
  "Subaru", "Suzuki", "Hyundai", "Genesis", "Kia", "BMW", "Audi", "Volkswagen", "Volvo", "Porsche", "Ford", "Chevrolet",
  "Cadillac", "Jeep", "Dodge", "Renault", "Peugeot", "Citroen", "Skoda", "MINI", "BYD", "Geely", "Changan", "Chery",
  "GAC", "Haval", "Tesla", "Jetour", "RAM", "GMC", "Bentley", "Lamborghini", "Ferrari", "Maserati", "McLaren",
].sort((a, b) => b.length - a.length);
const BAD_IMAGE = /logo|icon|avatar|qrcode|qr-code|placeholder|banner|related|similar|people-also-viewed|dealer|tracking|pixel|calendar|share|email|heart|settings|feature_groups|social|homepage|mobile-mockup|inspection|diagram|sheet/i;

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/\\u002f/gi, "/").replace(/\\u003a/gi, ":").replace(/\\u0026/gi, "&").replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim();
}
function absolute(value: string, base: string) { try { return new URL(value.replace(/&amp;/gi, "&").replace(/\\\//g, "/"), base).toString(); } catch { return ""; } }
function number(value: unknown) { const n = Number(String(value ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) && n > 0 ? n : undefined; }
function int(value: unknown) { const n = Number(String(value ?? "").replace(/[^0-9]/g, "")); return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined; }
function escapeRe(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

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
  const lower = title.toLowerCase();
  const make = MAKES.find((item) => lower === item.toLowerCase() || lower.startsWith(`${item.toLowerCase()} `)) || "";
  const model = make ? title.slice(make.length).replace(/^\s*[-–—|]\s*/, "").split(/\s+/).slice(0, 8).join(" ").trim() : "";
  return { make, model };
}
function labelValue(plain: string, labels: string[], stops: string[]) {
  const l = labels.map(escapeRe).join("|"); const s = stops.map(escapeRe).join("|");
  return clean(plain.match(new RegExp(`(?:${l})\\s*[:：]?\\s*(.{1,80}?)(?=\\s+(?:${s})\\s*[:：]?|$)`, "i"))?.[1]);
}
function normalizeFuel(v: string) { if (/electric|bev|ev\b/i.test(v)) return "electric"; if (/plug.?in|phev/i.test(v)) return "phev"; if (/hybrid|hev/i.test(v)) return "hybrid"; if (/diesel/i.test(v)) return "diesel"; if (/petrol|gasoline|gas\b/i.test(v)) return "petrol"; return clean(v); }
function normalizeTransmission(v: string) { if (/automatic|\bat\b/i.test(v)) return "automatic"; if (/cvt/i.test(v)) return "cvt"; if (/dct|dsg|dual clutch/i.test(v)) return "dct"; if (/manual|\bmt\b/i.test(v)) return "manual"; return clean(v); }
function normalizeDrive(v: string) { if (/all wheel|four wheel|4wd|awd|4x4/i.test(v)) return "awd"; if (/rear wheel|rwd/i.test(v)) return "rwd"; if (/front wheel|fwd/i.test(v)) return "fwd"; return clean(v); }
function normalizeBody(v: string) { if (/suv|crossover/i.test(v)) return "suv"; if (/sedan|saloon/i.test(v)) return "sedan"; if (/hatch/i.test(v)) return "hatchback"; if (/coupe/i.test(v)) return "coupe"; if (/convertible|cabrio/i.test(v)) return "convertible"; if (/pickup/i.test(v)) return "pickup"; if (/van|mpv|minivan/i.test(v)) return "minivan"; if (/wagon|estate/i.test(v)) return "wagon"; return clean(v); }

function parsePrice(plain: string) {
  const token = "([0-9]{1,3}(?:[, ]\\d{3})+|[0-9]{4,7})(?![0-9])";
  for (const [re, currency, max] of [
    [new RegExp(`(?:AED|د\\.?إ\\.?)\\s*${token}`, "i"), "AED", 10_000_000],
    [new RegExp(`${token}\\s*(?:AED|د\\.?إ\\.?)`, "i"), "AED", 10_000_000],
    [new RegExp(`(?:USD|US\\$|\\$)\\s*${token}`, "i"), "USD", 2_000_000],
    [new RegExp(`${token}\\s*(?:USD|US\\$)`, "i"), "USD", 2_000_000],
  ] as Array<[RegExp, string, number]>) {
    const n = int(plain.match(re)?.[1]); if (n && n >= 1_000 && n <= max) return { price: n, currency };
  }
  return null;
}

function exactGallery(markup: string, detailUrl: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/(?:data-src|data-original|data-lazy-src|src|content|poster)\s*=\s*["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']/gi)) for (const p of match[1].split(",")) values.push(p.trim().split(/\s+/)[0]);
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'<>\s\\]+\.(?:jpe?g|webp)(?:\?[^"'<>\s\\]*)?/gi)) values.push(match[0]);
  const candidates = [...new Set(values.map((v) => absolute(v, detailUrl)).filter((v) => v && !BAD_IMAGE.test(v) && /\.(?:jpe?g|webp)(?:[?#]|$)/i.test(v)))];
  const groups = new Map<string, string[]>();
  for (const url of candidates) {
    try {
      const u = new URL(url); const parts = u.pathname.split("/").filter(Boolean);
      const fileIndex = parts.length - 1;
      // DubiCars keeps all sizes of one vehicle under a stable vehicle UUID directory.
      const vehicleUuidIndex = parts.findIndex((p) => /^[a-f0-9-]{24,}$/i.test(p));
      const keyParts = vehicleUuidIndex >= 0 ? parts.slice(0, vehicleUuidIndex + 1) : parts.slice(0, Math.max(1, fileIndex));
      const key = `${u.hostname}/${keyParts.join("/")}`;
      groups.set(key, [...(groups.get(key) || []), url]);
    } catch {}
  }
  const ranked = [...groups.entries()].map(([key, urls]) => ({ key, urls: [...new Set(urls)] })).filter((g) => g.urls.length >= 5).sort((a, b) => b.urls.length - a.urls.length);
  if (!ranked.length) return [];
  const best = ranked[0].urls.filter((u) => !/\/(?:130x76|f_500x282)\//i.test(u));
  return [...new Set(best)].slice(0, 30);
}

function parseDetail(markup: string, url: string): Row | null {
  const fullPlain = clean(markup);
  const plain = fullPlain.split(/\b(?:Similar cars|People also viewed|Related links|Recommended cars|You may also like)\b/i)[0];
  const rawTitle = clean(markup.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || markup.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]);
  const title = rawTitle.replace(/\s+(?:19|20)\d{2}\s+for sale.*$/i, "").trim();
  const mm = makeModel(title); const year = Number(`${title} ${plain}`.match(/\b(?:19|20)\d{2}\b/)?.[0]); const p = parsePrice(plain);
  if (!mm.make || !mm.model || !year || !p) return null;
  const mileageKm = int(plain.match(/(?:Kilometers?|Mileage)\s*[:：]?\s*([0-9][0-9, ]+)\s*Km\b/i)?.[1]);
  const liters = number(plain.match(/Engine capacity\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)\s*L\b/i)?.[1] || plain.match(/\b([0-9]+(?:\.[0-9]+)?)L\b/i)?.[1]);
  const engineCc = liters ? Math.round(liters * 1000) : int(plain.match(/([0-9][0-9, ]+)\s*cc\b/i)?.[1]);
  const powerHp = int(plain.match(/Horsepower\s*[:：]?\s*([0-9]{2,4})\s*(?:HP|PS|BHP)?\b/i)?.[1] || plain.match(/\b([0-9]{2,4})\s*(?:HP|PS|BHP)\b/i)?.[1]);
  const stops = ["Transmission", "Export status", "Interior color", "Steering side", "Updated on", "Make", "Model", "Trim", "Color", "Cylinders", "Drive type", "Vehicle type", "Number of doors", "Seating capacity", "Wheel size", "Fuel Type", "Service history", "Location", "Specs"];
  const fuel = normalizeFuel(labelValue(plain, ["Fuel Type", "Fuel"], stops));
  const transmission = normalizeTransmission(labelValue(plain, ["Transmission"], stops));
  const drive = normalizeDrive(labelValue(plain, ["Drive type", "Drive Train"], stops));
  const bodyType = normalizeBody(labelValue(plain, ["Vehicle type", "Body Style"], stops));
  const images = exactGallery(markup, url);
  if (images.length < 5) return null;
  return { id: url.match(/-(\d{5,})\.html/i)?.[1] || url, url, title, make: mm.make, model: mm.model, year, sourcePrice: p.price, sourceCurrency: p.currency, mileageKm, engineCc, powerHp, fuel: fuel || undefined, transmission: transmission || undefined, drive: drive || undefined, bodyType: bodyType || undefined, images };
}
function image(url: string): CatalogImage { return { id: "", url, objectKey: "", checksum: "", size: 0, mimeType: /\.webp(?:[?#]|$)/i.test(url) ? "image/webp" : "image/jpeg" }; }

export class DubicarsStrictAdapter implements CatalogSourceAdapter {
  sourceId = "dubicars_uae_exact";
  market = "uae" as const;
  accessMode = "public_html" as const;
  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1)); const listUrl = `https://www.dubicars.com/uae/used?page=${page}`;
    const listing = await request(listUrl); if (!listing.response.ok) throw new Error(`dubicars_strict_list_http_${listing.response.status}`);
    const links = [...new Set([...listing.markup.matchAll(/href=["']([^"']+-\d{5,}\.html)["']/gi)].map((m) => absolute(m[1], listUrl)).filter(Boolean))].slice(0, 40);
    const rows: Row[] = [];
    for (let i = 0; i < links.length; i += 5) {
      const batch = await Promise.all(links.slice(i, i + 5).map(async (url) => { const r = await request(url, listUrl).catch(() => null); return r?.response.ok ? parseDetail(r.markup, url) : null; }));
      rows.push(...batch.filter(Boolean) as Row[]);
    }
    return { items: rows, nextCursor: String(page + 1), finished: false, count: rows.length, health: { ok: rows.length > 0, message: `DubiCars strict page ${page}: ${rows.length}`, checkedAt: new Date().toISOString(), httpStatus: listing.response.status, contentType: listing.response.headers.get("content-type") || "" } };
  }
  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as Row; if (!row?.id || !row.make || !row.model || !row.year || !row.sourcePrice || !row.sourceCurrency || row.images.length < 5) return null;
    const now = new Date().toISOString();
    const fields = ["make", "model", "year", "sourcePrice", "sourceCurrency", ...(row.mileageKm != null ? ["mileageKm"] : []), ...(row.engineCc ? ["engineCc"] : []), ...(row.powerHp ? ["powerHp"] : []), ...(row.fuel ? ["fuel"] : []), ...(row.transmission ? ["transmission"] : []), ...(row.drive ? ["drive"] : []), ...(row.bodyType ? ["bodyType"] : [])];
    return { id: stableOfferId(this.sourceId, row.id), sourceId: this.sourceId, sourceOfferId: row.id, market: "uae", offerType: "fixed", status: "active", sourceTitle: row.title, make: row.make, model: row.model, trim: row.title, year: row.year, mileageKm: row.mileageKm, engineCc: row.engineCc, powerHp: row.powerHp, powerDataConfidence: row.powerHp ? "source_exact" : undefined, powerDataSource: row.powerHp ? "dubicars_exact_detail" : undefined, fuel: row.fuel, transmission: row.transmission, drive: row.drive, bodyType: row.bodyType, sourcePrice: row.sourcePrice, sourceCurrency: row.sourceCurrency, priceMode: "fixed", images: [], totalRub: null, calculationStatus: "needs_data", firstSeenAt: now, updatedAt: now, operational: { sourceUrl: row.url, sourceTitle: row.title, sourceVenueName: "DubiCars UAE", detailIdentityVerified: true, fieldIdentityVerified: true, sourceExactFields: fields, raw: { exactRow: row, detailIdentityVerified: true, fieldIdentityVerified: true, sourceExactFields: fields } } } as VehicleOffer;
  }
  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const row = (offer.operational.raw as any)?.exactRow as Row; const urls = [...new Set(row?.images || [])].slice(0, 30); const verified = urls.length >= 5;
    offer.operational = { ...(offer.operational || {}), galleryVerified: verified, photoIdentityVerified: verified, vehiclePhotoVerified: verified, detailIdentityVerified: true, fieldIdentityVerified: true, galleryImageCount: urls.length, galleryStoredAs: "json_urls", gallerySafetyMode: "dubicars_strict_single_gallery_group", raw: { ...((offer.operational as any)?.raw || {}), photoIdentityVerified: verified, vehiclePhotoVerified: verified } } as any;
    return verified ? urls.map(image) : [];
  }
  mapStatus(): OfferStatus { return "active"; }
  async healthCheck() { return { ok: true, message: "DubiCars strict exact detail adapter", checkedAt: new Date().toISOString() }; }
}

export const dubicarsUaeStrictSource = new DubicarsStrictAdapter();

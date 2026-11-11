import { stableOfferId } from "./storage";
import { canonicalSourceModelIdentity } from "./open-source-normalizer";
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
  mileageKm?: number;
  engineCc?: number;
  powerHp?: number;
  fuel?: string;
  transmission?: string;
  drive?: string;
  bodyType?: string;
  color?: string;
  images: string[];
  detailIdentityVerified?: boolean;
  galleryIdentityVerified?: boolean;
};

const H = {
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "accept-language": "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};
const MAKES = ["Mercedes-Benz", "Land Rover", "Rolls-Royce", "Alfa Romeo", "Aston Martin", "Toyota", "Lexus", "Nissan", "Infiniti", "Honda", "Mazda", "Mitsubishi", "Subaru", "Suzuki", "Hyundai", "Genesis", "Kia", "BMW", "Audi", "Volkswagen", "Volvo", "Porsche", "Ford", "Chevrolet", "Cadillac", "Jeep", "Dodge", "Renault", "Peugeot", "Citroen", "Skoda", "SEAT", "MINI", "Opel", "Fiat", "Tesla", "Cupra", "BYD", "MG", "Omoda"].sort((a, b) => b.length - a.length);
const BAD = /(?:logo|icon|avatar|qrcode|qr-code|placeholder|banner|seller|dealer|tracking|pixel|last-slide|cta)/i;

function clean(v: unknown) {
  return String(v || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function abs(v: string, b: string) { try { return new URL(v.replace(/\\\//g, "/"), b).toString(); } catch { return ""; } }
function num(v: unknown) { const n = Number(String(v || "").replace(/[^0-9]/g, "")); return Number.isFinite(n) && n > 0 ? n : undefined; }
async function html(url: string, referer = "https://www.otomoto.pl/osobowe") {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 35000));
  try {
    const r = await fetch(url, { headers: { ...H, referer }, redirect: "follow", signal: c.signal });
    return { r, s: await r.text() };
  } finally { clearTimeout(t); }
}
function makeModel(title: string) {
  const normalized = clean(title).replace(/^Używany\s+/i, "");
  const lower = normalized.toLowerCase();
  const make = MAKES.find((x) => lower === x.toLowerCase() || lower.startsWith(`${x.toLowerCase()} `)) || "";
  const fallback = make ? normalized.slice(make.length).trim().split(/\s+/).slice(0, 8).join(" ") : "";
  return { make, model: canonicalSourceModelIdentity(normalized, make, fallback) };
}
function imageUrls(markup: string, url: string) {
  const values: string[] = [];
  for (const m of markup.matchAll(/(?:data-src|data-original|data-lazy-src|src)=["']([^"']+)["']/gi)) values.push(m[1]);
  for (const m of markup.matchAll(/(?:srcset|data-srcset)=["']([^"']+)["']/gi)) for (const part of m[1].split(",")) values.push(part.trim().split(/\s+/)[0]);
  for (const m of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp)(?:\?[^"'\\\s<>]*)?/gi)) values.push(m[0].replace(/\\\//g, "/"));
  return [...new Set(values.map((v) => abs(v, url)).filter((v) => v && /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(v) && !BAD.test(v)))].slice(0, 20);
}
function fuel(text: string) { return /Hybryda Plug-in|PHEV/i.test(text) ? "phev" : /Hybryda|hybrid/i.test(text) ? "hybrid" : /Diesel|Olej napędowy/i.test(text) ? "diesel" : /Elektrycz/i.test(text) ? "electric" : /Benzyna/i.test(text) ? "petrol" : ""; }
function transmission(text: string) { return /Automatyczna/i.test(text) ? "automatic" : /Manualna/i.test(text) ? "manual" : ""; }
function body(text: string) { return /SUV|Crossover/i.test(text) ? "suv" : /Kombi/i.test(text) ? "wagon" : /Hatchback|Auta miejskie/i.test(text) ? "hatchback" : /Coupe/i.test(text) ? "coupe" : /Kabriolet/i.test(text) ? "convertible" : /Sedan|Limuzyna/i.test(text) ? "sedan" : ""; }

function listingId(url: string) { return url.match(/-ID([A-Za-z0-9]+)\.html(?:[?#]|$)/i)?.[1] || ""; }
function typeText(value: any) { return (Array.isArray(value?.["@type"]) ? value["@type"] : [value?.["@type"]]).map(clean).join(" "); }
function isVehicleNode(value: any) { return /(?:^|\s)(?:Vehicle|Car)(?:\s|$)/i.test(typeText(value)); }
function isProductOrVehicleNode(value: any) { return /(?:^|\s)(?:Product|Vehicle|Car)(?:\s|$)/i.test(typeText(value)); }
function identityScalars(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string" || typeof value === "number") return [clean(value)];
  if (Array.isArray(value)) return value.flatMap(identityScalars);
  if (typeof value === "object") {
    const x = value as Record<string, unknown>;
    return [x.url, x["@id"], x.value, x.name, x.identifier].flatMap(identityScalars);
  }
  return [];
}
function identityMatches(value: unknown, expectedId: string, expectedUrl: string) {
  const id = expectedId.toLowerCase();
  let expectedPath = "";
  try { expectedPath = new URL(expectedUrl).pathname.toLowerCase(); } catch { /* ignore */ }
  return identityScalars(value).some((raw) => {
    const text = raw.toLowerCase();
    if (!text) return false;
    if (text === id || text === `id${id}` || text.includes(`-id${id}.html`)) return true;
    try {
      const parsed = new URL(raw, expectedUrl);
      return listingId(parsed.toString()).toLowerCase() === id || (expectedPath && parsed.pathname.toLowerCase() === expectedPath);
    } catch { return false; }
  });
}
function nodeBoundToListing(node: any, expectedId: string, expectedUrl: string) {
  if (!node || typeof node !== "object") return false;
  return [node.url, node["@id"], node.sku, node.productID, node.identifier, node.mainEntityOfPage].some((value) => identityMatches(value, expectedId, expectedUrl));
}
function jsonLdNodes(markup: string) {
  const nodes: any[] = [];
  const add = (parsed: any) => {
    if (Array.isArray(parsed)) { parsed.forEach(add); return; }
    if (!parsed || typeof parsed !== "object") return;
    nodes.push(parsed);
    if (Array.isArray(parsed["@graph"])) parsed["@graph"].forEach((entry: any) => { if (entry && typeof entry === "object") nodes.push(entry); });
  };
  for (const m of markup.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { add(JSON.parse(m[1])); } catch { /* ignore malformed unrelated JSON-LD */ }
  }
  return nodes;
}
function directImageUrls(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(directImageUrls);
  if (typeof value === "object") {
    const x = value as Record<string, unknown>;
    return directImageUrls(x.contentUrl || x.url || x["@id"]);
  }
  return [];
}
function boundPayload(markup: string, url: string) {
  const expectedId = listingId(url);
  if (!expectedId) return null;
  for (const root of jsonLdNodes(markup)) {
    if (!isProductOrVehicleNode(root)) continue;
    const children = [root.itemOffered, root.mainEntity, root.vehicle].flatMap((value) => Array.isArray(value) ? value : value ? [value] : []).filter((value) => value && typeof value === "object");
    const directlyBoundChild = children.find((child) => isProductOrVehicleNode(child) && nodeBoundToListing(child, expectedId, url));
    const rootBound = nodeBoundToListing(root, expectedId, url);
    if (!rootBound && !directlyBoundChild) continue;
    const vehicle = directlyBoundChild || children.find(isVehicleNode) || (isVehicleNode(root) ? root : null) || root;
    return { root, vehicle, expectedId };
  }
  return null;
}

export function parseOtomotoBoundDetail(markup: string, url: string, fallback?: Row): Row | null {
  const payload = boundPayload(markup, url);
  if (!payload) return fallback ? { ...fallback, images: [], detailIdentityVerified: false, galleryIdentityVerified: false } : null;
  const { root, vehicle, expectedId } = payload;
  const title = clean(vehicle.name || root.name || fallback?.title);
  const brand = clean(vehicle.brand?.name || vehicle.brand || root.brand?.name || root.brand);
  const mm = makeModel(title);
  const make = brand || mm.make || fallback?.make || "";
  const model = canonicalSourceModelIdentity(title, make, clean(vehicle.model || root.model) || mm.model || fallback?.model || "");
  const year = Number(String(vehicle.vehicleModelDate || vehicle.modelDate || root.vehicleModelDate || root.modelDate || "").match(/(?:19|20)\d{2}/)?.[0] || fallback?.year);
  if (!make || !model || !year) return fallback ? { ...fallback, images: [], detailIdentityVerified: false, galleryIdentityVerified: false } : null;
  const offer = root.offers || vehicle.offers || {};
  const imageCandidates = [...directImageUrls(root.image), ...directImageUrls(root.images), ...directImageUrls(vehicle.image), ...directImageUrls(vehicle.images)];
  const images = [...new Set(imageCandidates.map((x) => abs(String(x), url)).filter((x) => x && /\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(x) && !BAD.test(x)))].slice(0, 30);
  return {
    id: expectedId,
    url,
    title,
    make,
    model,
    year,
    price: num(offer.price) || fallback?.price,
    mileageKm: num(String(vehicle.mileageFromOdometer?.value || vehicle.mileageFromOdometer || "")) || fallback?.mileageKm,
    engineCc: num(String(vehicle.vehicleEngine?.engineDisplacement || "")) || fallback?.engineCc,
    powerHp: num(String(vehicle.vehicleEngine?.enginePower || "")) || fallback?.powerHp,
    fuel: clean(vehicle.fuelType) || fallback?.fuel,
    transmission: clean(vehicle.vehicleTransmission) || fallback?.transmission,
    drive: clean(vehicle.driveWheelConfiguration) || fallback?.drive,
    bodyType: clean(vehicle.bodyType || vehicle.vehicleConfiguration) || fallback?.bodyType,
    color: clean(vehicle.color) || fallback?.color,
    images,
    detailIdentityVerified: true,
    galleryIdentityVerified: images.length > 0,
  };
}

export function materializeOtomotoSourceImage(url: string): CatalogImage {
  const normalized = clean(url);
  const digest = stableOfferId("otomoto-source-image", normalized);
  let mimeType = "image/jpeg";
  try {
    const pathname = new URL(normalized).pathname;
    if (/\.webp$/i.test(pathname)) mimeType = "image/webp";
    else if (/\.avif$/i.test(pathname)) mimeType = "image/avif";
    else if (/\.png$/i.test(pathname)) mimeType = "image/png";
  } catch { /* keep jpeg fallback */ }
  return { id: `src_${digest}`, url: normalized, objectKey: "", size: 0, checksum: digest, mimeType };
}

function listRows(markup: string, listUrl: string) {
  const anchors = [...markup.matchAll(/<a\b[^>]*href=["']([^"']*\/osobowe\/oferta\/[^"']+-ID[A-Za-z0-9]+\.html[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const a of anchors) {
    const url = abs(a[1], listUrl);
    if (!url || seen.has(url)) continue;
    const start = Math.max(0, (a.index || 0) - 4500);
    const end = Math.min(markup.length, (a.index || 0) + 10000);
    const card = markup.slice(start, end);
    const title = clean(a[2]) || clean(card.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1]) || clean(card.match(/<img[^>]+alt=["']([^"']+)/i)?.[1]);
    const mm = makeModel(title);
    const plain = clean(card);
    const year = Number(plain.match(/(?:year\s*)?\b((?:19|20)\d{2})\b/i)?.[1]);
    if (!mm.make || !mm.model || !year) continue;
    const id = listingId(url) || stableOfferId("otomoto", url);
    seen.add(url);
    rows.push({
      id, url, title, make: mm.make, model: mm.model, year,
      price: num(plain.match(/([0-9][0-9 .]{2,})\s*PLN/i)?.[1]),
      mileageKm: num(plain.match(/([0-9][0-9 .]{1,})\s*km/i)?.[1]),
      engineCc: num(plain.match(/([0-9][0-9 .]{2,})\s*cm3/i)?.[1]),
      powerHp: num(plain.match(/([0-9]{2,4})\s*KM\b/i)?.[1]),
      fuel: fuel(plain), transmission: transmission(plain),
      drive: /4x4|AWD|4-Matic|quattro|xDrive/i.test(plain) ? "awd" : "",
      bodyType: body(plain),
      images: imageUrls(card, listUrl),
      detailIdentityVerified: false,
      galleryIdentityVerified: false,
    });
  }
  return rows;
}

export class OtomotoExactAdapter implements CatalogSourceAdapter {
  sourceId = "otomoto_europe_exact";
  market = "europe" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const urls = [`https://www.otomoto.pl/osobowe?page=${page}`, `https://www.otomoto.pl/osobowe?search%5Border%5D=created_at_first%3Adesc&page=${page}`];
    for (const listUrl of urls) {
      const l = await html(listUrl).catch(() => null);
      if (!l?.r.ok) continue;
      const listed = listRows(l.s, listUrl).slice(0, 40);
      if (!listed.length) continue;
      const rows: Row[] = [];
      for (let i = 0; i < listed.length; i += 6) {
        const batch = await Promise.all(listed.slice(i, i + 6).map(async (row) => {
          const d = await html(row.url, listUrl).catch(() => null);
          return d?.r.ok ? parseOtomotoBoundDetail(d.s, row.url, row) : row;
        }));
        rows.push(...batch.filter(Boolean) as Row[]);
      }
      if (rows.length) return { items: rows, nextCursor: String(page + 1), finished: false, count: rows.length };
    }
    throw new Error("otomoto_exact_zero");
  }

  mapStatus(): OfferStatus { return "active"; }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const x = raw as Row;
    if (!x.id || !x.make || !x.model || !x.year) return null;
    const now = new Date().toISOString();
    return normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, x.id), sourceId: this.sourceId, sourceOfferId: x.id, market: "europe", offerType: "fixed", status: "active",
      sourceTitle: x.title, make: x.make, model: x.model, trim: x.title, year: x.year, mileageKm: x.mileageKm, engineCc: x.engineCc, powerHp: x.powerHp,
      fuel: x.fuel, transmission: x.transmission, drive: x.drive, bodyType: x.bodyType, color: x.color, sourcePrice: x.price || null,
      sourceCurrency: x.price ? "PLN" : null, priceMode: x.price ? "fixed" : "estimated", images: [], totalRub: null,
      calculationStatus: x.price ? "ready" : "needs_data", firstSeenAt: now, updatedAt: now,
      operational: {
        sourceUrl: x.url, sourceVenueName: "OTOMOTO", sourceTitle: x.title,
        exactDetail: Boolean(x.detailIdentityVerified), exactFields: Boolean(x.detailIdentityVerified), exactPhotos: Boolean(x.galleryIdentityVerified),
        galleryVerified: Boolean(x.galleryIdentityVerified), galleryImageCount: x.images.length,
        gallerySafetyMode: x.galleryIdentityVerified ? "otomoto_listing_bound_jsonld_v1" : "otomoto_exact_detail_pending_v1",
        galleryStoredAs: "source_urls_only", photoIdentityVerified: Boolean(x.galleryIdentityVerified),
        raw: x,
      },
    } as VehicleOffer);
  }

  async fetchImages(o: VehicleOffer): Promise<CatalogImage[]> {
    const x = o.operational.raw as Row;
    let exact = x.galleryIdentityVerified ? x : null;
    if (!exact) {
      const d = await html(x.url, x.url).catch(() => null);
      if (d?.r.ok) exact = parseOtomotoBoundDetail(d.s, x.url, x);
    }
    if (!exact?.galleryIdentityVerified || !exact.images.length) return [];
    o.operational.exactDetail = true;
    o.operational.exactPhotos = true;
    o.operational.galleryVerified = true;
    o.operational.galleryImageCount = exact.images.length;
    o.operational.gallerySafetyMode = "otomoto_listing_bound_jsonld_v1";
    o.operational.galleryStoredAs = "source_urls_only";
    o.operational.photoIdentityVerified = true;
    o.operational.raw = exact;
    return [...new Set(exact.images)]
      .slice(0, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 10))
      .map(materializeOtomotoSourceImage);
  }

  async healthCheck() { return { ok: true, message: "OTOMOTO listing plus identity-bound exact detail", checkedAt: new Date().toISOString() }; }
}

export const otomotoEuropeExactSource = new OtomotoExactAdapter();

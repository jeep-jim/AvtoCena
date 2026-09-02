import { stableOfferId } from "./storage";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

const BASE_URL = "https://uae.dubizzle.com";
const ALGOLIA_APP_ID = "WD0PTZ13ZS";
// Public search-only key shipped by Dubizzle's own listings client. It cannot
// mutate records and is overrideable so a normal key rotation needs no parser change.
const ALGOLIA_SEARCH_KEY = String(process.env.CATALOG_DUBIZZLE_ALGOLIA_SEARCH_KEY || "cdd839b4fdac840289e88633779e8634");
const ALGOLIA_INDEX = "motors.com";
const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "upgrade-insecure-requests": "1",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
const BLOCK_RE = /captcha|access denied|request blocked|verify you are human|forbidden|cloudflare|pardon our interruption|incapsula|imperva|request unsuccessful|reese/i;
const BAD_IMAGE_RE = /logo|favicon|icon|sprite|banner|placeholder|avatar|tracking|pixel|cookie|qrcode|qr-code|appstore|googleplay/i;
const DETAIL_RE = /\/motors\/used-cars\/[a-z0-9-]+\/[a-z0-9-]+\/(?:19|20)\d{2}\/\d{1,2}\/\d{1,2}\/[a-z0-9-]+---[a-f0-9]{32}\/?$/i;
const KNOWN_MAKES = [
  "Mercedes-Benz", "Mercedes-Maybach", "Land Rover", "Range Rover", "Rolls-Royce", "Alfa Romeo", "Aston Martin", "Great Wall", "Li Auto",
  "Toyota", "Lexus", "Nissan", "Infiniti", "Honda", "Acura", "Mazda", "Mitsubishi", "Subaru", "Suzuki", "Daihatsu", "Isuzu",
  "Hyundai", "Genesis", "Kia", "KGM", "SsangYong", "BMW", "Audi", "Volkswagen", "Volvo", "Porsche", "Ford", "Chevrolet", "Cadillac",
  "Jeep", "Dodge", "Renault", "Peugeot", "Citroen", "Skoda", "SEAT", "MINI", "Fiat", "Opel", "Tesla", "BYD", "Geely", "Changan",
  "Chery", "GAC", "Haval", "Zeekr", "Nio", "XPeng", "Jetour", "Denza", "Hongqi", "Tank", "Voyah", "Aito", "Leapmotor", "Arcfox", "Neta",
].sort((a, b) => b.length - a.length);

export type DubizzleExactRow = {
  id: string;
  sourceUrl: string;
  title: string;
  make: string;
  model: string;
  trim?: string;
  year: number;
  mileageKm?: number;
  engineCc?: number;
  powerHp?: number;
  fuel?: string;
  transmission?: string;
  drive?: string;
  bodyType?: string;
  price: number;
  currency: string;
  location?: string;
  images: string[];
  rawText: string;
  exactStructured?: boolean;
};

type DubizzleAlgoliaHit = {
  uuid?: unknown;
  id?: unknown;
  price?: unknown;
  name?: { en?: unknown };
  absolute_url?: { en?: unknown };
  photo_thumbnails?: unknown[];
  category?: { en?: unknown[] };
  location_list?: { en?: unknown[] };
  details?: Record<string, { en?: { value?: unknown } }>;
};

function decode(value: string) {
  return String(value || "")
    .replace(/&nbsp;|&#160;|\u00a0/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
function plain(markup: string) {
  return decode(markup).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
}
function absolute(value: string, base = BASE_URL) {
  if (!value || /^(?:data:|javascript:|mailto:|tel:)/i.test(value)) return "";
  try { return new URL(decode(value).replace(/\\\//g, "/"), base).toString(); } catch { return ""; }
}
function integer(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
function makeModel(title: string) {
  const normalized = plain(title).replace(/^(?:premium|featured|verified user|inspected by)\s+/i, "").trim();
  const lower = normalized.toLocaleLowerCase("en-US");
  const make = KNOWN_MAKES.find((candidate) => lower === candidate.toLocaleLowerCase("en-US") || lower.startsWith(`${candidate.toLocaleLowerCase("en-US")} `));
  if (!make) return { make: "", model: "", trim: "" };
  const rest = normalized.slice(make.length).replace(/^[\s|–—-]+/, "").trim();
  const tokens = rest.split(/\s+/).filter(Boolean);
  return { make, model: tokens.slice(0, Math.min(3, tokens.length)).join(" "), trim: rest };
}
function imageMime(url: string) {
  if (/\.png(?:[?#]|$)/i.test(url)) return "image/png";
  if (/\.webp(?:[?#]|$)/i.test(url)) return "image/webp";
  if (/\.avif(?:[?#]|$)/i.test(url)) return "image/avif";
  return "image/jpeg";
}
function asImage(url: string): CatalogImage {
  return { id: "", url, objectKey: "", checksum: "", size: 0, mimeType: imageMime(url) };
}
function collectImages(markup: string, base: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/<(?:img|source|meta)[^>]+(?:data-original|data-lazy-src|data-src|src|content)\s*=\s*["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi)) match[1].split(",").forEach((item) => values.push(item.trim().split(/\s+/)[0]));
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) values.push(match[0].replace(/\\\//g, "/"));
  return [...new Set(values.map((item) => absolute(item, base)).filter((url) => /^https?:/i.test(url) && !BAD_IMAGE_RE.test(url) && /(?:dubizzle|cloudfront|amazonaws|static)/i.test(url)))];
}
function detailId(url: string) {
  return url.match(/---([a-f0-9]{32})(?:\/?(?:[?#].*)?)$/i)?.[1] || "";
}
function titleFromCard(inner: string, card: string) {
  const candidates = [plain(inner), decode(card.match(/<img[^>]+alt\s*=\s*["']([^"']+)["']/i)?.[1] || ""), plain(card.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1] || "")]
    .map((item) => item.replace(/\s+/g, " ").trim());
  return candidates.find((item) => item.length >= 5 && item.length <= 320 && /[A-Za-z]/.test(item)) || "";
}
function money(text: string) {
  const match = text.match(/(?:AED|د\.?إ\.?)\s*([0-9][0-9, ]{2,})/i) || text.match(/([0-9][0-9, ]{2,})\s*(?:AED|د\.?إ\.?)\b/i);
  return integer(match?.[1]);
}
function yearFrom(text: string) {
  return Number(text.match(/\b((?:19|20)\d{2})\b/)?.[1] || 0);
}

function algoliaDetail(hit: DubizzleAlgoliaHit, key: string) {
  return hit.details?.[key]?.en?.value;
}

function rangedMetric(value: unknown) {
  const text = String(value ?? "").trim();
  return /\d[\d, .]*\s*(?:-|–|—|to)\s*\d/i.test(text)
    || /(?:up\s+to|under|below|less\s+than|over|above|more\s+than|from)\s*\d/i.test(text)
    || /(?:^|\s)[<>≤≥]\s*\d/.test(text)
    || /\d\s*\+\s*(?:cc|cm3|cm³|hp|ps|bhp)?\s*$/i.test(text);
}

function exactMetric(value: unknown, unit: RegExp) {
  const text = String(value ?? "").trim();
  if (!text || /unknown|not specified/i.test(text) || rangedMetric(text)) return undefined;
  const match = text.match(new RegExp(`^\\s*([0-9][0-9, ]{0,7})\\s*(?:${unit.source})?\\s*$`, "i"));
  return integer(match?.[1]);
}

export function parseDubizzleAlgoliaHit(raw: unknown): DubizzleExactRow | null {
  const hit = raw as DubizzleAlgoliaHit;
  const id = String(hit?.uuid || "").trim();
  const sourceUrl = absolute(String(hit?.absolute_url?.en || ""));
  const category = Array.isArray(hit?.category?.en) ? hit.category!.en!.map((value) => String(value || "").trim()) : [];
  const make = String(algoliaDetail(hit, "Make") || category[1] || "").trim();
  const model = String(algoliaDetail(hit, "Model") || category[2] || "").trim();
  const title = String(hit?.name?.en || `${make} ${model}`).trim();
  const year = Number(algoliaDetail(hit, "Year") || 0);
  const price = Number(hit?.price || algoliaDetail(hit, "Price") || 0);
  const images = [...new Set((Array.isArray(hit?.photo_thumbnails) ? hit.photo_thumbnails : [])
    .map((value) => absolute(String(value || ""), sourceUrl || BASE_URL))
    .filter((url) => /^https:\/\/dbz-images\.dubizzle\.com\//i.test(url)))];
  if (!/^[a-f0-9]{32}$/i.test(id) || detailId(sourceUrl) !== id || !make || !model
    || !Number.isFinite(year) || year < 1900 || year > new Date().getUTCFullYear() + 1
    || !Number.isFinite(price) || price <= 0 || images.length < 5) return null;
  const locations = Array.isArray(hit?.location_list?.en) ? hit.location_list!.en!.map((value) => String(value || "").trim()).filter(Boolean) : [];
  return {
    id,
    sourceUrl,
    title,
    make,
    model,
    trim: String(algoliaDetail(hit, "Trim") || "").trim() || undefined,
    year,
    mileageKm: exactMetric(algoliaDetail(hit, "Kilometers"), /km|kilometers?/),
    engineCc: exactMetric(algoliaDetail(hit, "Engine Capacity (cc)"), /cc|cm3|cm³/),
    powerHp: exactMetric(algoliaDetail(hit, "Horsepower"), /hp|ps|bhp/),
    fuel: String(algoliaDetail(hit, "Fuel Type") || "").trim() || undefined,
    transmission: String(algoliaDetail(hit, "Transmission Type") || "").trim() || undefined,
    bodyType: String(algoliaDetail(hit, "Body Type") || "").trim() || undefined,
    price,
    currency: "AED",
    location: locations.slice(-3).join(", ") || undefined,
    images: images.slice(0, 30),
    rawText: JSON.stringify(hit).slice(0, 15_000),
    exactStructured: true,
  };
}
function parseList(markup: string, pageUrl: string): DubizzleExactRow[] {
  const anchors = [...markup.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: absolute(match[1], pageUrl), inner: match[2], index: match.index || 0 }))
    .filter((item) => { try { return DETAIL_RE.test(new URL(item.href).pathname); } catch { return false; } });
  const rows: DubizzleExactRow[] = [];
  const seen = new Set<string>();
  anchors.forEach((anchor, index) => {
    const id = detailId(anchor.href);
    if (!id || seen.has(id)) return;
    const previous = index > 0 ? anchors[index - 1].index : Math.max(0, anchor.index - 3_000);
    const next = index + 1 < anchors.length ? anchors[index + 1].index : markup.length;
    const card = markup.slice(Math.max(previous, anchor.index - 5_000), Math.min(next + 2_500, anchor.index + 18_000));
    const cardText = plain(card);
    const title = titleFromCard(anchor.inner, card);
    const identity = makeModel(title || cardText.slice(0, 250));
    const urlParts = new URL(anchor.href).pathname.split("/").filter(Boolean);
    const usedIndex = urlParts.indexOf("used-cars");
    const urlMake = usedIndex >= 0 ? urlParts[usedIndex + 1]?.replace(/-/g, " ") : "";
    const urlModel = usedIndex >= 0 ? urlParts[usedIndex + 2]?.replace(/-/g, " ") : "";
    const make = identity.make || (urlMake ? urlMake.split(" ").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ") : "");
    const model = identity.model || (urlModel ? urlModel.split(" ").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ") : "");
    const year = yearFrom(cardText);
    const price = money(cardText);
    if (!make || !model || !year || !price) return;
    seen.add(id);
    rows.push({
      id, sourceUrl: anchor.href, title: title || `${make} ${model}`, make, model, trim: identity.trim, year,
      mileageKm: integer(cardText.match(/([0-9][0-9, ]{1,8})\s*km\b/i)?.[1]),
      price, currency: "AED",
      location: cardText.match(/\b([A-Za-z][A-Za-z .'-]{2,45}),\s*(Dubai|Abu Dhabi|Sharjah|Ajman|Umm Al Quwain|Ras Al Khaimah|Fujairah)\b/i)?.[0],
      images: collectImages(card, anchor.href).slice(0, 30), rawText: cardText.slice(0, 15_000),
    });
  });
  return rows;
}

const DETAIL_LABELS = [
  "Body Type", "Fuel Type", "Transmission Type", "Drive Type", "Drive", "Engine Capacity", "Engine Size",
  "Horsepower", "Power", "Mileage", "Kilometers", "Colour", "Color", "Doors", "Seats",
];
function overviewText(markup: string) {
  const text = plain(markup);
  const start = text.search(/\bCar\s+Overview\b/i);
  if (start < 0) return "";
  const rest = text.slice(start + text.match(/\bCar\s+Overview\b/i)![0].length);
  const endMatch = rest.search(/\b(?:Description|Seller(?:'s)?\s+Description|Location|Similar\s+Cars|Recommended|Related\s+Ads|Safety\s+Tips)\b/i);
  return rest.slice(0, endMatch >= 0 ? endMatch : Math.min(rest.length, 6_000)).trim();
}
function escaped(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function labelValue(section: string, label: string) {
  const otherLabels = DETAIL_LABELS.filter((item) => item !== label).map(escaped).join("|");
  const pattern = new RegExp(`(?:^|\\s)${escaped(label)}\\s*[:：]?\\s*(.{1,100}?)(?=\\s+(?:${otherLabels})\\s*[:：]?|$)`, "i");
  return section.match(pattern)?.[1]?.trim() || "";
}
function firstLabelValue(section: string, labels: string[]) {
  for (const label of labels) {
    const value = labelValue(section, label);
    if (value) return value;
  }
  return "";
}
export function parseDubizzleLabelBoundDetailFields(markup: string) {
  const section = overviewText(markup);
  if (!section) return {};
  const engineText = firstLabelValue(section, ["Engine Capacity", "Engine Size"]);
  const powerText = firstLabelValue(section, ["Horsepower", "Power"]);
  const mileageText = firstLabelValue(section, ["Mileage", "Kilometers"]);
  const liters = !rangedMetric(engineText) ? engineText.match(/^\s*([0-9]+(?:[.,][0-9]+)?)\s*L\s*$/i) : null;
  return {
    engineCc: exactMetric(engineText, /cc|cm3|cm³/)
      || (liters ? Math.round(Number(liters[1].replace(",", ".")) * 1_000) : undefined),
    powerHp: exactMetric(powerText, /hp|ps|bhp/),
    mileageKm: integer(mileageText.match(/([0-9][0-9, ]{1,8})\s*km\b/i)?.[1]),
    fuel: firstLabelValue(section, ["Fuel Type"]) || undefined,
    transmission: firstLabelValue(section, ["Transmission Type"]) || undefined,
    drive: firstLabelValue(section, ["Drive Type", "Drive"]) || undefined,
    bodyType: firstLabelValue(section, ["Body Type"]) || undefined,
  };
}
async function request(url: string, referer = BASE_URL) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(5_000, Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 30_000)));
  try {
    const response = await fetch(url, { headers: { ...HEADERS, referer }, redirect: "follow", signal: controller.signal });
    const markup = await response.text();
    if ([401, 403, 429].includes(response.status) || BLOCK_RE.test(markup.slice(0, 8_000))) {
      throw new Error(`dubizzle_exact_blocked_${response.status}_imperva_or_challenge`);
    }
    if (!response.ok) throw new Error(`dubizzle_exact_http_${response.status}`);
    return { response, markup };
  } finally { clearTimeout(timer); }
}

async function requestAlgolia(page: number) {
  const hosts = [
    "https://algolia.dubizzle.com",
    `https://${ALGOLIA_APP_ID}-dsn.algolia.net`,
  ];
  let lastError = "";
  for (const host of hosts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(5_000, Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 30_000)));
    try {
      const response = await fetch(`${host}/1/indexes/${encodeURIComponent(ALGOLIA_INDEX)}/query`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-algolia-api-key": ALGOLIA_SEARCH_KEY,
          "x-algolia-application-id": ALGOLIA_APP_ID,
          "user-agent": HEADERS["user-agent"],
        },
        body: JSON.stringify({
          query: "",
          filters: '("category_v2.slug_paths":"motors/used-cars")',
          page: Math.max(0, page - 1),
          hitsPerPage: 25,
          ruleContexts: ["all_user"],
        }),
        redirect: "follow",
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`dubizzle_algolia_http_${response.status}`);
      const payload = JSON.parse(text) as { hits?: unknown[]; page?: number; nbPages?: number };
      const rows = (Array.isArray(payload.hits) ? payload.hits : [])
        .map(parseDubizzleAlgoliaHit)
        .filter((row): row is DubizzleExactRow => Boolean(row));
      if (!rows.length) throw new Error(`dubizzle_algolia_parsed_zero_page_${page}`);
      return {
        rows,
        finished: Number(payload.page || 0) + 1 >= Number(payload.nbPages || 0),
        host: new URL(host).hostname,
        status: response.status,
      };
    } catch (error) {
      lastError = String((error as Error)?.message || error);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(lastError || `dubizzle_algolia_failed_page_${page}`);
}

export function dubizzleListPageCandidates(page: number) {
  return [
    `https://uae.dubizzle.com/en/motors/used-cars/?page=${page}`,
    `https://uae.dubizzle.com/en/motors/used-cars/search/?page=${page}`,
    `https://uae.dubizzle.com/motors/used-cars/?page=${page}`,
    `https://dubai.dubizzle.com/motors/used-cars/?page=${page}`,
    `https://dubai.dubizzle.com/motors/used-cars/search/?page=${page}`,
    `https://abudhabi.dubizzle.com/motors/used-cars/?page=${page}`,
  ];
}

export class DubizzleUaeExactAdapter implements CatalogSourceAdapter {
  sourceId = "dubizzle_uae_open";
  market = "uae" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const candidates = dubizzleListPageCandidates(page);
    let lastStatus = 0; let lastBytes = 0; let lastError = "";
    for (const url of candidates) {
      try {
        const { response, markup } = await request(url, "https://uae.dubizzle.com/en/motors/used-cars/");
        lastStatus = response.status; lastBytes = markup.length;
        const items = parseList(markup, response.url || url);
        if (!items.length) continue;
        return { items, nextCursor: String(page + 1), finished: false, count: items.length, health: { ok: true, message: `Dubizzle exact parsed ${items.length} from ${new URL(response.url || url).hostname}`, checkedAt: new Date().toISOString(), httpStatus: response.status, contentType: response.headers.get("content-type") || "" } };
      } catch (error) {
        const message = String((error as Error)?.message || error);
        lastError = message;
        if (/blocked|http_/.test(message)) continue;
        throw error;
      }
    }
    try {
      const fallback = await requestAlgolia(page);
      return {
        items: fallback.rows,
        nextCursor: fallback.finished ? null : String(page + 1),
        finished: fallback.finished,
        count: fallback.rows.length,
        health: {
          ok: true,
          message: `Dubizzle official Algolia parsed ${fallback.rows.length} from ${fallback.host}`,
          checkedAt: new Date().toISOString(),
          httpStatus: fallback.status,
          contentType: "application/json",
        },
      };
    } catch (algoliaError) {
      const fallbackError = String((algoliaError as Error)?.message || algoliaError);
      if (/blocked/.test(lastError)) throw new Error(`${lastError}:${fallbackError}`);
      throw new Error(`dubizzle_exact_parsed_zero_status_${lastStatus}_bytes_${lastBytes}:${fallbackError}`);
    }
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as DubizzleExactRow;
    if (!row?.id || !row.sourceUrl || !row.make || !row.model || !row.year || !row.price) return null;
    const now = new Date().toISOString();
    const listingGalleryVerified = row.images.length >= 5;
    const exactStructured = row.exactStructured === true;
    return {
      id: stableOfferId(this.sourceId, row.id), sourceId: this.sourceId, sourceOfferId: row.id, market: "uae", offerType: "fixed", status: "active",
      sourceTitle: row.title, make: row.make, model: row.model, trim: row.trim, year: row.year, mileageKm: row.mileageKm,
      engineCc: row.engineCc, powerHp: row.powerHp, fuel: row.fuel, transmission: row.transmission, drive: row.drive, bodyType: row.bodyType,
      sourcePrice: row.price, sourceCurrency: row.currency, priceMode: "fixed", images: [], totalRub: null, calculationStatus: "needs_data", firstSeenAt: now, updatedAt: now,
      operational: { sourceUrl: row.sourceUrl, sourceVenueName: row.location || "Dubizzle UAE", sourceTitle: row.title, exactDetail: exactStructured, exactFields: exactStructured, exactPhotos: listingGalleryVerified,
        galleryVerified: listingGalleryVerified, galleryImageCount: row.images.length, gallerySafetyMode: "dubizzle_listing_card_uuid_v2", galleryStoredAs: "json_urls", photoIdentityVerified: listingGalleryVerified,
        raw: { parsed: row, images: row.images, detailIdentityVerified: exactStructured, listingBoundImages: row.images.length > 0, photoIdentityVerified: listingGalleryVerified,
          semanticFieldPolicy: exactStructured ? "dubizzle_official_algolia_exact_fields_v1" : "dubizzle_listing_card_v2" } },
    };
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const raw = offer.operational?.raw as { parsed?: DubizzleExactRow; images?: string[] } | undefined;
    const row = raw?.parsed;
    if (!row?.sourceUrl || detailId(row.sourceUrl) !== String(offer.sourceOfferId || "")) return [];
    const urls = [...new Set(raw?.images || row.images || [])];
    try {
      const { response, markup } = await request(row.sourceUrl, "https://uae.dubizzle.com/motors/used-cars/");
      const responseUrl = response.url || row.sourceUrl;
      if (detailId(responseUrl) !== String(offer.sourceOfferId || "")) throw new Error(`dubizzle_exact_detail_identity_${offer.sourceOfferId}`);
      const fields = parseDubizzleLabelBoundDetailFields(markup);
      offer.engineCc = fields.engineCc || offer.engineCc;
      offer.powerHp = fields.powerHp || offer.powerHp;
      offer.mileageKm = fields.mileageKm || offer.mileageKm;
      offer.fuel = fields.fuel || offer.fuel;
      offer.transmission = fields.transmission || offer.transmission;
      offer.drive = fields.drive || offer.drive;
      offer.bodyType = fields.bodyType || offer.bodyType;
      if (fields.powerHp) { offer.powerDataConfidence = "source_exact"; offer.powerDataSource = `Dubizzle Car Overview:${offer.sourceOfferId}:Power`; }
      const op = offer.operational as any;
      op.exactDetail = true;
      op.exactFields = true;
      op.galleryVerified = urls.length >= 5;
      op.galleryImageCount = urls.length;
      op.photoIdentityVerified = urls.length >= 5;
      op.raw = { ...(op.raw || {}), images: urls, detailIdentityVerified: true, listingBoundImages: true, photoIdentityVerified: urls.length >= 5, semanticFieldPolicy: "car_overview_label_bound_v1" };
    } catch {
      // Keep only listing-card-bound source URLs and never infer semantics from page-wide text.
    }
    const limit = Math.min(30, Math.max(5, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
    return urls.slice(0, limit).map(asImage);
  }

  mapStatus(): OfferStatus { return "active"; }
  async healthCheck() { return { ok: true, message: "Dubizzle exact listing UUID + label-bound overview adapter", checkedAt: new Date().toISOString() }; }
}

export const dubizzleUaeExactSource = new DubizzleUaeExactAdapter();

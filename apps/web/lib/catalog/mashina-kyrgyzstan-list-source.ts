import { CATALOG_BRANDS, canonicalCatalogBrand } from "./brands";
import { isCatalogYearAllowed } from "./offer-quality";
import { stableOfferId } from "./storage";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ru;q=0.8,ky;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
const DETAIL_RE = /\/(?:en\/)?details\/[^"'?#\s<>]+/i;
const BAD_IMAGE_RE = /logo|icon|avatar|\/users\/|qrcode|qr-code|placeholder|banner|sprite|tracking|pixel|favicon|appstore|googleplay|no[-_ ]?(?:photo|image)/i;
const COMMERCIAL_RE = /\b(?:truck|bus|minibus|commercial|cargo|tractor|forklift|excavator|agricultural|scooter|motorcycle|quad\s*bike|sprinter|transit|crafter|ducato|boxer|jumper|canter|elf|dutro|fuso|hino)\b/i;
const BADGE_RE = /\b(?:Urgent|DIAMOND|Premium|TOP\s+VIP\s+BOOST|SUPER\s+VIP|VIP|BOOST)\b/gi;
const KNOWN_MAKES = [...new Set(CATALOG_BRANDS.flatMap((brand) => [
  brand.name,
  brand.name.replace(/-/g, " "),
  brand.name.replace(/\s*&\s*/g, " and "),
]).map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean))]
  .sort((left, right) => right.length - left.length);

export type MashinaListRow = {
  id: string;
  detailUrl: string;
  title: string;
  make: string;
  model: string;
  year: number;
  price: number;
  currency: "USD" | "KGS";
  mileageKm?: number;
  engineCc?: number;
  powerHp?: number;
  fuel?: string;
  transmission?: string;
  bodyType?: string;
  location?: string;
  images: string[];
};

function decodeHtml(value: string) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
function plainText(value: string) {
  return decodeHtml(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
}
function absoluteUrl(value: string, base: string) {
  if (!value || /^(?:data:|javascript:|mailto:|tel:)/i.test(value)) return "";
  try { return new URL(value.replace(/\\\//g, "/").replace(/&amp;/gi, "&"), base).toString(); } catch { return ""; }
}
function integer(value: unknown) {
  const parsed = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
export function parseMashinaExplicitEngineLiters(value: unknown) {
  const text = String(value || "").replace(/,/g, ".");
  const match = text.match(/(?:^|\s)([0-8](?:\.[0-9]))\s*(?=(?:A\/?T|M\/?T|AT|MT|CVT|DCT|DSG|hyb(?:rid)?|diesel|petrol|gasoline|turbo|T|d)\b)/i);
  const liters = Number(match?.[1] || 0);
  return Number.isFinite(liters) && liters >= 0.6 && liters <= 8 ? liters : 0;
}
function compact(value: unknown) {
  return String(value || "").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}
function mashinaImageIdentity(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    let pathname = decodeURIComponent(url.pathname).replace(/\/{2,}/g, "/");
    if (!/\.(?:jpe?g|png|webp|avif)$/i.test(pathname)) return "";
    if (host === "storage.mashina.kg" && pathname.startsWith("/catalog/images/")) {
      pathname = pathname.replace(/_(?:small|medium|large)(?=\.(?:jpe?g|png|webp|avif)$)/i, "");
      return `${host}${pathname}`;
    }
    if (host === "im.mashina.kg" && pathname.startsWith("/tachka/images/")) {
      pathname = pathname.replace(/_\d{2,5}x\d{2,5}(?=\.(?:jpe?g|png|webp|avif)$)/i, "");
      return `${host}${pathname}`;
    }
  } catch { /* invalid URL */ }
  return "";
}
function mashinaImageRank(value: string) {
  if (/_large\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(value)) return 3_000_000;
  if (/_medium\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(value)) return 2_000_000;
  if (/_small\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(value)) return 1_000_000;
  const dimensions = value.match(/_(\d{2,5})x(\d{2,5})\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i);
  return dimensions ? Number(dimensions[1]) * Number(dimensions[2]) : 1;
}
export function dedupeMashinaImageUrls(values: string[]) {
  const best = new Map<string, { url: string; rank: number; index: number }>();
  values.forEach((value, index) => {
    const identity = mashinaImageIdentity(value);
    if (!identity) return;
    const rank = mashinaImageRank(value);
    const current = best.get(identity);
    if (!current) best.set(identity, { url: value, rank, index });
    else if (rank > current.rank) best.set(identity, { url: value, rank, index: current.index });
  });
  return [...best.values()].sort((left, right) => left.index - right.index).map((item) => item.url);
}
function mashinaSourceImage(url: string): CatalogImage {
  const extension = url.match(/\.(jpe?g|png|webp|avif)(?:[?#]|$)/i)?.[1]?.toLowerCase();
  return {
    id: "",
    url,
    objectKey: "",
    checksum: "",
    size: 0,
    mimeType: extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : extension === "avif" ? "image/avif" : "image/jpeg",
  };
}
export function mashinaSourceGallery(values: string[], limit = 30) {
  return dedupeMashinaImageUrls(values).slice(0, Math.max(1, Math.min(30, limit))).map(mashinaSourceImage);
}
function imageUrls(markup: string, base: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/<(?:img|source|meta)[^>]+(?:data-original|data-lazy-src|data-src|src|content)\s*=\s*["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi)) match[1].split(",").forEach((item) => values.push(item.trim().split(/\s+/)[0]));
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) values.push(match[0].replace(/\\\//g, "/"));
  const sourceUrls = [...new Set(values
    .map((value) => absoluteUrl(value, base))
    .filter((url) => /^https?:/i.test(url) && !BAD_IMAGE_RE.test(url)))];
  return dedupeMashinaImageUrls(sourceUrls);
}
function deriveMakeModel(value: string) {
  const cleaned = plainText(value).replace(BADGE_RE, " ").replace(/\s+/g, " ").trim();
  const lower = cleaned.toLocaleLowerCase("en-US");
  let best: { make: string; index: number } | null = null;
  for (const candidate of KNOWN_MAKES) {
    const index = lower.indexOf(candidate.toLocaleLowerCase("en-US"));
    if (index >= 0 && (!best || index < best.index || (index === best.index && candidate.length > best.make.length))) best = { make: candidate, index };
  }
  if (!best) return { make: "", model: "" };
  const make = canonicalCatalogBrand(best.make);
  const after = cleaned.slice(best.index + best.make.length)
    .replace(/^[\s,\-–—|]+/, "")
    .split(/\s+(?=\$|USD\b|Som\b|KGS\b|сом\b|19\d{2}\b|20\d{2}\b)|\s*,\s*(?=19\d{2}\b|20\d{2}\b)/i)[0]
    .replace(/\s+/g, " ").trim();
  const modelSource = after.replace(/\s+[0-8](?:[.,][0-9])\s*(?:A\/?T|M\/?T|AT|MT|CVT|DCT|DSG|hyb(?:rid)?|diesel|petrol|gasoline|turbo|T|d)\b[\s\S]*$/i, "").trim();
  const model = modelSource.split(/\s+/).slice(0, 7).join(" ");
  return { make, model };
}
function parseMoney(text: string) {
  const usdRaw = text.match(/\$\s*([0-9][0-9\s,.]{2,})/i)?.[1] || text.match(/([0-9][0-9\s,.]{2,})\s*USD\b/i)?.[1];
  const usd = integer(usdRaw);
  if (usd && usd >= 300) return { price: usd, currency: "USD" as const };
  const kgsRaw = text.match(/([0-9][0-9\s,.]{3,})\s*(?:Som|KGS|сом)\b/i)?.[1]
    || text.match(/(?:Som|KGS|сом)\s*([0-9][0-9\s,.]{3,})/i)?.[1];
  const kgs = integer(kgsRaw);
  return kgs && kgs >= 20_000 ? { price: kgs, currency: "KGS" as const } : null;
}
function detailId(url: string) {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    const tail = path.split("/").filter(Boolean).at(-1) || "";
    return tail.match(/-([a-f0-9]{18,})$/i)?.[1] || tail;
  } catch { return ""; }
}
function identityMatches(markup: string, row: Pick<MashinaListRow, "make" | "model">) {
  const text = compact(plainText(markup).slice(0, 20_000));
  const make = compact(row.make);
  const tokens = String(row.model || "").split(/\s+/).map(compact).filter((token) => token.length >= 2).slice(0, 3);
  return Boolean(make && text.includes(make) && tokens.some((token) => text.includes(token)));
}

export function parseMashinaListingMarkup(markup: string, pageUrl: string): MashinaListRow[] {
  const anchors = [...markup.matchAll(/<a\b([^>]*)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ attrs: `${match[1]} ${match[3]}`, href: absoluteUrl(match[2], pageUrl), inner: match[4], index: match.index || 0 }))
    .filter((row) => DETAIL_RE.test(row.href));
  const grouped = new Map<string, { href: string; index: number; labels: string[] }>();
  for (const anchor of anchors) {
    const id = detailId(anchor.href);
    if (!id) continue;
    const current = grouped.get(id) || { href: anchor.href, index: anchor.index, labels: [] };
    current.index = Math.min(current.index, anchor.index);
    const label = plainText(anchor.inner) || plainText(anchor.attrs.match(/(?:title|aria-label)\s*=\s*["']([^"']+)/i)?.[1] || "");
    if (label) current.labels.push(label);
    grouped.set(id, current);
  }
  const entries = [...grouped.entries()].sort((left, right) => left[1].index - right[1].index);
  const rows: MashinaListRow[] = [];
  for (let index = 0; index < entries.length; index++) {
    const [id, entry] = entries[index];
    const end = entries[index + 1]?.[1].index || Math.min(markup.length, entry.index + 24_000);
    const card = markup.slice(entry.index, end);
    const text = plainText(card);
    const label = entry.labels.sort((left, right) => right.length - left.length)[0] || text;
    const identity = deriveMakeModel(`${label} ${text.slice(0, 1_500)}`);
    const money = parseMoney(text);
    const year = Number(text.match(/\b(19\d{2}|20\d{2})\s*(?:y\.|year|г\.)?/i)?.[1] || 0);
    const unitLiters = Number(text.match(/\b([0-9]+(?:[.,][0-9]+)?)\s*L\.?\b/i)?.[1]?.replace(",", ".") || 0);
    const liters = unitLiters || parseMashinaExplicitEngineLiters(text);
    const images = imageUrls(card, pageUrl).slice(0, 30);
    if (!identity.make || !identity.model || !year || !money || !images.length || COMMERCIAL_RE.test(`${identity.make} ${identity.model}`)) continue;
    rows.push({
      id,
      detailUrl: entry.href,
      title: `${identity.make} ${identity.model}`,
      make: identity.make,
      model: identity.model,
      year,
      price: money.price,
      currency: money.currency,
      mileageKm: integer(text.match(/([0-9][0-9\s,.]{1,})\s*km\b/i)?.[1]),
      engineCc: liters >= 0.3 && liters <= 15 ? Math.round(liters * 1_000) : undefined,
      fuel: text.match(/\b(Gasoline\s*\/\s*gas|Gasoline|Petrol|Diesel|Hybrid|Electric|Gas|LPG|CNG)\b/i)?.[1],
      transmission: text.match(/\b(Automatic|Manual|Variator|CVT|Robot|Robotic)\b/i)?.[1],
      bodyType: text.match(/\b(Sedan|Hatchback(?:\s+[35]\s+doors)?|Liftback|Fastback|Suv(?:\s+[35]\s+doors)?|Wagon|Coupe|Minivan|Compact van|Microvan|Pickup|Limousine|Van|Cabriolet|Roadster)\b/i)?.[1],
      location: text.match(/\b(Bishkek|Osh|Karakol|Tokmok|Jalal-Abad|Naryn|Talas|Batken|Kyrgyzstan)\b/i)?.[1],
      images,
    });
  }
  return rows;
}

async function request(url: string, referer: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 30_000));
  try {
    const response = await fetch(url, { headers: { ...HEADERS, referer }, redirect: "follow", signal: controller.signal });
    const markup = await response.text();
    if (!response.ok) throw new Error(`mashina_list_http_${response.status}`);
    if (/captcha|cloudflare|access denied|request blocked|verify you are human|forbidden/i.test(markup.slice(0, 3_000))) throw new Error(`mashina_list_blocked_${response.status}`);
    return { response, markup };
  } finally { clearTimeout(timeout); }
}

export class MashinaKyrgyzstanListAdapter implements CatalogSourceAdapter {
  sourceId = "mashina_kyrgyzstan_exact";
  market = "kyrgyzstan" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const urls = [
      `https://www.mashina.kg/en/search/?page=${page}`,
      `https://www.mashina.kg/search/?page=${page}`,
      `https://m.mashina.kg/search/en/?page=${page}`,
      `https://m.mashina.kg/search/?page=${page}`,
    ];
    let lastError = "mashina_list_no_route";
    for (const url of urls) {
      try {
        const { response, markup } = await request(url, "https://www.mashina.kg/en/search/");
        const items = parseMashinaListingMarkup(markup, response.url || url);
        if (!items.length) { lastError = `mashina_list_parsed_zero_${response.status}_${markup.length}`; continue; }
        return {
          items,
          nextCursor: String(page + 1),
          finished: false,
          count: items.length,
          health: { ok: true, message: `Mashina strict list parsed ${items.length}`, checkedAt: new Date().toISOString(), httpStatus: response.status },
        };
      } catch (error: any) {
        lastError = String(error?.message || error);
      }
    }
    throw new Error(lastError);
  }

  mapStatus(): OfferStatus { return "active"; }

  normalizeOffer(raw: MashinaListRow): VehicleOffer | null {
    if (!raw?.id || !raw.make || !raw.model || !isCatalogYearAllowed(raw.year, this.market) || !raw.price || !raw.detailUrl || !raw.images.length) return null;
    const now = new Date().toISOString();
    return normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, raw.id), sourceId: this.sourceId, sourceOfferId: raw.id,
      market: this.market, offerType: "fixed", status: "active", make: raw.make, model: raw.model,
      trim: raw.title, year: raw.year, mileageKm: raw.mileageKm, engineCc: raw.engineCc, powerHp: raw.powerHp,
      fuel: raw.fuel, transmission: raw.transmission, bodyType: raw.bodyType,
      sourcePrice: raw.price, sourceCurrency: raw.currency, priceMode: "fixed", images: [], totalRub: null,
      calculationStatus: "needs_data", firstSeenAt: now, updatedAt: now,
      operational: {
        sourceUrl: raw.detailUrl,
        sourceVenueName: raw.location || "Kyrgyzstan",
        sourcePublishedAt: now,
        gallerySourceImageCount: raw.images.length,
        raw: { images: raw.images, parsed: raw, listingBoundImages: true, photoIdentityVerified: true },
      },
    } as VehicleOffer) as VehicleOffer;
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const raw = offer.operational.raw as { images?: string[]; parsed?: MashinaListRow } | undefined;
    const row = raw?.parsed;
    const requested = Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30);
    const limit = Math.min(30, Math.max(1, Number.isFinite(requested) ? requested : 30));
    const requestedMinimum = Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 5);
    const minimum = Math.min(limit, Math.max(1, Number.isFinite(requestedMinimum) ? requestedMinimum : 5));
    let urls = dedupeMashinaImageUrls(raw?.images || row?.images || []);
    const detailUrl = offer.operational.sourceUrl || row?.detailUrl || "";
    if (detailUrl && row && urls.length < minimum) {
      try {
        const detail = await request(detailUrl, "https://www.mashina.kg/en/search/");
        if (identityMatches(detail.markup, row)) {
          urls = dedupeMashinaImageUrls([...urls, ...imageUrls(detail.markup, detail.response.url || detailUrl)]);
          const text = plainText(detail.markup);
          const cc = integer(text.match(/([0-9][0-9\s,.]{2,5})\s*(?:cc|cm3|cm³)/i)?.[1]);
          const unitLiters = Number(text.match(/\b([0-9]+(?:[.,][0-9]+)?)\s*(?:L|liter|litre)\b/i)?.[1]?.replace(",", ".") || 0);
          const liters = unitLiters || parseMashinaExplicitEngineLiters(text);
          offer.engineCc ||= cc || (liters >= 0.3 && liters <= 15 ? Math.round(liters * 1_000) : undefined);
          offer.powerHp ||= integer(text.match(/\b([0-9]{2,4})\s*(?:HP|PS|horsepower|л\.с\.)\b/i)?.[1]);
          (offer.operational.raw as any).detailIdentityVerified = true;
        }
      } catch {
        // Listing-bound list images remain the only accepted fallback.
      }
    }
    const gallery = mashinaSourceGallery(urls, limit);
    const verified = gallery.length >= minimum;
    offer.operational.gallerySourceImageCount = gallery.length;
    offer.operational.galleryVerified = verified;
    offer.operational.photoIdentityVerified = verified;
    offer.operational.galleryImageCount = gallery.length;
    offer.operational.galleryRefreshedAt = new Date().toISOString();
    offer.operational.gallerySafetyMode = "mashina_listing_bound_source_urls_v2";
    (offer.operational as any).galleryStoredAs = "json_urls";
    return verified ? gallery : [];
  }

  async healthCheck() { return { ok: true, message: "Mashina.kg strict listing parser", checkedAt: new Date().toISOString() }; }
}

export const mashinaKyrgyzstanListSource = new MashinaKyrgyzstanListAdapter();
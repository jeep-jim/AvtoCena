import { cacheImageFromUrl, stableOfferId } from "./storage";
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
const BAD_IMAGE_RE = /logo|icon|avatar|qrcode|qr-code|placeholder|banner|sprite|tracking|pixel|favicon|appstore|googleplay|no[-_ ]?(?:photo|image)/i;
const COMMERCIAL_RE = /\b(?:truck|bus|minibus|commercial|cargo|tractor|forklift|excavator|agricultural|scooter|motorcycle|quad\s*bike|sprinter|transit|crafter|ducato|boxer|jumper|canter|elf|dutro|fuso|hino)\b/i;
const KNOWN_MAKES = [
  "Mercedes-Benz", "Land Rover", "Range Rover", "Rolls-Royce", "Alfa Romeo", "Aston Martin", "Great Wall", "Li Auto",
  "Toyota", "Lexus", "Nissan", "Infiniti", "Honda", "Acura", "Mazda", "Mitsubishi", "Subaru", "Suzuki", "Daihatsu", "Isuzu",
  "Hyundai", "Genesis", "Kia", "KGM", "SsangYong", "BMW", "Audi", "Volkswagen", "Volvo", "Porsche", "Ford", "Chevrolet", "Cadillac",
  "Jeep", "Dodge", "Renault", "Peugeot", "Citroen", "Skoda", "SEAT", "MINI", "Fiat", "Opel", "Tesla", "BYD", "Geely", "Changan",
  "Chery", "GAC", "Haval", "Zeekr", "Nio", "XPeng", "Jetour", "Denza", "Hongqi", "Tank", "Voyah", "Aito", "Leapmotor", "Arcfox", "Neta",
  "Lada", "VAZ", "UAZ", "GAZ", "Moskvich", "Ravon", "Daewoo", "JAC", "FAW", "Dongfeng", "Exeed", "Omoda", "Jaecoo",
].sort((left, right) => right.length - left.length);

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
function compact(value: unknown) {
  return String(value || "").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}
function imageUrls(markup: string, base: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/<(?:img|source|meta)[^>]+(?:data-original|data-lazy-src|data-src|src|content)\s*=\s*["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi)) match[1].split(",").forEach((item) => values.push(item.trim().split(/\s+/)[0]));
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) values.push(match[0].replace(/\\\//g, "/"));
  return [...new Set(values.map((value) => absoluteUrl(value, base)).filter((url) => /^https?:/i.test(url) && !BAD_IMAGE_RE.test(url)))];
}
function deriveMakeModel(title: string) {
  const cleaned = plainText(title).replace(/^Urgent\s+/i, "").replace(/\b(?:19|20)\d{2}\b.*$/, "").trim();
  const lower = cleaned.toLocaleLowerCase("en-US");
  const make = KNOWN_MAKES.find((candidate) => lower === candidate.toLocaleLowerCase("en-US") || lower.startsWith(`${candidate.toLocaleLowerCase("en-US")} `));
  if (!make) return { make: "", model: "" };
  return { make, model: cleaned.slice(make.length).replace(/^[\s\-–—|]+/, "").trim() };
}
function parseMoney(text: string) {
  const usdRaw = text.match(/\$\s*([0-9][0-9\s,.]{2,})/i)?.[1] || text.match(/([0-9][0-9\s,.]{2,})\s*USD\b/i)?.[1];
  const usd = integer(usdRaw);
  if (usd && usd >= 300) return { price: usd, currency: "USD" as const };
  const kgsRaw = text.match(/([0-9][0-9\s,.]{3,})\s*(?:Som|KGS|сом)\b/i)?.[1];
  const kgs = integer(kgsRaw);
  return kgs && kgs >= 20_000 ? { price: kgs, currency: "KGS" as const } : null;
}
function meaningfulTitle(inner: string, fallback = "") {
  const candidates = [
    plainText(inner),
    plainText(inner.match(/(?:title|aria-label)\s*=\s*["']([^"']+)["']/i)?.[1] || ""),
    plainText(fallback),
  ].filter((value) => value.length >= 3 && value.length <= 140 && !/^(?:Urgent|Image|Add|Подробнее|More)$/i.test(value));
  return candidates.sort((left, right) => left.length - right.length)[0] || "";
}
function detailId(url: string) {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    const tail = path.split("/").filter(Boolean).at(-1) || "";
    return tail.match(/-([a-f0-9]{18,})$/i)?.[1] || tail;
  } catch { return ""; }
}
function identityMatches(markup: string, row: Pick<MashinaListRow, "make" | "model">) {
  const text = compact(plainText(markup).slice(0, 12_000));
  const make = compact(row.make);
  const modelTokens = String(row.model || "").split(/\s+/).map(compact).filter((token) => token.length >= 2).slice(0, 3);
  return Boolean(make && text.includes(make) && modelTokens.some((token) => text.includes(token)));
}

export function parseMashinaListingMarkup(markup: string, pageUrl: string): MashinaListRow[] {
  const anchors = [...markup.matchAll(/<a\b([^>]*)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ attrs: `${match[1]} ${match[3]}`, href: absoluteUrl(match[2], pageUrl), inner: match[4], index: match.index || 0 }))
    .filter((row) => DETAIL_RE.test(row.href));
  const grouped = new Map<string, { href: string; index: number; titles: string[] }>();
  for (const anchor of anchors) {
    const id = detailId(anchor.href);
    if (!id) continue;
    const current = grouped.get(id) || { href: anchor.href, index: anchor.index, titles: [] };
    current.index = Math.min(current.index, anchor.index);
    const title = meaningfulTitle(anchor.inner, anchor.attrs.match(/(?:title|aria-label)\s*=\s*["']([^"']+)["']/i)?.[1] || "");
    if (title) current.titles.push(title);
    grouped.set(id, current);
  }
  const entries = [...grouped.entries()].sort((left, right) => left[1].index - right[1].index);
  const rows: MashinaListRow[] = [];
  for (let index = 0; index < entries.length; index++) {
    const [id, entry] = entries[index];
    const previousBoundary = index ? entries[index - 1][1].index : 0;
    const start = Math.max(previousBoundary, entry.index - 3_000);
    const next = entries[index + 1]?.[1].index || Math.min(markup.length, entry.index + 18_000);
    const card = markup.slice(start, Math.max(entry.index + 1, next));
    const text = plainText(card);
    const title = [...entry.titles]
      .filter((value) => KNOWN_MAKES.some((make) => compact(value).startsWith(compact(make))))
      .sort((left, right) => left.length - right.length)[0] || [...entry.titles].sort((left, right) => left.length - right.length)[0] || "";
    const { make, model } = deriveMakeModel(title);
    const money = parseMoney(text);
    const year = Number(text.match(/\b(19\d{2}|20\d{2})\s*(?:y\.|year|г\.)?/i)?.[1] || 0);
    const liters = Number(text.match(/\b([0-9]+(?:[.,][0-9]+)?)\s*L\.?\b/i)?.[1]?.replace(",", ".") || 0);
    const mileageKm = integer(text.match(/([0-9][0-9\s,.]{1,})\s*km\b/i)?.[1]);
    const transmission = text.match(/\b(Automatic|Manual|Variator|CVT|Robot|Robotic)\b/i)?.[1];
    const fuel = text.match(/\b(Gasoline\s*\/\s*gas|Gasoline|Petrol|Diesel|Hybrid|Electric|Gas|LPG|CNG)\b/i)?.[1];
    const bodyType = text.match(/\b(Sedan|Hatchback(?:\s+[35]\s+doors)?|Liftback|Fastback|Suv(?:\s+[35]\s+doors)?|Wagon|Coupe|Minivan|Compact van|Microvan|Pickup|Limousine|Van|Cabriolet|Roadster)\b/i)?.[1];
    if (!make || !model || !year || !money || COMMERCIAL_RE.test(`${title} ${text.slice(0, 500)}`)) continue;
    rows.push({
      id,
      detailUrl: entry.href,
      title,
      make,
      model,
      year,
      price: money.price,
      currency: money.currency,
      mileageKm,
      engineCc: liters >= 0.3 && liters <= 15 ? Math.round(liters * 1_000) : undefined,
      fuel,
      transmission,
      bodyType,
      location: text.match(/\b(Bishkek|Osh|Karakol|Tokmok|Jalal-Abad|Naryn|Talas|Batken|Kyrgyzstan)\b/i)?.[1],
      images: imageUrls(card, pageUrl).slice(0, 30),
    });
  }
  return rows;
}

async function request(url: string, referer: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 18_000));
  try {
    const response = await fetch(url, { headers: { ...HEADERS, referer }, redirect: "follow", signal: controller.signal });
    const markup = await response.text();
    if (!response.ok) throw new Error(`mashina_list_http_${response.status}`);
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
    ];
    let lastStatus = 0;
    for (const url of urls) {
      try {
        const { response, markup } = await request(url, "https://www.mashina.kg/en/search/");
        lastStatus = response.status;
        const items = parseMashinaListingMarkup(markup, response.url || url);
        if (!items.length) continue;
        return {
          items,
          nextCursor: String(page + 1),
          finished: false,
          count: items.length,
          health: { ok: true, message: `Mashina list parsed ${items.length}`, checkedAt: new Date().toISOString(), httpStatus: response.status },
        };
      } catch {
        // Try the next current public route.
      }
    }
    throw new Error(`mashina_list_parsed_zero_${lastStatus}`);
  }

  mapStatus(): OfferStatus { return "active"; }

  normalizeOffer(raw: MashinaListRow): VehicleOffer | null {
    if (!raw?.id || !raw.make || !raw.model || !raw.year || !raw.price || !raw.detailUrl) return null;
    const now = new Date().toISOString();
    return normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, raw.id),
      sourceId: this.sourceId,
      sourceOfferId: raw.id,
      market: this.market,
      offerType: "fixed",
      status: "active",
      make: raw.make,
      model: raw.model,
      trim: raw.title,
      year: raw.year,
      mileageKm: raw.mileageKm,
      engineCc: raw.engineCc,
      fuel: raw.fuel,
      transmission: raw.transmission,
      bodyType: raw.bodyType,
      sourcePrice: raw.price,
      sourceCurrency: raw.currency,
      priceMode: "fixed",
      images: [],
      totalRub: null,
      calculationStatus: "needs_data",
      firstSeenAt: now,
      updatedAt: now,
      operational: {
        sourceUrl: raw.detailUrl,
        sourceVenueName: raw.location || "Kyrgyzstan",
        sourcePublishedAt: now,
        raw: { images: raw.images, parsed: raw, listingBoundImages: true },
      },
    } as VehicleOffer) as VehicleOffer;
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const raw = offer.operational.raw as { images?: string[]; parsed?: MashinaListRow } | undefined;
    const row = raw?.parsed;
    const limit = Math.min(30, Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
    let urls = [...new Set(raw?.images || row?.images || [])];
    const detailUrl = offer.operational.sourceUrl || row?.detailUrl || "";
    if (detailUrl && urls.length < limit) {
      try {
        const detail = await request(detailUrl, "https://www.mashina.kg/en/search/");
        if (row && identityMatches(detail.markup, row)) urls = [...urls, ...imageUrls(detail.markup, detail.response.url || detailUrl)];
      } catch {
        // Listing-bound images remain valid when detail is temporarily unavailable.
      }
    }
    const saved: CatalogImage[] = [];
    for (const url of [...new Set(urls)].slice(0, limit * 4)) {
      const image = await cacheImageFromUrl(url, this.market, { headers: { ...HEADERS, referer: detailUrl || "https://www.mashina.kg/en/search/" } }).catch(() => null);
      if (image && image.size > 8_000) saved.push(image);
      if (saved.length >= limit) break;
    }
    return saved;
  }

  async healthCheck() { return { ok: true, message: "Mashina.kg listing parser", checkedAt: new Date().toISOString() }; }
}

export const mashinaKyrgyzstanListSource = new MashinaKyrgyzstanListAdapter();

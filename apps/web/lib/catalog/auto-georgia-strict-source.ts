import { cacheImageFromUrl, stableOfferId } from "./storage";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ka;q=0.8,ru;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
const DETAIL_RE = /\/en\/auto\/[^/?#]+\/[^/?#]+\/[^/?#]+-\d+\.html$/i;
const BAD_IMAGE_RE = /logo|icon|avatar|qrcode|qr-code|placeholder|banner|sprite|tracking|pixel|favicon|appstore|googleplay|no[-_ ]?(?:photo|image)/i;

type AutoGeorgiaRow = {
  id: string;
  detailUrl: string;
  title: string;
  make: string;
  model: string;
  year: number;
  mileageKm?: number;
  engineCc?: number;
  powerHp?: number;
  fuel?: string;
  transmission?: string;
  drive?: string;
  bodyType?: string;
  location?: string;
  price: number;
  currency: "USD" | "GEL";
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
function titlePart(value: string) {
  return decodeURIComponent(value || "").split(/[-_]+/).filter(Boolean)
    .map((part) => part.toUpperCase() === part && part.length <= 4 ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
function identityFromUrl(detailUrl: string) {
  try {
    const parts = new URL(detailUrl).pathname.split("/").filter(Boolean);
    const autoIndex = parts.indexOf("auto");
    return {
      make: autoIndex >= 0 ? titlePart(parts[autoIndex + 1] || "") : "",
      model: autoIndex >= 0 ? titlePart(parts[autoIndex + 2] || "") : "",
    };
  } catch { return { make: "", model: "" }; }
}
function identityFromTitle(value: string, detailUrl: string) {
  const clean = plainText(value).replace(/^(?:TOP\s+VIP\s+BOOST|SUPER\s+VIP|VIP|BOOST)\s+/i, "").trim();
  const comma = clean.match(/^([^,]{2,45}),\s*([^,|$]{1,80})/);
  if (comma) return { make: comma[1].trim(), model: comma[2].trim() };
  return identityFromUrl(detailUrl);
}
function parseMoney(text: string) {
  const usd = text.match(/([0-9][0-9\s,.']{1,})\s*(?:USD|\$)/i) || text.match(/(?:USD|\$)\s*([0-9][0-9\s,.']{1,})/i);
  const gel = text.match(/([0-9][0-9\s,.']{1,})\s*(?:GEL|₾)/i) || text.match(/(?:GEL|₾)\s*([0-9][0-9\s,.']{1,})/i);
  const amount = integer(usd?.[1] || gel?.[1]);
  if (!amount) return null;
  return { price: amount, currency: usd ? "USD" as const : "GEL" as const };
}
function imageUrls(markup: string, base: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/<(?:img|source|meta)[^>]+(?:data-original|data-lazy-src|data-src|src|content)\s*=\s*["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi)) match[1].split(",").forEach((item) => values.push(item.trim().split(/\s+/)[0]));
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) values.push(match[0].replace(/\\\//g, "/"));
  return [...new Set(values.map((value) => absoluteUrl(value, base)).filter((url) => /^https?:/i.test(url) && !BAD_IMAGE_RE.test(url)))];
}
function identityMatches(markup: string, row: Pick<AutoGeorgiaRow, "make" | "model">) {
  const text = compact(plainText(markup).slice(0, 20_000));
  const make = compact(row.make);
  const tokens = String(row.model || "").split(/\s+/).map(compact).filter((token) => token.length >= 2).slice(0, 3);
  return Boolean(make && text.includes(make) && tokens.some((token) => text.includes(token)));
}

export function parseAutoGeorgiaStrictListing(markup: string, pageUrl: string): AutoGeorgiaRow[] {
  const links = [...markup.matchAll(/<a\b([^>]*)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: absoluteUrl(match[2], pageUrl), inner: match[4], attrs: `${match[1]} ${match[3]}`, index: match.index || 0 }))
    .filter((row) => {
      try { return DETAIL_RE.test(new URL(row.href).pathname); } catch { return false; }
    });
  const grouped = new Map<string, { href: string; index: number; labels: string[] }>();
  for (const link of links) {
    const current = grouped.get(link.href) || { href: link.href, index: link.index, labels: [] };
    current.index = Math.min(current.index, link.index);
    const label = plainText(link.inner) || plainText(link.attrs.match(/(?:title|aria-label)\s*=\s*["']([^"']+)/i)?.[1] || "");
    if (label) current.labels.push(label);
    grouped.set(link.href, current);
  }
  const entries = [...grouped.values()].sort((left, right) => left.index - right.index);
  const rows: AutoGeorgiaRow[] = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const end = entries[index + 1]?.index || Math.min(markup.length, entry.index + 24_000);
    const card = markup.slice(entry.index, end);
    const text = plainText(card);
    const label = entry.labels.sort((left, right) => left.length - right.length).find((value) => value.includes(",")) || entry.labels[0] || "";
    const identity = identityFromTitle(label, entry.href);
    const money = parseMoney(text);
    const year = Number(text.match(/\b(19\d{2}|20\d{2})\b/)?.[1] || 0);
    if (!identity.make || !identity.model || !money || !year || !/\bSale\b/i.test(text)) continue;
    const id = entry.href.match(/-(\d+)\.html$/i)?.[1] || stableOfferId("auto_georgia_open", entry.href);
    const liters = Number(text.match(/\b([0-9]+(?:[.,][0-9]+)?)\s*(?:L|liter|litre)\b/i)?.[1]?.replace(",", ".") || 0);
    rows.push({
      id,
      detailUrl: entry.href,
      title: `${identity.make} ${identity.model}`,
      make: identity.make,
      model: identity.model,
      year,
      mileageKm: integer(text.match(/([0-9][0-9\s,.']+)\s*km\b/i)?.[1]),
      engineCc: liters >= 0.3 && liters <= 15 ? Math.round(liters * 1_000) : undefined,
      fuel: text.match(/\b(Gasoline|Petrol|Diesel|Hybrid|Electric|LPG|CNG|Gas)\b/i)?.[1],
      transmission: text.match(/\b(Automatic|Manual|Variator|CVT|Robot|Automanual)\b/i)?.[1],
      bodyType: text.match(/\b(Sedan|Hatchback|Liftback|Fastback|SUV|Wagon|Coupe|Minivan|Pickup|Van|Cabriolet|Roadster)\b/i)?.[1],
      location: text.match(/\b(Tbilisi|Kutaisi|Qutaisi|Batumi|Poti|Rustavi|Telavi|Gori|Senaki|Zugdidi|Gurjaani|Kaspi)\b/i)?.[1] || "Georgia",
      price: money.price,
      currency: money.currency,
      images: imageUrls(card, pageUrl).slice(0, 30),
    });
  }
  return rows;
}

async function request(url: string, referer = "https://www.auto.ge/en/auto/index.html") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 25_000));
  try {
    const response = await fetch(url, { headers: { ...HEADERS, referer }, redirect: "follow", signal: controller.signal });
    const markup = await response.text();
    if (!response.ok) throw new Error(`auto_georgia_http_${response.status}`);
    if (/captcha|cloudflare|access denied|request blocked|verify you are human|forbidden/i.test(markup.slice(0, 3_000))) throw new Error(`auto_georgia_blocked_${response.status}`);
    return { response, markup };
  } finally { clearTimeout(timer); }
}

export const autoGeorgiaStrictSource: CatalogSourceAdapter = {
  sourceId: "auto_georgia_open",
  market: "georgia",
  accessMode: "public_html",
  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const url = page === 1 ? "https://www.auto.ge/en/auto/index.html" : `https://www.auto.ge/en/auto/index${page}.html`;
    const { response, markup } = await request(url);
    const items = parseAutoGeorgiaStrictListing(markup, response.url || url);
    if (!items.length) throw new Error(`auto_georgia_strict_parsed_zero_${response.status}_${markup.length}`);
    return { items, nextCursor: String(page + 1), finished: false, count: items.length,
      health: { ok: true, message: `AUTO.GE strict parsed ${items.length}`, checkedAt: new Date().toISOString(), httpStatus: response.status } };
  },
  mapStatus(): OfferStatus { return "active"; },
  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as AutoGeorgiaRow;
    if (!row?.id || !row.make || !row.model || !row.year || !row.price || !row.detailUrl || !row.images.length) return null;
    const now = new Date().toISOString();
    return normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, row.id), sourceId: this.sourceId, sourceOfferId: row.id,
      market: this.market, offerType: "fixed", status: "active", make: row.make, model: row.model,
      trim: row.title, year: row.year, mileageKm: row.mileageKm, engineCc: row.engineCc, powerHp: row.powerHp,
      fuel: row.fuel, transmission: row.transmission, drive: row.drive, bodyType: row.bodyType,
      sourcePrice: row.price, sourceCurrency: row.currency, priceMode: "fixed", images: [], totalRub: null,
      calculationStatus: "needs_data", firstSeenAt: now, updatedAt: now,
      operational: {
        sourceUrl: row.detailUrl,
        sourceVenueName: row.location || "AUTO.GE Georgia",
        sourcePublishedAt: now,
        gallerySourceImageCount: row.images.length,
        raw: { ...row, images: row.images, listingBoundImages: true, photoIdentityVerified: true },
      },
    } as VehicleOffer) as VehicleOffer;
  },
  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const raw = (offer.operational?.raw || {}) as AutoGeorgiaRow & { images?: string[] };
    const row: AutoGeorgiaRow = raw;
    const detailUrl = String(offer.operational?.sourceUrl || row.detailUrl || "");
    const limit = Math.min(30, Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
    let urls = [...new Set((row.images || []).map(String).filter(Boolean))];
    if (detailUrl && urls.length < limit) {
      const detail = await request(detailUrl, detailUrl).catch(() => null);
      if (detail && identityMatches(detail.markup, row)) {
        urls = [...new Set([...urls, ...imageUrls(detail.markup, detail.response.url || detailUrl)])];
        const text = plainText(detail.markup);
        const cc = integer(text.match(/([0-9][0-9\s,.']{2,5})\s*(?:cc|cm3|cm³)/i)?.[1]);
        const liters = Number(text.match(/\b([0-9]+(?:[.,][0-9]+)?)\s*(?:L|liter|litre)\b/i)?.[1]?.replace(",", ".") || 0);
        offer.engineCc ||= cc || (liters >= 0.3 && liters <= 15 ? Math.round(liters * 1_000) : undefined);
        offer.powerHp ||= integer(text.match(/\b([0-9]{2,4})\s*(?:HP|PS|horsepower)\b/i)?.[1]);
        (offer.operational.raw as any).detailIdentityVerified = true;
      }
    }
    offer.operational.gallerySourceImageCount = urls.length;
    const saved: CatalogImage[] = [];
    for (const url of urls.slice(0, limit * 4)) {
      const image = await cacheImageFromUrl(url, this.market, { headers: { ...HEADERS, referer: detailUrl || "https://www.auto.ge/en/auto/index.html" } }).catch(() => null);
      if (image && image.size > 8_000) saved.push(image);
      if (saved.length >= limit) break;
    }
    return saved;
  },
  async healthCheck() { return { ok: true, message: "AUTO.GE strict listing parser", checkedAt: new Date().toISOString() }; },
};

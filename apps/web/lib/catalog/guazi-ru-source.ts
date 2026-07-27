import { cacheImageFromUrl, stableOfferId } from "./storage";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
const DETAIL_RE = /\/products\/([a-z0-9-]+)\.html/i;
const BAD_IMAGE_RE = /logo|icon|avatar|qrcode|placeholder|banner|sprite|tracking|pixel|favicon|appstore|googleplay|collect|seller|verified|no[-_ ]?(?:photo|image)/i;
const COMMERCIAL_RE = /\b(?:truck|pickup|commercial|cargo|bus|minibus|van|lorry|tractor|forklift|excavator|machinery|toano|transit|sprinter|crafter|ducato|boxer|jumper|poer|t60|t8)\b/i;
const KNOWN_MAKES = [
  "Mercedes-Benz", "Land Rover", "Range Rover", "Rolls-Royce", "Alfa Romeo", "Aston Martin", "Great Wall", "Li Auto",
  "Toyota", "Lexus", "Nissan", "Infiniti", "Honda", "Acura", "Mazda", "Mitsubishi", "Subaru", "Suzuki", "Daihatsu", "Isuzu",
  "Hyundai", "Genesis", "Kia", "KGM", "SsangYong", "BMW", "Audi", "Volkswagen", "Volvo", "Porsche", "Ford", "Chevrolet", "Cadillac",
  "Jeep", "Dodge", "Renault", "Peugeot", "Citroen", "Skoda", "SEAT", "MINI", "Fiat", "Opel", "Tesla", "BYD", "Geely Auto", "Geely", "Changan",
  "Chery", "GAC Trumpchi", "GAC", "Haval", "Zeekr", "Nio", "XPeng", "Jetour", "Denza", "Hongqi", "Tank", "Voyah", "Aito", "Leapmotor", "Arcfox", "Neta",
  "Buick", "Maserati", "Jaguar", "Lincoln", "JAC Group", "JAC", "Foton",
].sort((left, right) => right.length - left.length);

export type GuaziRuRow = {
  id: string;
  detailUrl: string;
  title: string;
  make: string;
  model: string;
  year: number;
  productionDate?: string;
  mileageKm?: number;
  engineCc?: number;
  fuel?: string;
  transmission?: string;
  drive?: string;
  price: number;
  currency: "USD";
  images: string[];
};

function decodeHtml(value: string) {
  return String(value || "").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
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
function integer(value: string | undefined) {
  const parsed = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
function imageUrls(markup: string, base: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/<(?:img|source)[^>]+(?:data-original|data-lazy-src|data-src|src|content)\s*=\s*["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi)) match[1].split(",").forEach((item) => values.push(item.trim().split(/\s+/)[0]));
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) values.push(match[0].replace(/\\\//g, "/"));
  return [...new Set(values.map((value) => absoluteUrl(value, base)).filter((url) => /^https?:/i.test(url) && /guazistatic-global\.com/i.test(url) && !BAD_IMAGE_RE.test(url)))];
}
function cleanTitle(value: string) {
  return plainText(value).replace(/^Оценка\s*[SABCD]\s*/i, "").replace(/^Grade\s*[SABCD]\s*/i, "")
    .replace(/Guazi used car.*$/i, "").replace(/China used car export.*$/i, "").trim();
}
function deriveMakeModel(title: string) {
  const cleaned = cleanTitle(title).replace(/^Used\s+/i, "");
  const yearMatch = cleaned.match(/\b(19\d{2}|20\d{2})\b/);
  const beforeYear = yearMatch ? cleaned.slice(0, yearMatch.index).trim() : cleaned;
  const lower = beforeYear.toLocaleLowerCase("en-US");
  const make = KNOWN_MAKES.find((candidate) => lower === candidate.toLocaleLowerCase("en-US") || lower.startsWith(`${candidate.toLocaleLowerCase("en-US")} `));
  if (!make) return { make: "", model: "" };
  const normalizedMake = make === "Geely Auto" ? "Geely" : make === "GAC Trumpchi" ? "GAC" : make;
  return { make: normalizedMake, model: beforeYear.slice(make.length).replace(/^[\s\-–—|]+/, "").trim().split(/\s+/).slice(0, 5).join(" ") };
}
function meaningfulTitle(inner: string) {
  const alt = inner.match(/\balt\s*=\s*["']([^"']+)["']/i)?.[1];
  const value = cleanTitle(alt || inner);
  return /\b(?:19|20)\d{2}\b/.test(value) && value.length <= 240 ? value : "";
}
function isDetailHref(value: string) {
  try { return DETAIL_RE.test(new URL(value).pathname); } catch { return false; }
}
function mileageFromCard(value: string) {
  return integer(
    value.match(/(?:19|20)\d{2}[./-](?:0?[1-9]|1[0-2])\s+([0-9][0-9,]*)\s*km\b/i)?.[1]
      || value.match(/\b([0-9]{1,3}(?:,[0-9]{3})+)\s*km\b/i)?.[1]
      || value.match(/\b([0-9]{1,7})\s*km\b/i)?.[1],
  );
}

export function parseGuaziRuMarkup(markup: string, pageUrl: string): GuaziRuRow[] {
  const anchors = [...markup.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: absoluteUrl(match[1], pageUrl), inner: match[2], index: match.index || 0 }))
    .filter((row) => isDetailHref(row.href));
  const grouped = new Map<string, { href: string; index: number; titles: string[] }>();
  for (const anchor of anchors) {
    const id = anchor.href.match(DETAIL_RE)?.[1];
    if (!id) continue;
    const current = grouped.get(id) || { href: anchor.href, index: anchor.index, titles: [] };
    current.index = Math.min(current.index, anchor.index);
    const title = meaningfulTitle(anchor.inner);
    if (title) current.titles.push(title);
    grouped.set(id, current);
  }
  const entries = [...grouped.entries()].sort((left, right) => left[1].index - right[1].index);
  const rows: GuaziRuRow[] = [];
  for (let index = 0; index < entries.length; index++) {
    const [id, entry] = entries[index];
    const nextIndex = entries[index + 1]?.[1].index || Math.min(markup.length, entry.index + 14_000);
    const card = markup.slice(entry.index, Math.max(entry.index + 1, nextIndex));
    const cardText = plainText(card);
    const title = [...entry.titles].sort((left, right) => right.length - left.length)[0] || "";
    const { make, model } = deriveMakeModel(title);
    const titleYear = Number(title.match(/\b(19\d{2}|20\d{2})\b/)?.[1]);
    const production = cardText.match(/\b(19\d{2}|20\d{2})[./-](0?[1-9]|1[0-2])\b/);
    const price = [...cardText.matchAll(/(?:Цена\s*)?(?:FOB\s*)?\$\s*([0-9][0-9, ]+)/gi)]
      .map((match) => integer(match[1])).find((value): value is number => Boolean(value));
    const liters = Number(title.match(/\b(\d+(?:\.\d+)?)\s*[LT]\b/i)?.[1]);
    const transmission = title.match(/\b(CVT|DCT|DSG|Automatic|Manual|AT|MT)\b/i)?.[1];
    const drive = title.match(/\b(AWD|4WD|Four[- ]Wheel[- ]Drive|2WD|Two[- ]Wheel[- ]Drive|FWD|RWD)\b/i)?.[1];
    const fuel = /полностью электромобиль|electric|\bEV\b/i.test(cardText) ? "Electric" : /плаг-ин гибрид|plug-in hybrid|PHEV/i.test(cardText) ? "PHEV"
      : /гибрид|hybrid/i.test(cardText) ? "Hybrid" : /дизель|diesel/i.test(cardText) ? "Diesel" : /бензин|gasoline|petrol/i.test(cardText) ? "Petrol" : undefined;
    if (!make || !model || !titleYear || !price || COMMERCIAL_RE.test(`${title} ${cardText.slice(0, 500)}`)) continue;
    rows.push({ id, detailUrl: entry.href, title, make, model, year: titleYear,
      productionDate: production ? `${production[1]}-${String(Number(production[2])).padStart(2, "0")}` : undefined,
      mileageKm: mileageFromCard(cardText),
      engineCc: Number.isFinite(liters) && liters > 0 && liters <= 10 ? Math.round(liters * 1_000) : undefined,
      fuel, transmission, drive, price, currency: "USD", images: imageUrls(card, pageUrl).slice(0, 8) });
  }
  return rows;
}

export class GuaziRuAdapter implements CatalogSourceAdapter {
  sourceId = "guazi_china_ru";
  market = "china" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const url = page === 1 ? "https://ru.guazi.com/used-cars/" : `https://ru.guazi.com/used-cars/page${page}/`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 15_000));
    try {
      const response = await fetch(url, { headers: HEADERS, redirect: "follow", signal: controller.signal });
      const markup = await response.text();
      if (!response.ok) throw new Error(`guazi_china_ru_http_${response.status}`);
      if (/captcha|verify you are human|access denied|request blocked|cloudflare/i.test(markup.slice(0, 4_000))) throw new Error(`guazi_china_ru_blocked_${response.status}`);
      const items = parseGuaziRuMarkup(markup, response.url || url);
      return { items, nextCursor: items.length ? String(page + 1) : null, finished: !items.length, count: items.length,
        health: { ok: items.length > 0, message: `Guazi RU parsed ${items.length}`, checkedAt: new Date().toISOString(), httpStatus: response.status, contentType: response.headers.get("content-type") || "" } };
    } finally { clearTimeout(timeout); }
  }

  mapStatus(): OfferStatus { return "active"; }

  normalizeOffer(raw: GuaziRuRow): VehicleOffer | null {
    if (!raw?.id || !raw.make || !raw.model || !raw.year || !raw.price || !raw.detailUrl) return null;
    const now = new Date().toISOString();
    return normalizeVehicleOfferSpecs({ id: stableOfferId(this.sourceId, raw.id), sourceId: this.sourceId, sourceOfferId: raw.id, market: "china",
      offerType: "fixed", status: "active", make: raw.make, model: raw.model, trim: raw.title, year: raw.year, productionDate: raw.productionDate,
      mileageKm: raw.mileageKm, engineCc: raw.engineCc, fuel: raw.fuel, transmission: raw.transmission, drive: raw.drive,
      sourcePrice: raw.price, sourceCurrency: raw.currency, priceMode: "fixed", images: [], totalRub: null, calculationStatus: "needs_data",
      firstSeenAt: now, updatedAt: now, operational: { sourceUrl: raw.detailUrl, sourceVenueName: "Guazi China Export", sourcePublishedAt: now,
        raw: { images: raw.images, parsed: raw, listingBoundImages: true } } } as VehicleOffer) as VehicleOffer;
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const raw = offer.operational.raw as { images?: string[]; parsed?: GuaziRuRow } | undefined;
    const urls = [...new Set(raw?.images || raw?.parsed?.images || [])];
    const limit = Math.min(30, Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
    const saved: CatalogImage[] = [];
    for (const url of urls.slice(0, limit)) {
      const image = await cacheImageFromUrl(url, "china", { headers: { ...HEADERS, referer: offer.operational.sourceUrl || "https://ru.guazi.com/used-cars/" } }).catch(() => null);
      if (image && image.size > 8_000) saved.push(image);
      if (saved.length >= limit) break;
    }
    return saved;
  }

  async healthCheck() { return { ok: true, message: "Guazi RU public listing parser", checkedAt: new Date().toISOString() }; }
}

export const guaziRuSource = new GuaziRuAdapter();

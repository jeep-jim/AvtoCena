import { cacheImageFromUrl, stableOfferId } from "./storage";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ka;q=0.8",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
};
const DETAIL_PATH_RE = /^\/en\/usd\/([^/?#]+)\/([^/?#]+)\/(\d{5,})\/?$/i;
const COMMERCIAL_RE = /\b(?:truck|bus|minibus|commercial|cargo|tractor|forklift|excavator|loader|agricultural|scooter|motorcycle|quad\s*bike|sprinter|transit|crafter|ducato|boxer|jumper)\b/i;
const KNOWN_MAKES = [
  "Mercedes-Benz", "Land Rover", "Range Rover", "Rolls-Royce", "Alfa Romeo", "Aston Martin", "Great Wall", "Li Auto",
  "Toyota", "Lexus", "Nissan", "Infiniti", "Honda", "Acura", "Mazda", "Mitsubishi", "Subaru", "Suzuki", "Daihatsu", "Isuzu",
  "Hyundai", "Genesis", "Kia", "KGM", "SsangYong", "BMW", "Audi", "Volkswagen", "Volvo", "Porsche", "Ford", "Chevrolet", "Cadillac",
  "Jeep", "Dodge", "Renault", "Peugeot", "Citroen", "Skoda", "SEAT", "MINI", "Fiat", "Opel", "Tesla", "BYD", "Geely", "Changan",
  "Chery", "GAC", "Haval", "Zeekr", "Nio", "XPeng", "Jetour", "Denza", "Hongqi", "Tank", "Voyah", "Aito", "Leapmotor", "Arcfox", "Neta",
  "Maserati", "Bentley", "Lincoln", "GMC", "Buick", "Chrysler", "Rivian", "Lucid", "Polestar",
].sort((left, right) => right.length - left.length);

export type AutoPapaGeorgiaRow = {
  id: string;
  detailUrl: string;
  title: string;
  make: string;
  model: string;
  year: number;
  price: number;
  currency: "USD";
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
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
function plainText(value: string) {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function absoluteUrl(value: string, base: string) {
  if (!value || /^(?:data:|javascript:|mailto:|tel:)/i.test(value)) return "";
  try { return new URL(value.replace(/&amp;/gi, "&"), base).toString(); } catch { return ""; }
}
function integer(value: unknown) {
  const parsed = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
function detailParts(value: string) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(DETAIL_PATH_RE);
    return match ? { makeSlug: decodeURIComponent(match[1]), modelSlug: decodeURIComponent(match[2]), id: match[3] } : null;
  } catch { return null; }
}
function readableSlug(value: string) {
  return decodeURIComponent(value || "").replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
}
function deriveIdentity(label: string, detailUrl: string) {
  const cleaned = plainText(label).trim();
  const lower = cleaned.toLocaleLowerCase("en-US");
  const make = KNOWN_MAKES.find((candidate) => lower === candidate.toLocaleLowerCase("en-US") || lower.startsWith(`${candidate.toLocaleLowerCase("en-US")} `));
  if (make) {
    const model = cleaned.slice(make.length).replace(/^[\s\-–—|]+/, "").trim();
    if (model) return { make, model };
  }
  const parts = detailParts(detailUrl);
  if (!parts) return { make: "", model: "" };
  const rawMake = readableSlug(parts.makeSlug);
  const canonicalMake = KNOWN_MAKES.find((candidate) => candidate.toLocaleLowerCase("en-US") === rawMake.toLocaleLowerCase("en-US")) || rawMake.replace(/\b\w/g, (char) => char.toUpperCase());
  return { make: canonicalMake, model: readableSlug(parts.modelSlug) };
}
function parseUsdBeforeYear(text: string) {
  // AutoPapa renders list rows as "$13 000 2023 year ...". Binding the amount
  // to the following explicit year prevents the old "$13 000 2023" => 130002023 bug.
  const match = text.match(/\$\s*([0-9][0-9\s,]{1,14}?)\s+(?=(?:19|20)\d{2}\s+year\b)/i);
  const amount = integer(match?.[1]);
  return amount && amount >= 300 && amount <= 2_500_000 ? amount : undefined;
}
function parseMileageKm(text: string) {
  const match = text.match(/([0-9]{1,3}(?:\s[0-9]{3})*|[0-9]{1,6})\s*K\.\s*km\b/i)
    || text.match(/([0-9]{1,3}(?:\s[0-9]{3})*|[0-9]{1,6})\s*km\b/i);
  if (!match) return undefined;
  const amount = integer(match[1]);
  if (!amount) return undefined;
  const usesK = /K\.\s*km/i.test(match[0]);
  const grouped = /\s[0-9]{3}/.test(match[1]);
  return usesK && !grouped && amount < 1_000 ? amount * 1_000 : amount;
}
function parseEngineCc(text: string) {
  const liters = Number(text.match(/\b([0-9](?:[.,][0-9])?)\s*l\b/i)?.[1]?.replace(",", ".") || 0);
  return Number.isFinite(liters) && liters >= 0.6 && liters <= 8 ? Math.round(liters * 1_000) : undefined;
}
function autoPapaImageUrls(markup: string, base: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/(?:src|data-src|data-original|href)\s*=\s*["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/https?:\/\/[^"'\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\s<>]*)?/gi)) values.push(match[0]);
  return [...new Set(values
    .map((value) => absoluteUrl(value, base))
    .filter((url) => {
      try {
        const parsed = new URL(url);
        return /(?:^|\.)autopapa\.ge$/i.test(parsed.hostname)
          && /\/system\/car\/photos\//i.test(parsed.pathname)
          && /\.(?:jpe?g|png|webp|avif)$/i.test(parsed.pathname);
      } catch { return false; }
    }))];
}

export function parseAutoPapaGeorgiaListingMarkup(markup: string, pageUrl: string): AutoPapaGeorgiaRow[] {
  const anchors = [...markup.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: absoluteUrl(match[1], pageUrl), inner: match[2], index: match.index || 0 }))
    .filter((item) => Boolean(detailParts(item.href)));
  const grouped = new Map<string, { href: string; index: number; labels: string[] }>();
  for (const anchor of anchors) {
    const parts = detailParts(anchor.href);
    if (!parts) continue;
    const current = grouped.get(parts.id) || { href: anchor.href, index: anchor.index, labels: [] };
    current.index = Math.min(current.index, anchor.index);
    const label = plainText(anchor.inner);
    if (label && label.length <= 140) current.labels.push(label);
    grouped.set(parts.id, current);
  }
  const entries = [...grouped.entries()].sort((left, right) => left[1].index - right[1].index);
  const rows: AutoPapaGeorgiaRow[] = [];
  for (let index = 0; index < entries.length; index++) {
    const [id, entry] = entries[index];
    const end = entries[index + 1]?.[1].index || Math.min(markup.length, entry.index + 18_000);
    const card = markup.slice(entry.index, end);
    const text = plainText(card);
    const title = entry.labels.filter((value) => !/^image$/i.test(value)).sort((left, right) => right.length - left.length)[0] || "";
    const identity = deriveIdentity(title, entry.href);
    const year = Number(text.match(/\b(19\d{2}|20\d{2})\s+year\b/i)?.[1] || 0);
    const price = parseUsdBeforeYear(text);
    if (!identity.make || !identity.model || year < 2020 || !price || COMMERCIAL_RE.test(`${identity.make} ${identity.model} ${text.slice(0, 260)}`)) continue;
    rows.push({
      id,
      detailUrl: entry.href,
      title: title || `${identity.make} ${identity.model}`,
      make: identity.make,
      model: identity.model,
      year,
      price,
      currency: "USD",
      mileageKm: parseMileageKm(text),
      engineCc: parseEngineCc(text),
      fuel: text.match(/\b(plug[- ]?in hybrid|petrol\/gas|petrol|diesel|hybrid|electric|gas|hydrogen)\b/i)?.[1],
      transmission: text.match(/\b(automatic|manual|cvt|dct)\b/i)?.[1],
      bodyType: text.match(/\b(suv|minivan|sedan|hatchback|coupe|wagon|cabriolet|pickup)\b/i)?.[1],
      location: text.match(/\b(Tbilisi|Batumi|Rustavi|Kutaisi|Poti|Gori|Kobuleti|Telavi)\b/i)?.[1],
      images: autoPapaImageUrls(card, pageUrl).slice(0, 8),
    });
  }
  return rows;
}

async function request(url: string, timeoutMs = 15_000) {
  const response = await fetch(url, { headers: HEADERS, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  const markup = await response.text();
  if (!response.ok) throw new Error(`autopapa_http_${response.status}`);
  return { response, markup };
}

export function autoPapaGeorgiaDetailImageCandidates(markup: string, pageUrl: string) {
  return autoPapaImageUrls(markup, pageUrl).slice(0, 90);
}

export class AutoPapaGeorgiaAdapter implements CatalogSourceAdapter {
  sourceId = "autopapa_georgia_open";
  market = "georgia" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const url = `https://autopapa.ge/en/usd/search?page=${page}`;
    const { response, markup } = await request(url);
    const items = parseAutoPapaGeorgiaListingMarkup(markup, response.url || url);
    if (!items.length) throw new Error(`autopapa_georgia_parsed_zero_status_${response.status}_bytes_${markup.length}`);
    return {
      items,
      nextCursor: String(page + 1),
      finished: false,
      count: items.length,
      health: {
        ok: true,
        message: `AutoPapa Georgia dedicated parser: ${items.length}`,
        checkedAt: new Date().toISOString(),
        httpStatus: response.status,
        contentType: response.headers.get("content-type") || "",
      },
    };
  }

  mapStatus(): OfferStatus { return "active"; }

  normalizeOffer(raw: AutoPapaGeorgiaRow): VehicleOffer | null {
    if (!raw?.id || !raw.make || !raw.model || raw.year < 2020 || !raw.price || !raw.detailUrl) return null;
    const now = new Date().toISOString();
    return normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, raw.id),
      sourceId: this.sourceId,
      sourceOfferId: raw.id,
      market: "georgia",
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
        sourceVenueName: raw.location || "Georgia",
        sourcePublishedAt: now,
        raw: { images: raw.images, parsed: raw, listingBoundImages: true },
      },
    } as VehicleOffer) as VehicleOffer;
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    // Until the detail-page gallery boundary is verified, only list-card images
    // that are provably inside this exact listing segment may be cached.
    const raw = offer.operational.raw as { images?: string[]; parsed?: AutoPapaGeorgiaRow } | undefined;
    const urls = [...new Set(raw?.images || raw?.parsed?.images || [])];
    const limit = Math.min(30, Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
    const saved: CatalogImage[] = [];
    for (const url of urls.slice(0, limit)) {
      const image = await cacheImageFromUrl(url, "georgia", { headers: { ...HEADERS, referer: offer.operational.sourceUrl || "https://autopapa.ge/en/usd/search" } }).catch(() => null);
      if (image && image.size > 8_000 && !saved.some((item) => item.id === image.id)) saved.push(image);
      if (saved.length >= limit) break;
    }
    return saved;
  }

  async healthCheck() {
    return { ok: true, message: "AutoPapa Georgia dedicated listing parser", checkedAt: new Date().toISOString() };
  }
}

export const autoPapaGeorgiaSource = new AutoPapaGeorgiaAdapter();

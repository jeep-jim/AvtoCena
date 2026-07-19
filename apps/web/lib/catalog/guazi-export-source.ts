import { cacheImageFromUrl, stableOfferId } from "./storage";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

type GuaziRow = {
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
  images: string[];
};

const BASE_URL = "https://en.guazi.com";
const HEADERS = {
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  referer: `${BASE_URL}/used-cars/`,
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};

const BRAND_SLUGS = [
  "volkswagen", "toyota", "bmw", "byd", "geely-auto", "audi", "mercedes-benz", "honda", "hyundai", "nissan",
  "chery", "jetour", "changan", "great-wall", "mg", "xiaomi-auto", "li-auto", "lexus", "peugeot", "ford",
  "haval", "porsche", "mazda", "mitsubishi", "subaru", "suzuki", "kia", "volvo", "cadillac", "chevrolet",
  "land-rover", "buick", "tesla", "nio", "xpeng", "zeekr", "hongqi", "gac", "denza", "polestar",
];

const MAKES = [
  "Mercedes-Benz", "Land Rover", "Rolls-Royce", "Alfa Romeo", "Aston Martin", "Great Wall", "Xiaomi Auto", "Geely Auto",
  "Li Auto", "Volkswagen", "Toyota", "Lexus", "Nissan", "Infiniti", "Honda", "Mazda", "Mitsubishi", "Subaru", "Suzuki",
  "Hyundai", "Genesis", "Kia", "KGM", "SsangYong", "BMW", "Audi", "Volvo", "Porsche", "Ford", "Chevrolet", "Cadillac",
  "Jeep", "Dodge", "Renault", "Peugeot", "Citroen", "Skoda", "SEAT", "MINI", "BYD", "Geely", "Changan", "Chery",
  "GAC", "Haval", "Zeekr", "Nio", "XPeng", "Jetour", "Denza", "Rox", "Opel", "Fiat", "Tesla", "Buick", "Hongqi",
  "Polestar", "MG", "NETA", "Venucia", "DS",
].sort((left, right) => right.length - left.length);

const BAD_IMAGE = /logo|icon|avatar|collect|notification|banner|qrcode|qr-code|placeholder|tracking|pixel|section-image|back-to-top|whatsapp|recommend|related|similar/i;

function decode(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function clean(value: unknown) {
  return decode(String(value || ""))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value: string, base = BASE_URL) {
  try {
    return new URL(decode(value).replace(/\\\//g, "/"), base).toString();
  } catch {
    return "";
  }
}

function integer(value: unknown) {
  const number = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function collectImages(markup: string, base: string) {
  const candidates: string[] = [];
  for (const match of markup.matchAll(/<(?:img|source)[^>]+(?:data-src|data-original|data-lazy-src|src)\s*=\s*["']([^"']+)["']/gi)) candidates.push(match[1]);
  for (const match of markup.matchAll(/(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']/gi)) {
    for (const part of match[1].split(",")) candidates.push(part.trim().split(/\s+/)[0]);
  }
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) candidates.push(match[0].replace(/\\\//g, "/"));
  return [...new Set(candidates
    .map((item) => absoluteUrl(item, base))
    .filter((url) => url && /\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(url) && !BAD_IMAGE.test(url)))];
}

function imageGroup(url: string) {
  try {
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname)
      .replace(/\/(?:w|f)?_?\d+x\d+\//i, "/size/")
      .split("/")
      .filter(Boolean);
    return `${parsed.hostname.toLowerCase()}/${path.slice(0, Math.max(1, path.length - 1)).join("/")}`;
  } catch {
    return "";
  }
}

function detailGallery(markup: string, pageUrl: string, cover: string, limit: number) {
  const candidates = collectImages(markup, pageUrl).slice(0, 80);
  const coverGroup = imageGroup(cover);
  if (coverGroup) {
    const preferred = candidates.filter((url) => imageGroup(url) === coverGroup);
    if (preferred.length >= 4) return preferred.slice(0, limit);
  }

  // Main product media is rendered before recommendations. Only inspect the
  // first image region, then keep one coherent path group from that region.
  const early = candidates.slice(0, Math.max(limit * 4, 24));
  const groups = new Map<string, string[]>();
  for (const url of early) {
    const group = imageGroup(url);
    if (!group) continue;
    groups.set(group, [...(groups.get(group) || []), url]);
  }
  const best = [...groups.values()].sort((left, right) => right.length - left.length)[0] || [];
  return (best.length >= 4 ? best : early).slice(0, limit);
}

function makeModel(rawTitle: string) {
  const title = clean(rawTitle)
    .replace(/^Grade\s+[A-Z0-9+-]+\s+/i, "")
    .replace(/^Used\s+/i, "")
    .replace(/\s+Guazi used car.*$/i, "")
    .trim();
  const lower = title.toLocaleLowerCase("en-US");
  const make = MAKES.find((candidate) => lower === candidate.toLocaleLowerCase("en-US") || lower.startsWith(`${candidate.toLocaleLowerCase("en-US")} `)) || "";
  const rest = make ? title.slice(make.length).trim() : "";
  return { title, make, model: rest.replace(/^(?:19|20)\d{2}\s+/, "").split(/\s+/).slice(0, 8).join(" ") };
}

function fuel(value: string) {
  if (/PHEV|Plug[- ]?in/i.test(value)) return "phev";
  if (/REEV|Extended[- ]?Range/i.test(value)) return "reev";
  if (/HEV|Hybrid/i.test(value)) return "hybrid";
  if (/BEV|Electric|EV\b/i.test(value)) return "electric";
  if (/Diesel/i.test(value)) return "diesel";
  if (/Gasoline|Petrol/i.test(value)) return "petrol";
  return "";
}

function bodyType(value: string) {
  if (/SUV|Crossover/i.test(value)) return "suv";
  if (/Hatchback/i.test(value)) return "hatchback";
  if (/Wagon|Estate/i.test(value)) return "wagon";
  if (/Coupe/i.test(value)) return "coupe";
  if (/Convertible|Cabrio/i.test(value)) return "convertible";
  if (/Pickup|Pick up/i.test(value)) return "pickup";
  if (/Van|MPV|Mini Van/i.test(value)) return "minivan";
  if (/Sedan|Saloon/i.test(value)) return "sedan";
  return "";
}

export function parseGuaziExportPage(markup: string, pageUrl: string): GuaziRow[] {
  const matches = [...markup.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']*\/products\/[^"']+\.html[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const grouped = new Map<string, { first: number; inner: string }>();
  for (const match of matches) {
    const url = absoluteUrl(match[1], pageUrl);
    if (!url || grouped.has(url)) continue;
    grouped.set(url, { first: match.index || 0, inner: match[2] });
  }
  const entries = [...grouped.entries()].sort((left, right) => left[1].first - right[1].first);
  const rows: GuaziRow[] = [];
  for (let index = 0; index < entries.length; index++) {
    const [url, anchor] = entries[index];
    const nextIndex = index + 1 < entries.length ? entries[index + 1][1].first : markup.length;
    const card = markup.slice(anchor.first, nextIndex);
    const titleCandidates = [
      clean(anchor.inner),
      clean(anchor.inner.match(/<img[^>]+alt\s*=\s*["']([^"']+)["']/i)?.[1]),
      clean(card.match(/<h[1-5][^>]*>([\s\S]*?)<\/h[1-5]>/i)?.[1]),
    ].filter((candidate) => /\bUsed\b/i.test(candidate) && candidate.length >= 8 && candidate.length <= 260);
    const parsed = makeModel(titleCandidates.sort((left, right) => right.length - left.length)[0] || "");
    const plain = clean(card);
    const year = Number(parsed.title.match(/\b(?:19|20)\d{2}\b/)?.[0] || plain.match(/\b(?:19|20)\d{2}\b/)?.[0]);
    const price = integer(plain.match(/FOB\s*Price\s*:\s*\$\s*([0-9,]+)/i)?.[1]);
    const mileageKm = integer(plain.match(/(?:19|20)\d{2}(?:\.\d{1,2})?\s+([0-9,]+)\s*km\b/i)?.[1] || plain.match(/([0-9,]+)\s*km\b/i)?.[1]);
    const liters = Number(parsed.title.match(/\b([0-9](?:\.[0-9])?)L\b/i)?.[1] || 0);
    const powerHp = integer(parsed.title.match(/\b([0-9]{2,4})\s*(?:PS|HP)\b/i)?.[1]);
    const coverImages = collectImages(anchor.inner, pageUrl).slice(0, 2);
    if (!parsed.make || !parsed.model || !year || !price || !mileageKm || !coverImages.length) continue;
    const id = url.match(/\/products\/[^/]*-([a-z0-9]{6,})\.html/i)?.[1] || stableOfferId("guazi", url);
    rows.push({
      id, url, title: parsed.title, make: parsed.make, model: parsed.model, year, price, mileageKm,
      engineCc: liters ? Math.round(liters * 1_000) : undefined,
      powerHp,
      fuel: fuel(`${parsed.title} ${plain}`),
      transmission: /\b(?:AT|Automatic|DCT|CVT)\b/i.test(parsed.title) ? "automatic" : /\b(?:MT|Manual)\b/i.test(parsed.title) ? "manual" : "",
      drive: /All[- ]Wheel|Four[- ]Wheel|4WD|AWD|4MATIC|xDrive/i.test(parsed.title) ? "awd" : /Rear[- ]Wheel|RWD/i.test(parsed.title) ? "rwd" : /Front[- ]Wheel|FWD/i.test(parsed.title) ? "fwd" : "",
      bodyType: bodyType(`${parsed.title} ${plain}`),
      images: coverImages,
    });
  }
  return rows;
}

async function fetchHtml(url: string, referer = `${BASE_URL}/used-cars/`) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 35_000));
  try {
    const response = await fetch(url, { headers: { ...HEADERS, referer }, redirect: "follow", signal: controller.signal });
    return { response, markup: await response.text() };
  } finally {
    clearTimeout(timeout);
  }
}

export class GuaziExportAdapter implements CatalogSourceAdapter {
  sourceId = "guazi_china_export";
  market = "china" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const position = Math.max(1, Number(cursor || 1));
    const brandIndex = (position - 1) % BRAND_SLUGS.length;
    const page = Math.floor((position - 1) / BRAND_SLUGS.length) + 1;
    const slug = BRAND_SLUGS[brandIndex];
    const pageUrl = `${BASE_URL}/used-cars/${slug}/${page > 1 ? `page${page}/` : ""}`;
    const result = await fetchHtml(pageUrl);
    if (!result.response.ok) throw new Error(`guazi_export_http_${result.response.status}_${slug}_${page}`);
    const rows = parseGuaziExportPage(result.markup, pageUrl);
    if (!rows.length) throw new Error(`guazi_export_zero_${slug}_${page}_${result.markup.length}`);
    return {
      items: rows,
      nextCursor: String(position + 1),
      finished: false,
      count: rows.length,
      health: {
        ok: true,
        message: `Guazi export ${slug} page ${page}: parsed ${rows.length}`,
        checkedAt: new Date().toISOString(),
        httpStatus: result.response.status,
        contentType: result.response.headers.get("content-type") || "",
      },
    };
  }

  mapStatus(): OfferStatus { return "active"; }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as GuaziRow;
    if (!row.id || !row.make || !row.model || !row.year || !row.price || !row.images.length) return null;
    const now = new Date().toISOString();
    return normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, row.id),
      sourceId: this.sourceId,
      sourceOfferId: row.id,
      market: "china",
      offerType: "fixed",
      status: "active",
      make: row.make,
      model: row.model,
      trim: row.title,
      year: row.year,
      mileageKm: row.mileageKm,
      engineCc: row.engineCc,
      powerHp: row.powerHp,
      fuel: row.fuel,
      transmission: row.transmission,
      drive: row.drive,
      bodyType: row.bodyType,
      sourcePrice: row.price,
      sourceCurrency: "USD",
      priceMode: "fixed",
      images: [],
      totalRub: null,
      calculationStatus: "ready",
      firstSeenAt: now,
      updatedAt: now,
      operational: { sourceUrl: row.url, sourceVenueName: "Guazi China Export", raw: row },
    } as VehicleOffer);
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const row = offer.operational.raw as GuaziRow;
    const requested = Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 8);
    const limit = Math.min(24, Math.max(4, Number.isFinite(requested) ? requested : 8));
    const detail = row.url ? await fetchHtml(row.url, row.url).catch(() => null) : null;
    const urls = detail?.response.ok ? detailGallery(detail.markup, row.url, row.images[0] || "", limit) : row.images.slice(0, limit);
    row.images = [...new Set(urls)];
    (offer.operational as any).raw = row;
    const cached = await Promise.all(row.images.map((url) =>
      cacheImageFromUrl(url, "china", { headers: { ...HEADERS, referer: row.url } }).catch(() => null),
    ));
    return cached.filter((image): image is CatalogImage => Boolean(image && image.size > 8_000)).slice(0, limit);
  }

  async healthCheck() {
    return { ok: true, message: "Guazi exact detail galleries", checkedAt: new Date().toISOString() };
  }
}

export const guaziChinaExportSource = new GuaziExportAdapter();

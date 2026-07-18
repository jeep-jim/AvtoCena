import { cacheImageFromUrl, stableOfferId } from "./storage";
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
  currency?: string;
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
  "accept-language": "pl-PL,pl;q=0.9,en;q=0.8",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};

const MAKES = [
  "Mercedes-Benz", "Land Rover", "Rolls-Royce", "Alfa Romeo", "Aston Martin", "DS Automobiles", "Toyota", "Lexus",
  "Nissan", "Infiniti", "Honda", "Mazda", "Mitsubishi", "Subaru", "Suzuki", "Hyundai", "Genesis", "Kia", "BMW",
  "Audi", "Volkswagen", "Volvo", "Porsche", "Ford", "Chevrolet", "Cadillac", "Jeep", "Dodge", "Renault", "Peugeot",
  "Citroen", "Skoda", "SEAT", "MINI", "Opel", "Fiat", "Tesla", "Cupra", "BYD", "MG", "Omoda", "RAM", "Jaguar",
  "Dacia", "Smart", "Polestar",
].sort((a, b) => b.length - a.length);

const BRAND_PATHS = [
  "audi", "bmw", "mercedes-benz", "volkswagen", "toyota", "volvo", "skoda", "ford", "opel", "renault", "peugeot",
  "citroen", "seat", "cupra", "kia", "hyundai", "honda", "mazda", "nissan", "lexus", "porsche", "jeep",
  "land-rover", "jaguar", "mini", "fiat", "dacia", "tesla", "mitsubishi", "subaru",
];

const BAD_IMAGE = /logo|icon|avatar|qrcode|qr-code|placeholder|banner|seller|dealer|tracking|pixel|finance|appstore|googleplay/i;

function clean(value: unknown) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\s\u00a0\u202f]+/g, " ")
    .trim();
}

function abs(value: string, base: string) {
  try {
    return new URL(value.replace(/&amp;/gi, "&").replace(/\\\//g, "/"), base).toString();
  } catch {
    return "";
  }
}

function integer(value: unknown) {
  const result = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(result) && result > 0 ? result : undefined;
}

function plausibleYear(value: unknown) {
  const year = Number(value || 0);
  return Number.isInteger(year) && year >= 1950 && year <= new Date().getFullYear() + 1 ? year : undefined;
}

function parsePrice(value: string) {
  const amount = "([0-9]{1,3}(?:[ .]\\d{3})+|[0-9]{4,7})(?![0-9])";
  const collect = (currency: string) => [...value.matchAll(new RegExp(`${amount}\\s*${currency}\\b`, "gi"))]
    .map((match) => integer(match[1]) || 0)
    .filter((price) => price >= 1_000 && price <= 5_000_000);
  const pln = collect("(?:PLN|zł)");
  if (pln.length) return { price: Math.max(...pln), currency: "PLN" };
  const eur = collect("EUR");
  if (eur.length) return { price: Math.max(...eur), currency: "EUR" };
  return { price: undefined, currency: undefined };
}

function parseMileage(value: string) {
  const labeled = value.match(/\bmileage\s+([0-9][0-9 .]{0,12})\s*km\b/i)?.[1]
    || value.match(/\bprzebieg\s*[:：]?\s*([0-9][0-9 .]{0,12})\s*km\b/i)?.[1];
  if (labeled) return integer(labeled);
  return integer(value.match(/([0-9][0-9 .]{0,12})\s+km\b/)?.[1]);
}

function makeModel(raw: string) {
  const title = clean(raw).replace(/^Używany\s+/i, "").trim();
  const lower = title.toLowerCase();
  const make = MAKES.find((item) => lower === item.toLowerCase() || lower.startsWith(`${item.toLowerCase()} `)) || "";
  return {
    title,
    make,
    model: make ? title.slice(make.length).trim().split(/\s+/).slice(0, 8).join(" ") : "",
  };
}

function images(markup: string, base: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/<(?:img|source)[^>]+(?:data-src|data-original|data-lazy-src|src)\s*=\s*["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']/gi)) {
    for (const part of match[1].split(",")) values.push(part.trim().split(/\s+/)[0]);
  }
  return [...new Set(values
    .map((value) => abs(value, base))
    .filter((url) => url && !BAD_IMAGE.test(url) && (/\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url) || /apollo\.olxcdn\.com|\/image(?:[;/?#]|$)|otomoto/i.test(url))))]
    .slice(0, 20);
}

function fuel(value: string) {
  return /Hybryda Plug-in|PHEV/i.test(value) ? "phev"
    : /Hybryda|hybrid/i.test(value) ? "hybrid"
      : /Diesel|Olej napędowy/i.test(value) ? "diesel"
        : /Elektrycz|Electric/i.test(value) ? "electric"
          : /Benzyna/i.test(value) ? "petrol"
            : /LPG/i.test(value) ? "lpg" : "";
}

function transmission(value: string) {
  return /Automatyczna|Automat/i.test(value) ? "automatic" : /Manualna|Manual/i.test(value) ? "manual" : "";
}

function body(value: string) {
  return /SUV|Crossover/i.test(value) ? "suv"
    : /Kombi/i.test(value) ? "wagon"
      : /Hatchback|Auta miejskie/i.test(value) ? "hatchback"
        : /Coupe/i.test(value) ? "coupe"
          : /Kabriolet/i.test(value) ? "convertible"
            : /Sedan|Limuzyna/i.test(value) ? "sedan"
              : /Van|Minivan/i.test(value) ? "minivan"
                : /Pickup|Pick-up/i.test(value) ? "pickup" : "";
}

function parseYear(block: string, plain: string, title: string, engineCc?: number) {
  const explicit = [
    plain.match(/\b(?:Rok produkcji|Production year|Model year|Year)\s*[:：]?\s*((?:19|20)\d{2})\b/i)?.[1],
    block.match(/(?:data-testid|aria-label)=["'][^"']*(?:production[-_ ]?year|model[-_ ]?year|rok[-_ ]?produkcji)[^"']*["'][^>]*>[\s\S]{0,120}?\b((?:19|20)\d{2})\b/i)?.[1],
    block.match(/["'](?:productionYear|modelYear|vehicleModelDate|year)["']\s*[:=]\s*["']?((?:19|20)\d{2})\b/i)?.[1],
    title.match(/\b((?:19|20)\d{2})\b/)?.[1],
  ];
  for (const value of explicit) {
    const year = plausibleYear(value);
    if (year) return year;
  }

  for (const match of plain.matchAll(/\b((?:19|20)\d{2})\b/g)) {
    const year = plausibleYear(match[1]);
    if (!year) continue;
    const start = Math.max(0, (match.index || 0) - 36);
    const end = Math.min(plain.length, (match.index || 0) + match[0].length + 36);
    const context = plain.slice(start, end);
    if (/cm(?:3|³)|pojemno|engine|silnik|\bKM\b|PLN|EUR|przebieg|mileage/i.test(context)) continue;
    if (engineCc && year === engineCc) continue;
    return year;
  }
  return undefined;
}

async function request(url: string, referer = "https://www.otomoto.pl/osobowe") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 35_000));
  try {
    const response = await fetch(url, { headers: { ...HEADERS, referer }, redirect: "follow", signal: controller.signal });
    return { response, markup: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

function titleFrom(block: string) {
  const candidates = [
    ...[...block.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map((match) => clean(match[1])),
    ...[...block.matchAll(/<a\b[^>]*href=["'][^"']*\/osobowe\/oferta\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi)].map((match) => clean(match[1])),
    ...[...block.matchAll(/<img[^>]+alt=["']([^"']+)["']/gi)].map((match) => clean(match[1])),
  ];
  return candidates.find((candidate) => candidate.length >= 4
    && candidate.length <= 220
    && !/^(?:ad link|image|zobacz|więcej|promowane|wyróżnione|save|loading)$/i.test(candidate)
    && makeModel(candidate).make) || "";
}

function parseBlock(block: string, listUrl: string): Row | null {
  const href = block.match(/href=["']([^"']*\/osobowe\/oferta\/[^"']+-ID[A-Za-z0-9]+\.html[^"']*)["']/i)?.[1];
  const url = href ? abs(href, listUrl) : "";
  if (!url) return null;

  const parsed = makeModel(titleFrom(block));
  const plain = clean(block);
  const engineCc = integer(plain.match(/([0-9][0-9 .]{2,})\s*cm(?:3|³)\b/i)?.[1]);
  const year = parseYear(block, plain, parsed.title, engineCc);
  if (!parsed.make || !parsed.model || !year) return null;

  const parsedPrice = parsePrice(plain);
  return {
    id: url.match(/-ID([A-Za-z0-9]+)\.html/i)?.[1] || stableOfferId("otomoto", url),
    url,
    title: parsed.title,
    make: parsed.make,
    model: parsed.model,
    year,
    price: parsedPrice.price,
    currency: parsedPrice.currency,
    mileageKm: parseMileage(plain),
    engineCc,
    powerHp: integer(plain.match(/([0-9]{2,4})\s*KM\b/)?.[1]),
    fuel: fuel(plain),
    transmission: transmission(plain),
    drive: /4x4|AWD|4-Matic|quattro|xDrive|Allrad/i.test(plain) ? "awd" : "",
    bodyType: body(plain),
    images: images(block, listUrl),
  };
}

export function parseOtomotoCurrentPage(markup: string, listUrl: string) {
  const result: Row[] = [];
  const seen = new Set<string>();
  const articles = [...markup.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/gi)].map((match) => match[0]);
  for (const article of articles) {
    const row = parseBlock(article, listUrl);
    if (row && !seen.has(row.url)) {
      seen.add(row.url);
      result.push(row);
    }
  }
  if (result.length) return result;

  const anchors = [...markup.matchAll(/<a\b[^>]*href=["']([^"']*\/osobowe\/oferta\/[^"']+-ID[A-Za-z0-9]+\.html[^"']*)["'][^>]*>/gi)];
  for (let index = 0; index < anchors.length; index++) {
    const start = anchors[index].index || 0;
    const end = Math.min(markup.length, index + 1 < anchors.length ? (anchors[index + 1].index || markup.length) : start + 14_000);
    const row = parseBlock(markup.slice(start, end), listUrl);
    if (row && !seen.has(row.url)) {
      seen.add(row.url);
      result.push(row);
    }
  }
  return result;
}

export class OtomotoCurrentAdapter implements CatalogSourceAdapter {
  sourceId = "otomoto_europe_exact";
  market = "europe" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    let index = Math.max(0, Number(cursor || 0));
    while (index < BRAND_PATHS.length) {
      const brand = BRAND_PATHS[index];
      const listUrl = `https://www.otomoto.pl/osobowe/${brand}`;
      const listing = await request(listUrl);
      if (!listing.response.ok) {
        index += 1;
        continue;
      }
      const rows = parseOtomotoCurrentPage(listing.markup, listUrl).slice(0, 40);
      if (rows.length) {
        return {
          items: rows,
          nextCursor: String(index + 1),
          finished: index + 1 >= BRAND_PATHS.length,
          count: rows.length,
          health: {
            ok: true,
            message: `OTOMOTO ${brand}: ${rows.length}`,
            checkedAt: new Date().toISOString(),
            httpStatus: listing.response.status,
            contentType: listing.response.headers.get("content-type") || "",
          },
        };
      }
      index += 1;
    }
    return {
      items: [],
      nextCursor: null,
      finished: true,
      count: 0,
      health: { ok: true, message: "OTOMOTO brand catalog exhausted", checkedAt: new Date().toISOString() },
    };
  }

  mapStatus(): OfferStatus {
    return "active";
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as Row;
    if (!row.id || !row.make || !row.model || !row.year || !row.images.length) return null;
    const now = new Date().toISOString();
    return normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, row.id),
      sourceId: this.sourceId,
      sourceOfferId: row.id,
      market: "europe",
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
      sourcePrice: row.price || null,
      sourceCurrency: row.price ? (row.currency || "PLN") : null,
      priceMode: row.price ? "fixed" : "estimated",
      images: [],
      totalRub: null,
      calculationStatus: row.price ? "ready" : "needs_data",
      firstSeenAt: now,
      updatedAt: now,
      operational: { sourceUrl: row.url, sourceVenueName: "OTOMOTO", raw: row },
    } as VehicleOffer);
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const row = offer.operational.raw as Row;
    const limit = Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 3));
    let urls = [...(row.images || [])];
    if (urls.length < limit) {
      const detail = await request(row.url, row.url).catch(() => null);
      if (detail?.response.ok) urls = [...urls, ...images(detail.markup, row.url)];
    }
    const cached = await Promise.all([...new Set(urls)].slice(0, limit).map((url) =>
      cacheImageFromUrl(url, "europe", { headers: { ...HEADERS, referer: row.url } }).catch(() => null),
    ));
    return cached.filter((image): image is CatalogImage => Boolean(image && image.size > 8_000));
  }

  async healthCheck() {
    return { ok: true, message: "OTOMOTO clean brand catalogs", checkedAt: new Date().toISOString() };
  }
}

export const otomotoEuropeCurrentSource = new OtomotoCurrentAdapter();
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
  color?: string;
  images: string[];
};

const H = {
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};
const MAKES = [
  "Mercedes-Benz", "Land Rover", "Rolls-Royce", "Toyota", "Lexus", "Nissan", "Infiniti", "Honda", "Mazda", "Mitsubishi",
  "Subaru", "Suzuki", "Hyundai", "Genesis", "Kia", "BMW", "Audi", "Volkswagen", "Volvo", "Porsche", "Ford", "Chevrolet",
  "Cadillac", "Jeep", "Dodge", "Renault", "Peugeot", "Citroen", "Skoda", "MINI", "BYD", "Geely", "Changan", "Chery", "GAC",
  "Haval", "Tesla", "Jetour",
].sort((a, b) => b.length - a.length);

function clean(value: unknown) {
  return String(value || "")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function abs(value: string, base: string) { try { return new URL(value.replace(/\\\//g, "/"), base).toString(); } catch { return ""; } }
function num(value: unknown) { const result = Number(String(value || "").replace(/[^0-9]/g, "")); return Number.isFinite(result) && result > 0 ? result : undefined; }

async function html(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 35_000));
  try {
    const response = await fetch(url, { headers: H, redirect: "follow", signal: controller.signal });
    return { response, markup: await response.text() };
  } finally { clearTimeout(timer); }
}

function makeModel(title: string) {
  const normalized = title.replace(/^\s*(?:19|20)\d{2}\s+/, "").replace(/^used\s+/i, "").trim();
  const lower = normalized.toLowerCase();
  const make = MAKES.find((candidate) => lower === candidate.toLowerCase() || lower.startsWith(`${candidate.toLowerCase()} `)) || "";
  return { make, model: make ? normalized.slice(make.length).replace(/^\s*[-–—|]\s*/, "").split(/\s+/).slice(0, 8).join(" ") : "" };
}

function labeled(plain: string, labels: string[]) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = plain.match(new RegExp(`${escaped}\s*[:：]?\s*([^|•]{1,80}?)(?=\s+(?:${labels.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\s*[:：]?|$)`, "i"));
    if (match?.[1]) return clean(match[1]);
  }
  return "";
}

function coherent(urls: string[]) {
  const groups = new Map<string, string[]>();
  for (const value of urls) {
    try {
      const parsed = new URL(value);
      const parts = parsed.pathname.split("/").filter(Boolean);
      const key = `${parsed.hostname}/${parts.slice(0, Math.max(1, parts.length - 1)).join("/")}`;
      groups.set(key, [...(groups.get(key) || []), value]);
    } catch { /* invalid source URL */ }
  }
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  return (best && best.length >= 3 ? best : urls).slice(0, 15);
}

function parsePrice(plain: string) {
  const patterns: Array<[RegExp, string]> = [
    [/(?:AED|د\.?إ\.?)\s*([0-9][0-9, ]{2,})/i, "AED"],
    [/(?:USD|US\$|\$)\s*([0-9][0-9, ]{2,})/i, "USD"],
    [/(?:SAR|ر\.?س\.?)\s*([0-9][0-9, ]{2,})/i, "SAR"],
    [/([0-9][0-9, ]{2,})\s*(?:AED|د\.?إ\.?)/i, "AED"],
    [/([0-9][0-9, ]{2,})\s*(?:USD|US\$)/i, "USD"],
  ];
  for (const [pattern, currency] of patterns) {
    const price = num(plain.match(pattern)?.[1]);
    if (price) return { price, currency };
  }
  return { price: undefined, currency: undefined };
}

function parse(markup: string, url: string): Row | null {
  const plain = clean(markup);
  const rawTitle = clean(markup.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || markup.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]);
  const title = rawTitle.replace(/\s+(?:19|20)\d{2}\s+for sale.*$/i, "").trim();
  const parsedName = makeModel(title);
  const year = Number((title + " " + plain).match(/\b(?:19|20)\d{2}\b/)?.[0]);
  if (!parsedName.make || !parsedName.model || !year) return null;

  const parsedPrice = parsePrice(plain);
  const mileageKm = num(plain.match(/(?:Kilometers?|Mileage)?\s*([0-9][0-9, ]+)\s*Km\b/i)?.[1]);
  const liters = Number((plain.match(/(?:Engine capacity|Engine)?\s*([0-9]+(?:\.[0-9]+)?)\s*L\b/i)?.[1] || "0"));
  const engineCc = liters ? Math.round(liters * 1000) : num(plain.match(/([0-9][0-9, ]+)\s*cc\b/i)?.[1]);
  const powerHp = num(plain.match(/(?:Horsepower)?\s*([0-9]{2,4})\s*HP\b/i)?.[1]);
  const specs = ["Fuel Type", "Transmission", "Drive type", "Vehicle type", "Color", "Model year", "Kilometers", "Engine capacity", "Horsepower"];

  const candidates = [...new Set([...markup.matchAll(/(?:data-src|data-original|data-lazy-src|src)=["']([^"']+\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)["']/gi)]
    .map((match) => abs(match[1], url))
    .filter((value) => value && !/(?:logo|icon|avatar|qrcode|qr-code|placeholder|banner|related|similar|people-also-viewed|dealer)/i.test(value)))];
  const images = coherent(candidates);
  if (!images.length) return null;

  return {
    id: url.match(/-(\d{5,})\.html/i)?.[1] || url,
    url,
    title,
    make: parsedName.make,
    model: parsedName.model,
    year,
    price: parsedPrice.price,
    currency: parsedPrice.currency,
    mileageKm,
    engineCc,
    powerHp,
    fuel: labeled(plain, specs.slice(0)),
    transmission: labeled(plain, ["Transmission", ...specs]),
    drive: labeled(plain, ["Drive type", ...specs]),
    bodyType: labeled(plain, ["Vehicle type", ...specs]),
    color: labeled(plain, ["Color", ...specs]),
    images,
  };
}

export class DubicarsExactAdapter implements CatalogSourceAdapter {
  sourceId = "dubicars_uae_exact";
  market = "uae" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const listUrl = `https://www.dubicars.com/uae/used?page=${page}`;
    const list = await html(listUrl);
    if (!list.response.ok) throw new Error(`dubicars_http_${list.response.status}`);
    const links = [...new Set([...list.markup.matchAll(/href=["']([^"']+-\d{5,}\.html)["']/gi)].map((match) => abs(match[1], listUrl)))].slice(0, 40);
    const rows: Row[] = [];
    for (let index = 0; index < links.length; index += 6) {
      const batch = await Promise.all(links.slice(index, index + 6).map(async (detailUrl) => {
        const detail = await html(detailUrl).catch(() => null);
        return detail?.response.ok ? parse(detail.markup, detailUrl) : null;
      }));
      rows.push(...batch.filter(Boolean) as Row[]);
    }
    if (!rows.length) throw new Error("dubicars_exact_zero");
    return { items: rows, nextCursor: String(page + 1), finished: false, count: rows.length };
  }

  mapStatus(): OfferStatus { return "active"; }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as Row;
    if (!row.id || !row.images.length) return null;
    const now = new Date().toISOString();
    return normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, row.id), sourceId: this.sourceId, sourceOfferId: row.id, market: "uae", offerType: "fixed", status: "active",
      make: row.make, model: row.model, trim: row.title, year: row.year, mileageKm: row.mileageKm, engineCc: row.engineCc, powerHp: row.powerHp,
      fuel: row.fuel, transmission: row.transmission, drive: row.drive, bodyType: row.bodyType, color: row.color,
      sourcePrice: row.price || null, sourceCurrency: row.price ? (row.currency || "AED") : null, priceMode: row.price ? "fixed" : "estimated",
      images: [], totalRub: null, calculationStatus: row.price ? "ready" : "needs_data", firstSeenAt: now, updatedAt: now,
      operational: { sourceUrl: row.url, sourceVenueName: "DubiCars UAE", raw: row },
    } as VehicleOffer);
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const row = offer.operational.raw as Row;
    const results = await Promise.all(row.images.slice(0, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 10)).map((url) =>
      cacheImageFromUrl(url, "uae", { headers: { ...H, referer: row.url } }).catch(() => null),
    ));
    return results.filter((image): image is CatalogImage => Boolean(image && image.size > 8000));
  }

  async healthCheck() { return { ok: true, message: "DubiCars exact detail pages", checkedAt: new Date().toISOString() }; }
}

export const dubicarsUaeExactSource = new DubicarsExactAdapter();

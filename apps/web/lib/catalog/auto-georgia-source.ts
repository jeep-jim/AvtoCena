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
const KNOWN_MAKES = [
  "Mercedes-Benz", "Land Rover", "Range Rover", "Rolls-Royce", "Alfa Romeo", "Aston Martin", "Great Wall", "Li Auto",
  "Toyota", "Lexus", "Nissan", "Infiniti", "Honda", "Acura", "Mazda", "Mitsubishi", "Subaru", "Suzuki", "Daihatsu", "Isuzu",
  "Hyundai", "Genesis", "Kia", "KGM", "SsangYong", "BMW", "Audi", "Volkswagen", "Volvo", "Porsche", "Ford", "Chevrolet", "Cadillac",
  "Jeep", "Dodge", "Renault", "Peugeot", "Citroen", "Skoda", "SEAT", "MINI", "Fiat", "Opel", "Tesla", "BYD", "Geely", "Changan",
  "Chery", "GAC", "Haval", "Zeekr", "Nio", "XPeng", "Jetour", "Denza", "Hongqi", "Tank", "Voyah", "Aito", "Leapmotor", "Arcfox", "Neta",
].sort((left, right) => right.length - left.length);

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
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function plainText(markup: string) {
  return decodeHtml(markup)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value: string, baseUrl: string) {
  if (!value || /^(?:data:|javascript:|mailto:|tel:)/i.test(value)) return "";
  try { return new URL(value.replace(/\\\//g, "/").replace(/&amp;/gi, "&"), baseUrl).toString(); } catch { return ""; }
}

function integer(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function priceNumber(value: string) {
  let clean = String(value || "").replace(/[\s']/g, "");
  if (clean.includes(",") && clean.includes(".")) clean = clean.replace(/,/g, "");
  else if (clean.includes(",")) {
    const tail = clean.split(",").at(-1) || "";
    clean = tail.length === 3 ? clean.replace(/,/g, "") : clean.replace(",", ".");
  }
  const parsed = Number(clean);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function money(value: string) {
  const match = value.match(/([0-9][0-9\s,.']{1,})\s*(\$|₾|USD|GEL)\b?/i)
    || value.match(/(\$|₾|USD|GEL)\s*([0-9][0-9\s,.']{1,})/i);
  if (!match) return null;
  const amountText = /[0-9]/.test(match[1]) ? match[1] : match[2];
  const marker = /[0-9]/.test(match[1]) ? match[2] : match[1];
  const price = priceNumber(amountText);
  if (!price) return null;
  return { price, currency: /₾|GEL/i.test(marker) ? "GEL" as const : "USD" as const };
}

function slugTitle(value: string) {
  return decodeURIComponent(value || "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.toUpperCase() === part && part.length <= 4 ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function makeModel(cardText: string, detailUrl: string) {
  const url = new URL(detailUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  const autoIndex = parts.indexOf("auto");
  const pathMake = autoIndex >= 0 ? slugTitle(parts[autoIndex + 1] || "") : "";
  const pathModel = autoIndex >= 0 ? slugTitle(parts[autoIndex + 2] || "") : "";
  const lower = cardText.toLocaleLowerCase("en-US");
  const matched = KNOWN_MAKES.find((make) => lower.includes(make.toLocaleLowerCase("en-US")));
  const make = matched || pathMake;
  const escaped = make.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const modelMatch = make ? cardText.match(new RegExp(`${escaped}\\s*,\\s*([^|]{1,80}?)(?=\\s+(?:Sale|Customs|Before Customs|19\\d{2}|20\\d{2}))`, "i")) : null;
  const model = String(modelMatch?.[1] || pathModel).replace(/\s+/g, " ").trim();
  return { make, model };
}

function collectImages(markup: string, baseUrl: string) {
  const candidates: string[] = [];
  for (const match of markup.matchAll(/<(?:img|source|meta)[^>]+(?:data-original|data-lazy-src|data-src|src|content)\s*=\s*["']([^"']+)["']/gi)) candidates.push(match[1]);
  for (const match of markup.matchAll(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi)) {
    match[1].split(",").forEach((item) => candidates.push(item.trim().split(/\s+/)[0]));
  }
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+/gi)) candidates.push(match[0].replace(/\\\//g, "/"));
  return [...new Set(candidates
    .map((item) => absoluteUrl(item, baseUrl))
    .filter((url) => /^https?:/i.test(url) && !BAD_IMAGE_RE.test(url) && /auto\.ge|cloudfront|amazonaws|imgix|imagekit/i.test(url)))];
}

function parseList(markup: string, pageUrl: string) {
  const anchors = [...markup.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: absoluteUrl(match[1], pageUrl), inner: match[2], index: match.index || 0 }))
    .filter((row) => {
      try { return DETAIL_RE.test(new URL(row.href).pathname); } catch { return false; }
    });
  const rows = new Map<string, AutoGeorgiaRow>();
  anchors.forEach((anchor, index) => {
    if (rows.has(anchor.href)) return;
    const previous = index > 0 ? anchors[index - 1].index : Math.max(0, anchor.index - 3_000);
    const next = index + 1 < anchors.length ? anchors[index + 1].index : Math.min(markup.length, anchor.index + 18_000);
    const card = markup.slice(Math.max(previous, anchor.index - 7_000), Math.min(next + 4_000, anchor.index + 22_000));
    const plain = plainText(card);
    const parsedMoney = money(plain);
    const year = Number(plain.match(/\b(?:19|20)\d{2}\b/)?.[0]);
    const identity = makeModel(plainText(anchor.inner).length > 3 ? `${plainText(anchor.inner)} ${plain}` : plain, anchor.href);
    if (!parsedMoney || !year || !identity.make || !identity.model) return;
    const miles = integer(plain.match(/([0-9][0-9\s,.']+)\s*miles\b/i)?.[1]);
    const km = integer(plain.match(/([0-9][0-9\s,.']+)\s*km\b/i)?.[1]);
    const id = anchor.href.match(/-(\d+)\.html$/i)?.[1] || stableOfferId("auto_georgia_open", anchor.href);
    rows.set(anchor.href, {
      id,
      detailUrl: anchor.href,
      title: `${identity.make} ${identity.model}`,
      make: identity.make,
      model: identity.model,
      year,
      mileageKm: km || (miles ? Math.round(miles * 1.609344) : undefined),
      price: parsedMoney.price,
      currency: parsedMoney.currency,
      images: collectImages(card, pageUrl),
      location: plain.match(/\b(Tbilisi|Qutaisi|Kutaisi|Batumi|Poti|Rustavi|Telavi|Gori|Senaki|Zugdidi)\b/i)?.[1] || "Georgia",
    });
  });
  return [...rows.values()];
}

async function request(url: string, referer = "https://www.auto.ge/") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 20_000));
  try {
    const response = await fetch(url, { headers: { ...HEADERS, referer }, redirect: "follow", signal: controller.signal });
    const markup = await response.text();
    if (!response.ok) throw new Error(`auto_georgia_http_${response.status}`);
    if (/captcha|cloudflare|access denied|request blocked|verify you are human|forbidden/i.test(markup.slice(0, 3_000))) throw new Error(`auto_georgia_blocked_${response.status}`);
    return { response, markup };
  } finally { clearTimeout(timer); }
}

class AutoGeorgiaAdapter implements CatalogSourceAdapter {
  sourceId = "auto_georgia_open";
  market = "georgia" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const url = page <= 1 ? "https://www.auto.ge/en/auto/index.html" : `https://www.auto.ge/en/auto/index${page}.html`;
    const { response, markup } = await request(url);
    const items = parseList(markup, response.url || url);
    if (!items.length) throw new Error(`auto_georgia_parsed_zero_${response.status}_${markup.length}`);
    return { items, nextCursor: String(page + 1), finished: false, count: items.length,
      health: { ok: true, message: `AUTO.GE parsed ${items.length}`, checkedAt: new Date().toISOString(), httpStatus: response.status } };
  }

  mapStatus(): OfferStatus { return "active"; }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as AutoGeorgiaRow;
    if (!row?.id || !row.make || !row.model || !row.year || !row.price || !row.detailUrl) return null;
    const now = new Date().toISOString();
    return normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, row.id), sourceId: this.sourceId, sourceOfferId: row.id,
      market: this.market, offerType: "fixed", status: "active", make: row.make, model: row.model,
      trim: row.title, year: row.year, mileageKm: row.mileageKm, engineCc: row.engineCc, powerHp: row.powerHp,
      fuel: row.fuel, transmission: row.transmission, drive: row.drive, bodyType: row.bodyType,
      sourcePrice: row.price, sourceCurrency: row.currency, priceMode: "fixed", images: [], totalRub: null,
      calculationStatus: "ready", firstSeenAt: now, updatedAt: now,
      operational: { sourceUrl: row.detailUrl, sourceVenueName: row.location || "AUTO.GE Georgia", raw: row },
    } as VehicleOffer) as VehicleOffer;
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const row = (offer.operational.raw || {}) as AutoGeorgiaRow;
    const limit = Math.min(30, Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 6)));
    let urls = [...(row.images || [])];
    if (row.detailUrl) {
      const detail = await request(row.detailUrl, row.detailUrl).catch(() => null);
      if (detail) {
        urls = [...urls, ...collectImages(detail.markup, detail.response.url || row.detailUrl)];
        const plain = plainText(detail.markup);
        const cc = integer(plain.match(/([0-9][0-9\s,.']{2,5})\s*(?:cc|cm3|cm³)/i)?.[1]);
        const liters = Number(plain.match(/\b([0-9]+(?:[.,][0-9]+)?)\s*(?:L|liter|litre)\b/i)?.[1]?.replace(",", ".") || 0);
        offer.engineCc ||= cc || (liters > 0 && liters <= 15 ? Math.round(liters * 1_000) : undefined);
        offer.powerHp ||= integer(plain.match(/\b([0-9]{2,4})\s*(?:HP|PS|hp|horsepower)\b/i)?.[1]);
      }
    }
    const saved: CatalogImage[] = [];
    for (const url of [...new Set(urls)].slice(0, limit * 4)) {
      const image = await cacheImageFromUrl(url, this.market, { headers: { ...HEADERS, referer: row.detailUrl || "https://www.auto.ge/" } }).catch(() => null);
      if (image && image.size > 8_000) saved.push(image);
      if (saved.length >= limit) break;
    }
    return saved;
  }

  async healthCheck() { return { ok: true, message: "AUTO.GE exact source", checkedAt: new Date().toISOString() }; }
}

export const autoGeorgiaExactSource: CatalogSourceAdapter = new AutoGeorgiaAdapter();

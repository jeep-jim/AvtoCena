import { cacheImageFromUrl, stableOfferId } from "./storage";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import type { CatalogFetchResult, CatalogImage, CatalogMarket, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7,ka;q=0.6",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
const BLOCK_RE = /captcha|cloudflare|access denied|request blocked|robot check|verify you are human|forbidden/i;
const BAD_IMAGE_RE = /logo|favicon|icon|sprite|banner|placeholder|avatar|tracking|pixel|cookie|qrcode|qr-code|no[-_ ]?photo|no[-_ ]?image/i;
const NON_CAR_RE = /\b(?:motorcycle|scooter|forklift|excavator|tractor|crane|truck|bus|minibus|spare parts?)\b/i;
const KNOWN_MAKES = [
  "Mercedes-Benz", "Land Rover", "Range Rover", "Alfa Romeo", "Aston Martin", "Great Wall", "Li Auto",
  "Toyota", "Lexus", "Nissan", "Infiniti", "Honda", "Acura", "Mazda", "Mitsubishi", "Subaru", "Suzuki", "Daihatsu", "Isuzu",
  "Hyundai", "Genesis", "Kia", "KGM", "SsangYong", "BMW", "Audi", "Volkswagen", "Volvo", "Porsche", "Ford", "Chevrolet", "Cadillac",
  "Jeep", "Dodge", "Renault", "Peugeot", "Citroen", "Skoda", "SEAT", "MINI", "Fiat", "Opel", "Tesla", "BYD", "Geely", "Changan",
  "Chery", "GAC", "Haval", "Zeekr", "Nio", "XPeng", "Jetour", "Denza", "Hongqi", "Tank", "Voyah", "Aito", "Leapmotor", "Arcfox", "Neta",
].sort((a, b) => b.length - a.length);

type Config = {
  sourceId: string;
  market: CatalogMarket;
  label: string;
  baseUrl: string;
  fallbackCurrency: "USD" | "GEL" | "KGS";
  detailPattern: RegExp;
  listUrls: (page: number) => string[];
};

export type RegionalMassRow = {
  id: string; title: string; make: string; model: string; year: number;
  mileageKm?: number; engineCc?: number; powerHp?: number; fuel?: string;
  transmission?: string; drive?: string; bodyType?: string;
  price: number; currency: string; images: string[]; detailUrl: string; location?: string;
};

function decode(value: string) {
  return String(value || "")
    .replace(/&nbsp;|&#160;|\u00a0/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
function plain(value: string) {
  return decode(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
}
function absolute(value: string, base: string) {
  if (!value || /^(?:data:|javascript:|mailto:|tel:)/i.test(value)) return "";
  try { return new URL(decode(value).replace(/\\\//g, "/"), base).toString(); } catch { return ""; }
}
function pageQuery(base: string, page: number) {
  const url = new URL(base); url.searchParams.set("page", String(page)); return url.toString();
}
function integer(value: unknown) {
  const parsed = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
function parseAmount(raw: string) {
  let value = String(raw || "").trim().replace(/[\s\u00a0'’]/g, "");
  if (!value) return undefined;
  const comma = value.lastIndexOf(",");
  const dot = value.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    value = value.split(decimal === "," ? "." : ",").join("");
    if (decimal === ",") value = value.replace(",", ".");
  } else if (comma >= 0 || dot >= 0) {
    const separator = comma >= 0 ? "," : ".";
    const parts = value.split(separator);
    const tail = parts.at(-1) || "";
    value = tail.length === 3 ? parts.join("") : tail.length <= 2 ? `${parts.slice(0, -1).join("")}.${tail}` : parts.join("");
  }
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 300 && amount <= 2_000_000_000 ? Math.round(amount) : undefined;
}

const SPACE_GROUPED = "[0-9]{1,3}(?:[\\s\\u00a0'’][0-9]{3}(?![0-9])){1,3}";
const COMMA_GROUPED = "[0-9]{1,3}(?:,[0-9]{3})+(?:\\.[0-9]{1,2})?";
const DOT_GROUPED = "[0-9]{1,3}(?:\\.[0-9]{3})+(?:,[0-9]{1,2})?";
const PLAIN_NUMBER = "[0-9]{3,9}(?:[.,][0-9]{1,2})?";
const MONEY_TOKEN = `(?:${COMMA_GROUPED}|${DOT_GROUPED}|${SPACE_GROUPED}|${PLAIN_NUMBER})`;
function strictMoney(value: string, fallback: string) {
  const specs: Array<[string, string]> = [
    ["(?:USD|US\\$|\\$)", "USD"], ["(?:GEL|₾)", "GEL"], ["(?:KGS|сом|Som)", "KGS"],
  ];
  for (const [marker, currency] of specs) {
    const patterns = [
      new RegExp(`(${MONEY_TOKEN})\\s*${marker}`, "i"),
      new RegExp(`${marker}\\s*(${MONEY_TOKEN})`, "i"),
    ];
    for (const pattern of patterns) {
      const amount = parseAmount(value.match(pattern)?.[1] || "");
      if (amount) return { price: amount, currency };
    }
  }
  return { price: undefined, currency: fallback };
}
function imageUrls(markup: string, base: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/<(?:img|source|meta)[^>]+(?:data-original|data-lazy-src|data-src|src|content)\s*=\s*["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi)) match[1].split(",").forEach((item) => values.push(item.trim().split(/\s+/)[0]));
  const nakedImage = new RegExp("https?:\\\\?/\\\\?/[^\\\"'\\\\\\s<>]+?\\.(?:jpe?g|png|webp|avif)(?:\\?[^\\\"'\\\\\\s<>]*)?", "gi");
  for (const match of markup.matchAll(nakedImage)) values.push(match[0].replace(/\\\//g, "/"));
  return [...new Set(values.map((item) => absolute(item, base)).filter((url) => /^https?:/i.test(url) && !BAD_IMAGE_RE.test(url)))];
}
function titleFromCard(inner: string, card: string) {
  const candidates = [
    plain(inner), decode(card.match(/<img[^>]+alt\s*=\s*["']([^"']+)["']/i)?.[1] || ""),
    plain(card.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1] || ""),
    decode(card.match(/(?:aria-label|title)\s*=\s*["']([^"']+)["']/i)?.[1] || ""),
  ].map((item) => item.replace(/\s+/g, " ").trim());
  return candidates.find((item) => item.length >= 4 && item.length <= 180 && !/^(?:details?|view|image|save|compare)$/i.test(item)) || "";
}
function makeModel(title: string) {
  const cleaned = title.replace(/^(?:19|20)\d{2}\s+/, "").replace(/\b(?:19|20)\d{2}\b.*$/, "").trim();
  const lower = cleaned.toLocaleLowerCase("en-US");
  const make = KNOWN_MAKES.find((candidate) => lower === candidate.toLocaleLowerCase("en-US") || lower.startsWith(`${candidate.toLocaleLowerCase("en-US")} `));
  if (!make) return { make: "", model: "" };
  const model = cleaned.slice(make.length).replace(/^[\s\-–—|]+/, "").split(/\s+/).slice(0, 6).join(" ");
  return { make, model: model || make };
}

export function parseRegionalMassPage(markup: string, pageUrl: string, config: Pick<Config, "baseUrl" | "fallbackCurrency" | "detailPattern" | "sourceId">): RegionalMassRow[] {
  const anchors = [...markup.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: absolute(match[1], pageUrl), inner: match[2], index: match.index || 0 }))
    .filter((item) => { try { const url = new URL(item.href); return config.detailPattern.test(`${url.pathname}${url.search}`); } catch { return false; } });
  const rows: RegionalMassRow[] = [];
  const seen = new Set<string>();
  anchors.forEach((anchor, index) => {
    if (seen.has(anchor.href)) return;
    const previous = index > 0 ? anchors[index - 1].index : Math.max(0, anchor.index - 3_000);
    const next = index + 1 < anchors.length ? anchors[index + 1].index : markup.length;
    const card = markup.slice(Math.max(previous, anchor.index - 5_000), Math.min(next + 3_000, anchor.index + 16_000));
    const cardText = plain(card);
    const title = titleFromCard(anchor.inner, card);
    const identity = makeModel(title);
    const year = Number(`${title} ${cardText}`.match(/\b(?:19|20)\d{2}\b/)?.[0] || 0);
    const money = strictMoney(cardText, config.fallbackCurrency);
    if (!identity.make || !identity.model || !year || !money.price || NON_CAR_RE.test(`${title} ${cardText.slice(0, 500)}`)) return;
    const liters = cardText.match(/\b([0-9]+(?:[.,][0-9]+)?)\s*(?:L|л)\b/i);
    const cc = cardText.match(/\b([0-9][0-9\s,.']{2,5})\s*(?:cc|cm3|cm³|см3|см³)\b/i);
    const hp = cardText.match(/\b([0-9]{2,4})\s*(?:HP|PS|л\.с\.)\b/i);
    const mileage = cardText.match(/([0-9]{1,3}(?:[\s,.'][0-9]{3})+|[0-9]{3,8})\s*(?:km|км)/i);
    const id = anchor.href.match(/(?:-|\/)([a-z0-9]{8,})(?:\.[a-z]+|[/?#]|$)/i)?.[1] || stableOfferId(config.sourceId, anchor.href);
    seen.add(anchor.href);
    rows.push({
      id, title, make: identity.make, model: identity.model, year,
      mileageKm: integer(mileage?.[1]), engineCc: cc ? integer(cc[1]) : liters ? Math.round(Number(liters[1].replace(",", ".")) * 1_000) : undefined,
      powerHp: integer(hp?.[1]),
      fuel: cardText.match(/\b(Petrol|Gasoline|Diesel|Hybrid|Plug[- ]?in Hybrid|PHEV|Electric|EV|бензин|дизель|гибрид|электро)\b/i)?.[1],
      transmission: cardText.match(/\b(Automatic|Manual|CVT|DCT|AT|MT|автомат|механика|вариатор|робот)\b/i)?.[1],
      drive: cardText.match(/\b(AWD|4WD|4x4|FWD|RWD|полный|передний|задний)\b/i)?.[1],
      bodyType: cardText.match(/\b(SUV|Crossover|Sedan|Hatchback|Coupe|Wagon|Minivan|MPV|седан|кроссовер|универсал|хэтчбек|минивэн)\b/i)?.[1],
      price: money.price, currency: money.currency, images: imageUrls(card, pageUrl), detailUrl: anchor.href,
      location: cardText.match(/\b(Tbilisi|Batumi|Rustavi|Kutaisi|Bishkek|Osh|Georgia|Кыргызстан|Бишкек|Ош)\b/i)?.[1],
    });
  });
  return rows;
}

async function request(url: string, referer: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 20_000));
  try {
    const response = await fetch(url, { headers: { ...HEADERS, referer }, redirect: "follow", signal: controller.signal });
    const markup = await response.text();
    if ([401, 403, 429].includes(response.status) || BLOCK_RE.test(markup.slice(0, 3_000))) throw new Error(`regional_live_blocked_${response.status}`);
    if (!response.ok) throw new Error(`regional_live_http_${response.status}`);
    return { response, markup };
  } finally { clearTimeout(timer); }
}

class RegionalMassAdapter implements CatalogSourceAdapter {
  sourceId: string;
  market: CatalogMarket;
  accessMode = "public_html" as const;
  constructor(private config: Config) { this.sourceId = config.sourceId; this.market = config.market; }
  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    let status = 0; let bytes = 0;
    for (const url of this.config.listUrls(page)) {
      const result = await request(url, `${this.config.baseUrl}/`).catch(() => null);
      if (!result) continue;
      status = result.response.status; bytes = result.markup.length;
      const items = parseRegionalMassPage(result.markup, result.response.url || url, this.config);
      if (items.length) return { items, nextCursor: String(page + 1), finished: false, count: items.length,
        health: { ok: true, message: `${this.config.label}: parsed ${items.length}`, checkedAt: new Date().toISOString(), httpStatus: status } };
    }
    throw new Error(`${this.sourceId}_parsed_zero_status_${status}_bytes_${bytes}`);
  }
  mapStatus(): OfferStatus { return "active"; }
  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as RegionalMassRow;
    if (!row?.id || !row.make || !row.model || !row.year || !row.price || !row.detailUrl) return null;
    const now = new Date().toISOString();
    return normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, row.id), sourceId: this.sourceId, sourceOfferId: row.id, market: this.market,
      offerType: "fixed", status: "active", make: row.make, model: row.model, trim: row.title, year: row.year,
      mileageKm: row.mileageKm, engineCc: row.engineCc, powerHp: row.powerHp, fuel: row.fuel, transmission: row.transmission,
      drive: row.drive, bodyType: row.bodyType, sourcePrice: row.price, sourceCurrency: row.currency, priceMode: "fixed",
      images: [], totalRub: null, calculationStatus: "needs_data", firstSeenAt: now, updatedAt: now,
      operational: { sourceUrl: row.detailUrl, sourceVenueName: row.location || this.config.label,
        raw: { images: row.images, parsed: row, listingBoundImages: true } },
    } as VehicleOffer) as VehicleOffer;
  }
  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const raw = (offer.operational?.raw || {}) as { images?: string[]; parsed?: RegionalMassRow };
    let urls = [...new Set([...(raw.images || []), ...(raw.parsed?.images || [])])];
    const detailUrl = String(offer.operational?.sourceUrl || raw.parsed?.detailUrl || "");
    if (detailUrl && (urls.length < 8 || !offer.engineCc || !offer.fuel || !offer.powerHp)) {
      const detail = await request(detailUrl, detailUrl).catch(() => null);
      if (detail) {
        urls = [...new Set([...urls, ...imageUrls(detail.markup, detail.response.url || detailUrl)])];
        const text = plain(detail.markup);
        const liters = text.match(/\b([0-9]+(?:[.,][0-9]+)?)\s*(?:L|л)\b/i);
        offer.engineCc ||= liters ? Math.round(Number(liters[1].replace(",", ".")) * 1_000) : integer(text.match(/\b([0-9][0-9\s,.']{2,5})\s*(?:cc|cm3|cm³|см3|см³)\b/i)?.[1]);
        offer.powerHp ||= integer(text.match(/\b([0-9]{2,4})\s*(?:HP|PS|л\.с\.)\b/i)?.[1]);
        offer.mileageKm ||= integer(text.match(/([0-9]{1,3}(?:[\s,.'][0-9]{3})+|[0-9]{3,8})\s*(?:km|км)/i)?.[1]);
        offer.fuel ||= text.match(/\b(Petrol|Gasoline|Diesel|Hybrid|Plug[- ]?in Hybrid|PHEV|Electric|EV|бензин|дизель|гибрид|электро)\b/i)?.[1];
      }
    }
    const limit = Math.min(30, Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
    const saved: CatalogImage[] = [];
    for (const url of urls.slice(0, limit * 3)) {
      const image = await cacheImageFromUrl(url, this.market, { headers: { ...HEADERS, referer: detailUrl || `${this.config.baseUrl}/` } }).catch(() => null);
      if (image && image.size > 8_000 && !saved.some((item) => item.id === image.id)) saved.push(image);
      if (saved.length >= limit) break;
    }
    return saved;
  }
  async healthCheck() { return { ok: true, message: `${this.config.label}: live parser`, checkedAt: new Date().toISOString() }; }
}

const configs: Config[] = [
  {
    sourceId: "auto_georgia_open", market: "georgia", label: "AUTO.GE live homepage", baseUrl: "https://www.auto.ge", fallbackCurrency: "USD",
    detailPattern: /\/(?:en|ru|ka)\/auto\/[^?#]+-\d+\.html(?:[?#]|$)/i,
    listUrls: (page) => [page <= 1 ? "https://www.auto.ge/en/index.html" : `https://www.auto.ge/en/auto/index${page}.html`, pageQuery("https://www.auto.ge/en/index.html", page), pageQuery("https://www.auto.ge/en/auto/index.html", page)],
  },
  {
    sourceId: "mashina_kyrgyzstan_exact", market: "kyrgyzstan", label: "Mashina.kg current listings", baseUrl: "https://www.mashina.kg", fallbackCurrency: "USD",
    detailPattern: /\/(?:en\/)?details\/[^?#]+(?:[?#]|$)/i,
    listUrls: (page) => [pageQuery("https://www.mashina.kg/search/all/", page), pageQuery("https://www.mashina.kg/en/search/all/", page), pageQuery("https://m.mashina.kg/search/all/", page)],
  },
  {
    sourceId: "turbo_kyrgyzstan_open", market: "kyrgyzstan", label: "Turbo.kg current listings", baseUrl: "https://turbo.kg", fallbackCurrency: "USD",
    detailPattern: /\/cars\/[A-Za-z0-9_-]+(?:[/?#]|$)/i, listUrls: (page) => [pageQuery("https://turbo.kg/", page)],
  },
];

export const regionalLiveOverrides: CatalogSourceAdapter[] = configs.map((config) => new RegionalMassAdapter(config));

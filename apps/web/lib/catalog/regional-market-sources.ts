import { cacheImageFromUrl, stableOfferId } from "./storage";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import type { CatalogFetchResult, CatalogImage, CatalogMarket, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ru;q=0.8,ka;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
const BLOCK_RE = /captcha|cloudflare|access denied|request blocked|robot check|verify you are human|forbidden/i;
const BAD_IMAGE_RE = /logo|icon|avatar|qrcode|qr-code|placeholder|banner|sprite|tracking|pixel|favicon|appstore|googleplay|no[-_ ]?(?:photo|image)/i;
const KNOWN_MAKES = [
  "Mercedes-Benz", "Mercedes Benz", "Land Rover", "Range Rover", "Rolls-Royce", "Alfa Romeo", "Aston Martin", "Great Wall", "Li Auto",
  "Toyota", "Lexus", "Nissan", "Infiniti", "Honda", "Acura", "Mazda", "Mitsubishi", "Subaru", "Suzuki", "Daihatsu", "Isuzu",
  "Hyundai", "Genesis", "Kia", "KGM", "SsangYong", "BMW", "Audi", "Volkswagen", "Volvo", "Porsche", "Ford", "Chevrolet", "Cadillac",
  "Jeep", "Dodge", "Renault", "Peugeot", "Citroen", "Skoda", "SEAT", "MINI", "Fiat", "Opel", "Tesla", "BYD", "Geely", "Changan",
  "Chery", "GAC", "Haval", "Zeekr", "Nio", "XPeng", "Jetour", "Denza", "Hongqi", "Tank", "Voyah", "Aito", "Leapmotor", "Arcfox", "Neta",
].sort((left, right) => right.length - left.length);

type RegionalRow = {
  id: string;
  detailUrl: string;
  title: string;
  make: string;
  model: string;
  year: number;
  productionDate?: string;
  mileageKm?: number;
  engineCc?: number;
  powerHp?: number;
  fuel?: string;
  transmission?: string;
  drive?: string;
  bodyType?: string;
  color?: string;
  location?: string;
  price?: number;
  currency?: string;
  images: string[];
  rawText: string;
};

function nowIso() { return new Date().toISOString(); }
function text(value: unknown) { return value == null ? "" : String(value).replace(/\s+/g, " ").trim(); }
function htmlDecode(value: string) {
  return value
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
  return htmlDecode(markup)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function safeRawText(value: string) {
  return value
    .replace(/[+]?\d[\d\s().-]{8,}\d/g, " ")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 30_000)
    .trim();
}
function absoluteUrl(value: string, baseUrl: string) {
  if (!value || /^(?:data:|javascript:|mailto:|tel:)/i.test(value)) return "";
  try { return new URL(value.replace(/\\\//g, "/").replace(/&amp;/gi, "&"), baseUrl).toString(); } catch { return ""; }
}
function numberValue(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(/,/g, ".").replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
function integer(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
function labelValue(plain: string, labels: string[], stops: string[]) {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const labelPattern = labels.map(escape).join("|");
  const stopPattern = stops.map(escape).join("|");
  const match = plain.match(new RegExp(`(?:${labelPattern})\\s*[:：|]?\\s*(.{1,160}?)(?=\\s+(?:${stopPattern})\\s*[:：|]?|$)`, "i"));
  return text(match?.[1]);
}
function pageTitle(markup: string) {
  return text(
    plainText(markup.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "")
    || markup.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]
    || markup.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],
  );
}
function deriveMakeModel(rawTitle: string, explicitMake?: string, explicitModel?: string) {
  const explicit = { make: text(explicitMake), model: text(explicitModel) };
  if (explicit.make && explicit.model) return explicit;
  const title = text(rawTitle)
    .replace(/^(?:for sale|sale|продажа|купить|იყიდება)\s+/i, "")
    .replace(/\b(?:19|20)\d{2}\b.*$/i, "")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:l|л)\b.*$/i, "")
    .trim();
  const lower = title.toLocaleLowerCase("en-US");
  const matched = KNOWN_MAKES.find((make) => lower === make.toLocaleLowerCase("en-US") || lower.startsWith(`${make.toLocaleLowerCase("en-US")} `));
  if (matched) {
    const make = matched === "Mercedes Benz" ? "Mercedes-Benz" : matched;
    const rest = title.slice(matched.length).replace(/^[\s\-–—|]+/, "").trim();
    return { make, model: rest.split(/\s+/).slice(0, 6).join(" ") || make };
  }
  const parts = title.split(/\s+/).filter(Boolean);
  return { make: explicit.make || parts[0] || "", model: explicit.model || parts.slice(1, 7).join(" ") || parts[0] || "" };
}
function engineCcFrom(value: string) {
  const cc = value.match(/\b([3-9]\d{2}|[1-9]\d{3}|10\s?000)\s*(?:cc|cm3|cm³|см3|см³)\b/i);
  if (cc) return integer(cc[1]);
  const liters = value.match(/\b([0-9]+(?:[.,][0-9]+)?)\s*(?:l|л|litre|liter)\b/i);
  const parsed = liters ? Number(liters[1].replace(",", ".")) : undefined;
  return parsed && parsed > 0 && parsed <= 15 ? Math.round(parsed * 1_000) : undefined;
}
function productionDateFrom(value: string) {
  const yearMonth = value.match(/\b((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])\b/);
  if (yearMonth) return `${yearMonth[1]}-${String(Number(yearMonth[2])).padStart(2, "0")}`;
  const monthYear = value.match(/\b(0?[1-9]|1[0-2])[-/.]((?:19|20)\d{2})\b/);
  return monthYear ? `${monthYear[2]}-${String(Number(monthYear[1])).padStart(2, "0")}` : undefined;
}
function money(value: string, preferred: "USD" | "GEL" | "KGS") {
  const patterns: Array<[RegExp, string]> = preferred === "GEL"
    ? [
      [/(?:USD|US\$|\$)\s*([0-9][0-9\s,.']{2,})|([0-9][0-9\s,.']{2,})\s*(?:USD|US\$|\$)/i, "USD"],
      [/(?:GEL|₾)\s*([0-9][0-9\s,.']{2,})|([0-9][0-9\s,.']{2,})\s*(?:GEL|₾)/i, "GEL"],
    ]
    : [
      [/(?:USD|US\$|\$)\s*([0-9][0-9\s,.']{2,})|([0-9][0-9\s,.']{2,})\s*(?:USD|US\$|\$)/i, "USD"],
      [/(?:KGS|сом|Som)\s*([0-9][0-9\s,.']{2,})|([0-9][0-9\s,.']{2,})\s*(?:KGS|сом|Som)/i, "KGS"],
    ];
  for (const [pattern, currency] of patterns) {
    const match = value.match(pattern);
    const amount = integer(match?.[1] || match?.[2]);
    if (amount) return { price: amount, currency };
  }
  return { price: undefined, currency: undefined };
}
function collectImages(markup: string, baseUrl: string) {
  const candidates: string[] = [];
  for (const match of markup.matchAll(/<(?:img|source)[^>]+(?:data-original|data-lazy-src|data-src|src|content)\s*=\s*["']([^"']+)["']/gi)) candidates.push(match[1]);
  for (const match of markup.matchAll(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi)) {
    match[1].split(",").forEach((item) => candidates.push(item.trim().split(/\s+/)[0]));
  }
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) candidates.push(match[0].replace(/\\\//g, "/"));
  return [...new Set(candidates
    .map((item) => absoluteUrl(item, baseUrl))
    .filter((url) => /^https?:/i.test(url) && /\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(url) && !BAD_IMAGE_RE.test(url)))];
}
function collectDetailLinks(markup: string, baseUrl: string, pattern: RegExp) {
  const candidates: string[] = [];
  for (const match of markup.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) candidates.push(match[1]);
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+/gi)) candidates.push(match[0].replace(/\\\//g, "/"));
  return [...new Set(candidates.map((item) => absoluteUrl(item, baseUrl)).filter((url) => pattern.test(url)))];
}
async function fetchHtml(url: string, referer: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 25_000));
  try {
    const response = await fetch(url, { headers: { ...HEADERS, referer }, signal: controller.signal, redirect: "follow" });
    const markup = await response.text();
    if ([401, 403, 429].includes(response.status) || BLOCK_RE.test(markup.slice(0, 1_500))) {
      const error = new Error(`regional_source_blocked_${response.status}`) as Error & { blocked?: boolean; status?: number };
      error.blocked = true;
      error.status = response.status;
      throw error;
    }
    if (!response.ok) throw new Error(`regional_source_http_${response.status}`);
    return { response, markup };
  } finally {
    clearTimeout(timeout);
  }
}

function parseMyAuto(markup: string, detailUrl: string, id: string): RegionalRow | null {
  const plain = plainText(markup);
  const stops = ["Year", "Engine Volume", "Mileage", "Manufacturer", "Model", "Color", "Fuel type", "Gear box type", "Drive wheels", "Price", "Before customs", "Customs cleared", "Tel"];
  const title = pageTitle(markup) || `MyAuto ${id}`;
  const makeModel = deriveMakeModel(
    title,
    labelValue(plain, ["Manufacturer"], stops),
    labelValue(plain, ["Model"], stops),
  );
  const year = Number(labelValue(plain, ["Year"], stops).match(/(?:19|20)\d{2}/)?.[0] || title.match(/(?:19|20)\d{2}/)?.[0]);
  const engineRaw = labelValue(plain, ["Engine Volume"], stops) || plain;
  const parsedMoney = money(plain, "GEL");
  if (!makeModel.make || !makeModel.model || !year) return null;
  return normalizeVehicleOfferSpecs({
    id,
    detailUrl,
    title,
    make: makeModel.make,
    model: makeModel.model,
    year,
    productionDate: productionDateFrom(plain),
    mileageKm: integer(labelValue(plain, ["Mileage"], stops)),
    engineCc: engineCcFrom(engineRaw) || integer(engineRaw),
    fuel: labelValue(plain, ["Fuel type", "Fuel"], stops),
    transmission: labelValue(plain, ["Gear box type", "Transmission"], stops),
    drive: labelValue(plain, ["Drive wheels", "Drive"], stops),
    color: labelValue(plain, ["Color"], stops),
    price: parsedMoney.price,
    currency: parsedMoney.currency,
    images: collectImages(markup, detailUrl),
    rawText: safeRawText(plain),
  }) as RegionalRow;
}

function parseMashina(markup: string, detailUrl: string, id: string): RegionalRow | null {
  const plain = plainText(markup);
  const stops = ["Год выпуска", "Year", "Пробег", "Mileage", "Кузов", "Body", "Цвет", "Color", "Двигатель", "Engine", "Коробка", "Transmission", "Привод", "Drive", "Руль", "Состояние", "Таможня", "Наличие", "Регион, город", "Region, city", "Учёт", "Комментарий продавца", "Seller comment"];
  const title = pageTitle(markup);
  const makeModel = deriveMakeModel(title);
  const year = Number(labelValue(plain, ["Год выпуска", "Year of manufacture", "Year"], stops).match(/(?:19|20)\d{2}/)?.[0] || title.match(/(?:19|20)\d{2}/)?.[0]);
  const engineRaw = labelValue(plain, ["Двигатель", "Engine"], stops);
  const fuel = engineRaw.split("/").slice(1).join("/").trim();
  const parsedMoney = money(plain, "KGS");
  if (!makeModel.make || !makeModel.model || !year) return null;
  return normalizeVehicleOfferSpecs({
    id,
    detailUrl,
    title,
    make: makeModel.make,
    model: makeModel.model,
    year,
    productionDate: productionDateFrom(plain),
    mileageKm: integer(labelValue(plain, ["Пробег", "Mileage"], stops)),
    engineCc: engineCcFrom(engineRaw),
    fuel,
    transmission: labelValue(plain, ["Коробка", "Transmission", "Gearbox"], stops),
    drive: labelValue(plain, ["Привод", "Drive"], stops),
    bodyType: labelValue(plain, ["Кузов", "Body"], stops),
    color: labelValue(plain, ["Цвет", "Color"], stops),
    location: labelValue(plain, ["Регион, город", "Region, city"], stops),
    price: parsedMoney.price,
    currency: parsedMoney.currency,
    images: collectImages(markup, detailUrl),
    rawText: safeRawText(plain),
  }) as RegionalRow;
}

abstract class RegionalHtmlAdapter implements CatalogSourceAdapter {
  abstract sourceId: string;
  abstract market: CatalogMarket;
  accessMode = "public_html" as const;
  abstract listUrls(page: number): string[];
  abstract detailPattern: RegExp;
  abstract parse(markup: string, detailUrl: string, id: string): RegionalRow | null;
  abstract idFromUrl(url: string): string;
  protected pageSize() { return Math.max(1, Number(process.env[`CATALOG_${this.sourceId.toUpperCase()}_PAGE_SIZE`] || 16)); }

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    let finalStatus = 0;
    let detailLinks: string[] = [];
    for (const listUrl of this.listUrls(page)) {
      const { response, markup } = await fetchHtml(listUrl, new URL(listUrl).origin);
      finalStatus = response.status;
      detailLinks = collectDetailLinks(markup, listUrl, this.detailPattern);
      if (detailLinks.length) break;
    }
    const rows: RegionalRow[] = [];
    for (const detailUrl of detailLinks.slice(0, this.pageSize())) {
      const id = this.idFromUrl(detailUrl);
      if (!id) continue;
      try {
        const { markup } = await fetchHtml(detailUrl, this.listUrls(page)[0]);
        const row = this.parse(markup, detailUrl, id);
        if (row) rows.push(row);
      } catch {
        // Continue with the next public listing when a single ad is removed or temporarily unavailable.
      }
    }
    return {
      items: rows,
      nextCursor: detailLinks.length ? String(page + 1) : null,
      finished: !detailLinks.length,
      count: rows.length,
      health: { ok: true, message: `parsed ${rows.length} regional listings`, checkedAt: nowIso(), httpStatus: finalStatus },
    };
  }

  mapStatus(): OfferStatus { return "active"; }

  normalizeOffer(raw: RegionalRow): VehicleOffer | null {
    if (!raw?.id || !raw.make || !raw.model || !raw.year) return null;
    const timestamp = nowIso();
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
      productionDate: raw.productionDate,
      mileageKm: raw.mileageKm,
      engineCc: raw.engineCc,
      powerHp: raw.powerHp,
      fuel: raw.fuel,
      transmission: raw.transmission,
      drive: raw.drive,
      bodyType: raw.bodyType,
      color: raw.color,
      sourcePrice: raw.price || null,
      sourceCurrency: raw.price ? raw.currency || null : null,
      priceMode: raw.price ? "fixed" : "estimated",
      images: [],
      totalRub: null,
      calculationStatus: raw.price ? "ready" : "needs_data",
      firstSeenAt: timestamp,
      updatedAt: timestamp,
      operational: {
        sourceUrl: raw.detailUrl,
        sourceVenueName: raw.location || (this.market === "georgia" ? "Georgia" : "Kyrgyzstan"),
        raw: { images: raw.images, plain: raw.rawText, parsed: raw },
      },
    } as VehicleOffer) as VehicleOffer;
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const raw = offer.operational.raw as { images?: string[]; parsed?: RegionalRow } | undefined;
    let urls = [...(raw?.images || [])];
    const detailUrl = offer.operational.sourceUrl || raw?.parsed?.detailUrl || "";
    if (detailUrl && urls.length < 4) {
      try {
        const { markup } = await fetchHtml(detailUrl, new URL(detailUrl).origin);
        urls = [...urls, ...collectImages(markup, detailUrl)];
      } catch {
        // Keep images already extracted from the list/detail response.
      }
    }
    const limit = Math.min(1000, Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 1000)));
    const saved: CatalogImage[] = [];
    for (const url of [...new Set(urls)].slice(0, limit)) {
      const image = await cacheImageFromUrl(url, this.market, { headers: { ...HEADERS, referer: detailUrl } }).catch(() => null);
      if (image && image.size > 8_000) saved.push(image);
      if (saved.length >= limit) break;
    }
    return saved;
  }

  async healthCheck() { return { ok: true, message: `${this.sourceId}: checked during import`, checkedAt: nowIso() }; }
}

export class MyAutoGeorgiaAdapter extends RegionalHtmlAdapter {
  sourceId = "myauto_georgia_exact";
  market: CatalogMarket = "georgia";
  detailPattern = /myauto\.ge\/en\/(?:pr\/\d+|prints\/2\/\d+)/i;
  listUrls(page: number) {
    return [
      `https://www.myauto.ge/en/s/?page=${page}`,
      `https://www.myauto.ge/en/main?page=${page}`,
    ];
  }
  idFromUrl(url: string) { return url.match(/\/(?:pr|prints\/2)\/(\d+)/i)?.[1] || ""; }
  parse(markup: string, detailUrl: string, id: string) { return parseMyAuto(markup, detailUrl, id); }
}

export class MashinaKyrgyzstanAdapter extends RegionalHtmlAdapter {
  sourceId = "mashina_kyrgyzstan_exact";
  market: CatalogMarket = "kyrgyzstan";
  detailPattern = /mashina\.kg\/(?:en\/)?details\/[^?#]+/i;
  listUrls(page: number) {
    return [
      `https://www.mashina.kg/en/search/all/?page=${page}`,
      `https://m.mashina.kg/en/search/?page=${page}`,
    ];
  }
  idFromUrl(url: string) { return url.match(/-([a-f0-9]{18,})\/?(?:[?#]|$)/i)?.[1] || url.match(/\/details\/([^/?#]+)/i)?.[1] || ""; }
  parse(markup: string, detailUrl: string, id: string) { return parseMashina(markup, detailUrl, id); }
}

export const regionalMarketSources: CatalogSourceAdapter[] = [
  new MyAutoGeorgiaAdapter(),
  new MashinaKyrgyzstanAdapter(),
];

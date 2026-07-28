import crypto from "node:crypto";
import { getJsonStorage } from "../data";
import { autoGeorgiaExactSource } from "./auto-georgia-source";
import { publicImageUrl } from "./storage";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, VehicleOffer } from "./types";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ka;q=0.8,ru;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
const BAD_IMAGE_RE = /logo|icon|avatar|qrcode|qr-code|placeholder|banner|sprite|tracking|pixel|favicon|appstore|googleplay|no[-_ ]?(?:photo|image)/i;
const AUTO_GE_IMAGE_HOST_RE = /(?:^|\.)(?:auto\.ge|digitaloceanspaces\.com)$/i;
const RAV4_DETAIL_RE = /\/en\/auto\/toyota\/rav4\/[^/?#]+-\d+\.html$/i;

type DetailedRav4Row = {
  id: string;
  detailUrl: string;
  title: string;
  make: "Toyota";
  model: "RAV4";
  year: number;
  mileageKm?: number;
  engineCc?: number;
  fuel?: string;
  transmission?: string;
  drive?: string;
  bodyType?: string;
  location?: string;
  price: number;
  currency: "USD" | "GEL";
  images: string[];
};

function plain(markup: string) {
  return String(markup || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value: string, baseUrl: string) {
  if (!value || /^(?:data:|javascript:|mailto:|tel:)/i.test(value)) return "";
  try { return new URL(value.replace(/\\\//g, "/").replace(/&amp;/gi, "&"), baseUrl).toString(); } catch { return ""; }
}

function safeAutoGeImageUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !AUTO_GE_IMAGE_HOST_RE.test(url.hostname) || BAD_IMAGE_RE.test(url.toString())) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function collectImages(markup: string, baseUrl: string) {
  const candidates: string[] = [];
  for (const match of markup.matchAll(/<(?:img|source|meta)[^>]+(?:data-original|data-lazy-src|data-src|src|content)\s*=\s*["']([^"']+)["']/gi)) candidates.push(match[1]);
  for (const match of markup.matchAll(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi)) {
    match[1].split(",").forEach((item) => candidates.push(item.trim().split(/\s+/)[0]));
  }
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+/gi)) candidates.push(match[0].replace(/\\\//g, "/"));
  return [...new Set(candidates.map((item) => safeAutoGeImageUrl(absoluteUrl(item, baseUrl))).filter(Boolean))];
}

function positiveInteger(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parsePrice(text: string) {
  const patterns: Array<[RegExp, "USD" | "GEL"]> = [
    [/\$\s*([0-9][0-9\s,.']{2,})/i, "USD"],
    [/([0-9][0-9\s,.']{2,})\s*(?:USD|\$)/i, "USD"],
    [/₾\s*([0-9][0-9\s,.']{2,})/i, "GEL"],
    [/([0-9][0-9\s,.']{2,})\s*(?:GEL|₾)/i, "GEL"],
  ];
  for (const [pattern, currency] of patterns) {
    const raw = text.match(pattern)?.[1];
    if (!raw) continue;
    const amount = Number(raw.replace(/[\s,.']/g, ""));
    if (Number.isFinite(amount) && amount >= 500) return { price: amount, currency };
  }
  return null;
}

function listingPriority(raw: unknown) {
  const row = raw as any;
  const text = `${row?.make || ""} ${row?.model || ""} ${row?.title || ""}`;
  const imageCount = Array.isArray(row?.images) ? row.images.length : 0;
  if (/Toyota\s+RAV\s*4/i.test(text)) return 100 + Math.min(40, imageCount * 2);
  if (/Toyota\s+(?:Camry|Corolla|Alphard)/i.test(text)) return 80 + Math.min(20, imageCount);
  if (/Nissan\s+(?:Rogue|X-?Trail|Qashqai)/i.test(text)) return 60 + Math.min(20, imageCount);
  if (/Honda\s+(?:CR-?V|HR-?V|Fit|Vezel)/i.test(text)) return 50 + Math.min(20, imageCount);
  return imageCount;
}

async function requestText(url: string, referer: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 18_000));
  try {
    const response = await fetch(url, { headers: { ...HEADERS, referer }, redirect: "follow", signal: controller.signal });
    if (!response.ok) return null;
    return { response, markup: await response.text() };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function rav4DetailUrls(markup: string, baseUrl: string) {
  const urls: string[] = [];
  for (const match of markup.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
    const url = absoluteUrl(match[1], baseUrl);
    try { if (RAV4_DETAIL_RE.test(new URL(url).pathname)) urls.push(url); } catch { /* ignored */ }
  }
  return [...new Set(urls)].sort((left, right) => {
    const leftId = Number(left.match(/-(\d+)\.html$/i)?.[1] || 0);
    const rightId = Number(right.match(/-(\d+)\.html$/i)?.[1] || 0);
    return rightId - leftId;
  });
}

async function rav4DetailRow(url: string): Promise<DetailedRav4Row | null> {
  const result = await requestText(url, "https://www.auto.ge/en/auto/toyota/rav4/");
  if (!result) return null;
  const text = plain(result.markup);
  const money = parsePrice(text);
  const year = Number(text.match(/\b(?:19|20)\d{2}\b/)?.[0] || 0);
  const id = url.match(/-(\d+)\.html$/i)?.[1] || "";
  if (!money || !year || !id) return null;
  const miles = positiveInteger(text.match(/([0-9][0-9\s,.']+)\s*miles\b/i)?.[1]);
  const km = positiveInteger(text.match(/([0-9][0-9\s,.']+)\s*km\b/i)?.[1]);
  const labeledEngine = Number(text.match(/\bEngine\s+([0-9]+(?:[.,][0-9]+)?)(?=\s+Turbo\b)/i)?.[1]?.replace(",", ".") || 0);
  const fuel = text.match(/\bFuel\s+(Gas|Petrol|Diesel|Hybrid|Electric)\b/i)?.[1]?.toLowerCase();
  const transmission = text.match(/\bTransmission\s+(Automanual|Automatic|Manual|CVT)\b/i)?.[1]?.toLowerCase();
  const drive = text.match(/\bDrive Train\s+(All Wheel Drive|Four Wheel Drive|Front Wheel Drive|Rear Wheel Drive)\b/i)?.[1]?.toLowerCase();
  const body = text.match(/\bBody Style\s+([A-Za-z -]{2,30}?)(?=\s+Customs\b)/i)?.[1]?.trim().toLowerCase();
  return {
    id,
    detailUrl: url,
    title: "Toyota RAV4",
    make: "Toyota",
    model: "RAV4",
    year,
    mileageKm: km || (miles ? Math.round(miles * 1.609344) : undefined),
    engineCc: labeledEngine >= 0.6 && labeledEngine <= 8 ? Math.round(labeledEngine * 1_000) : undefined,
    fuel: fuel === "gas" ? "petrol" : fuel,
    transmission: transmission === "automanual" ? "automatic" : transmission,
    drive: drive ? (/all|four/.test(drive) ? "4wd" : /front/.test(drive) ? "fwd" : "rwd") : undefined,
    bodyType: body,
    location: text.match(/\b(Tbilisi|Qutaisi|Kutaisi|Batumi|Poti|Rustavi|Telavi|Gori|Senaki|Zugdidi)\b/i)?.[1] || "Georgia",
    price: money.price,
    currency: money.currency,
    images: collectImages(result.markup, result.response.url || url),
  };
}

async function fetchRav4Rows(cursor?: string | null) {
  const page = Math.max(1, Number(cursor || 1));
  const urls = [page, page + 1].map((current) => current <= 1
    ? "https://www.auto.ge/en/auto/toyota/rav4/"
    : `https://www.auto.ge/en/auto/toyota/rav4/index${current}.html`);
  const listings = await Promise.all(urls.map((url) => requestText(url, "https://www.auto.ge/en/auto/toyota/rav4/")));
  const details = [...new Set(listings.flatMap((result, index) => result ? rav4DetailUrls(result.markup, result.response.url || urls[index]) : []))].slice(0, 18);
  const rows: DetailedRav4Row[] = [];
  let cursorIndex = 0;
  await Promise.all(Array.from({ length: Math.min(6, details.length) }, async () => {
    while (true) {
      const index = cursorIndex++;
      if (index >= details.length) return;
      const row = await rav4DetailRow(details[index]);
      if (row) rows.push(row);
    }
  }));
  return rows.sort((left, right) => listingPriority(right) - listingPriority(left));
}

async function detailData(offer: VehicleOffer) {
  const url = String(offer.operational?.sourceUrl || "");
  if (!url) return [];
  const result = await requestText(url, url);
  if (!result) return [];
  const text = plain(result.markup);
  const labeledEngine = Number(text.match(/\bEngine\s+([0-9]+(?:[.,][0-9]+)?)(?=\s+Turbo\b)/i)?.[1]?.replace(",", ".") || 0);
  if (!offer.engineCc && labeledEngine >= 0.6 && labeledEngine <= 8) offer.engineCc = Math.round(labeledEngine * 1_000);
  const fuel = text.match(/\bFuel\s+(Gas|Petrol|Diesel|Hybrid|Electric)\b/i)?.[1]?.toLowerCase();
  if (!offer.fuel && fuel) offer.fuel = fuel === "gas" ? "petrol" : fuel;
  const transmission = text.match(/\bTransmission\s+(Automanual|Automatic|Manual|CVT)\b/i)?.[1]?.toLowerCase();
  if (!offer.transmission && transmission) offer.transmission = transmission === "automanual" ? "automatic" : transmission;
  const drive = text.match(/\bDrive Train\s+(All Wheel Drive|Four Wheel Drive|Front Wheel Drive|Rear Wheel Drive)\b/i)?.[1]?.toLowerCase();
  if (!offer.drive && drive) offer.drive = /all|four/.test(drive) ? "4wd" : /front/.test(drive) ? "fwd" : "rwd";
  const body = text.match(/\bBody Style\s+([A-Za-z -]{2,30}?)(?=\s+Customs\b)/i)?.[1]?.trim().toLowerCase();
  if (!offer.bodyType && body) offer.bodyType = body;
  return collectImages(result.markup, result.response.url || url);
}

async function cacheAutoGeImage(rawUrl: string, offer: VehicleOffer): Promise<CatalogImage | null> {
  const safeUrl = safeAutoGeImageUrl(rawUrl);
  if (!safeUrl) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_IMAGE_TIMEOUT_MS || 12_000));
  try {
    const response = await fetch(safeUrl, {
      headers: { ...HEADERS, accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8", referer: String(offer.operational?.sourceUrl || "https://www.auto.ge/") },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok || !safeAutoGeImageUrl(response.url || safeUrl)) return null;
    const mimeType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!/^image\/(?:jpeg|png|webp)$/.test(mimeType)) return null;
    const maximumBytes = Math.max(100_000, Number(process.env.CATALOG_IMAGE_MAX_BYTES || 12_000_000));
    const declaredBytes = Number(response.headers.get("content-length") || 0);
    if (declaredBytes > maximumBytes) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 8_000 || buffer.length > maximumBytes) return null;
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    const extension = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
    const id = checksum.slice(0, 32);
    const objectKey = `catalog/images/${offer.market}/${checksum}.${extension}`;
    const storage = getJsonStorage();
    if (!(await storage.binaryExists?.(objectKey))) await storage.putBinary?.(objectKey, buffer, mimeType, { ifNoneMatch: "*" });
    return { id, url: publicImageUrl(id, objectKey), objectKey, checksum, mimeType, size: buffer.length };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function cachePool(urls: string[], offer: VehicleOffer, limit: number) {
  const result: CatalogImage[] = [];
  let cursor = 0;
  const workers = Math.min(6, urls.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (result.length < limit) {
      const index = cursor++;
      if (index >= urls.length) return;
      const image = await cacheAutoGeImage(urls[index], offer);
      if (image && !result.some((row) => row.id === image.id)) result.push(image);
    }
  }));
  return result.slice(0, limit);
}

export const autoGeorgiaEnrichedSource: CatalogSourceAdapter = {
  sourceId: autoGeorgiaExactSource.sourceId,
  market: autoGeorgiaExactSource.market,
  accessMode: autoGeorgiaExactSource.accessMode,
  async fetchPage(cursor): Promise<CatalogFetchResult> {
    const [result, rav4Rows] = await Promise.all([
      autoGeorgiaExactSource.fetchPage(cursor),
      fetchRav4Rows(cursor),
    ]);
    const merged = new Map<string, any>();
    for (const row of [...rav4Rows, ...(result.items || [])]) {
      const id = String((row as any)?.detailUrl || (row as any)?.id || "");
      if (!id) continue;
      const previous = merged.get(id);
      if (!previous || listingPriority(row) > listingPriority(previous)) merged.set(id, row);
    }
    const items = [...merged.values()].sort((left, right) => listingPriority(right) - listingPriority(left));
    return { ...result, items, count: items.length };
  },
  normalizeOffer: (raw) => autoGeorgiaExactSource.normalizeOffer(raw),
  mapStatus: (raw) => autoGeorgiaExactSource.mapStatus(raw),
  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const row = (offer.operational?.raw || {}) as any;
    const limit = Math.min(30, Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 6)));
    const rawImages = Array.isArray(row.images) ? row.images.map(String).map(safeAutoGeImageUrl).filter(Boolean) : [];
    const detailImages = rawImages.length >= limit && offer.engineCc && offer.fuel ? [] : await detailData(offer);
    const urls = [...new Set([...rawImages, ...detailImages].map(String).map(safeAutoGeImageUrl).filter(Boolean))];
    return cachePool(urls.slice(0, limit * 5), offer, limit);
  },
  healthCheck: () => autoGeorgiaExactSource.healthCheck(),
};

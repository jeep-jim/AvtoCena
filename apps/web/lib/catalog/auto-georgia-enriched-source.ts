import { autoGeorgiaExactSource } from "./auto-georgia-source";
import { cacheImageFromUrl } from "./storage";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, VehicleOffer } from "./types";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ka;q=0.8,ru;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
const BAD_IMAGE_RE = /logo|icon|avatar|qrcode|qr-code|placeholder|banner|sprite|tracking|pixel|favicon|appstore|googleplay|no[-_ ]?(?:photo|image)/i;

function plain(markup: string) {
  return String(markup || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
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

function listingPriority(raw: unknown) {
  const row = raw as any;
  const text = `${row?.make || ""} ${row?.model || ""} ${row?.title || ""}`;
  if (/Toyota\s+RAV\s*4/i.test(text)) return 100;
  if (/Toyota\s+(?:Camry|Corolla|Alphard)/i.test(text)) return 80;
  if (/Nissan\s+(?:Rogue|X-?Trail|Qashqai)/i.test(text)) return 60;
  if (/Honda\s+(?:CR-?V|HR-?V|Fit|Vezel)/i.test(text)) return 50;
  return 0;
}

async function detailData(offer: VehicleOffer) {
  const url = String(offer.operational?.sourceUrl || "");
  if (!url) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 18_000));
  try {
    const response = await fetch(url, { headers: { ...HEADERS, referer: url }, redirect: "follow", signal: controller.signal });
    if (!response.ok) return [];
    const markup = await response.text();
    const text = plain(markup);
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
    return collectImages(markup, response.url || url);
  } catch {
    return [];
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
      const image = await cacheImageFromUrl(urls[index], offer.market, {
        headers: { ...HEADERS, referer: String(offer.operational?.sourceUrl || "https://www.auto.ge/") },
      }).catch(() => null);
      if (image && image.size > 8_000 && !result.some((row) => row.id === image.id)) result.push(image);
    }
  }));
  return result.slice(0, limit);
}

export const autoGeorgiaEnrichedSource: CatalogSourceAdapter = {
  sourceId: autoGeorgiaExactSource.sourceId,
  market: autoGeorgiaExactSource.market,
  accessMode: autoGeorgiaExactSource.accessMode,
  async fetchPage(cursor): Promise<CatalogFetchResult> {
    const result = await autoGeorgiaExactSource.fetchPage(cursor);
    return {
      ...result,
      items: [...(result.items || [])].sort((left, right) => listingPriority(right) - listingPriority(left)),
    };
  },
  normalizeOffer: (raw) => autoGeorgiaExactSource.normalizeOffer(raw),
  mapStatus: (raw) => autoGeorgiaExactSource.mapStatus(raw),
  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const row = (offer.operational?.raw || {}) as any;
    const limit = Math.min(30, Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 6)));
    const detailImages = await detailData(offer);
    const urls = [...new Set([...(Array.isArray(row.images) ? row.images : []), ...detailImages].map(String).filter(Boolean))];
    return cachePool(urls.slice(0, limit * 5), offer, limit);
  },
  healthCheck: () => autoGeorgiaExactSource.healthCheck(),
};

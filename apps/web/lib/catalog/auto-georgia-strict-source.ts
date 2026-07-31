import { autoGeorgiaExactSource } from "./auto-georgia-source";
import { cacheImageFromUrl } from "./storage";
import type { CatalogImage, CatalogSourceAdapter, VehicleOffer } from "./types";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ka;q=0.8,ru;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
const BAD_IMAGE_RE = /logo|icon|avatar|qrcode|qr-code|placeholder|banner|sprite|tracking|pixel|favicon|appstore|googleplay|no[-_ ]?(?:photo|image)/i;

function decodeHtml(value: string) {
  return String(value || "").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
function plainText(value: string) {
  return decodeHtml(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function compact(value: unknown) {
  return String(value || "").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}
function absoluteUrl(value: string, base: string) {
  if (!value || /^(?:data:|javascript:|mailto:|tel:)/i.test(value)) return "";
  try { return new URL(value.replace(/\\\//g, "/").replace(/&amp;/gi, "&"), base).toString(); } catch { return ""; }
}
function imageUrls(markup: string, base: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/<(?:img|source|meta)[^>]+(?:data-original|data-lazy-src|data-src|src|content)\s*=\s*["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi)) match[1].split(",").forEach((item) => values.push(item.trim().split(/\s+/)[0]));
  return [...new Set(values.map((value) => absoluteUrl(value, base)).filter((url) => /^https?:/i.test(url) && !BAD_IMAGE_RE.test(url)))];
}
function identityMatches(markup: string, offer: VehicleOffer) {
  const text = compact(plainText(markup).slice(0, 15_000));
  const make = compact(offer.make);
  const modelTokens = String(offer.model || "").split(/\s+/).map(compact).filter((token) => token.length >= 2).slice(0, 3);
  return Boolean(make && text.includes(make) && modelTokens.some((token) => text.includes(token)));
}
async function request(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 18_000));
  try {
    const response = await fetch(url, { headers: { ...HEADERS, referer: url }, redirect: "follow", signal: controller.signal });
    if (!response.ok) return null;
    return { response, markup: await response.text() };
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export const autoGeorgiaStrictSource: CatalogSourceAdapter = {
  sourceId: autoGeorgiaExactSource.sourceId,
  market: autoGeorgiaExactSource.market,
  accessMode: autoGeorgiaExactSource.accessMode,
  fetchPage: (cursor) => autoGeorgiaExactSource.fetchPage(cursor),
  normalizeOffer: (raw) => autoGeorgiaExactSource.normalizeOffer(raw),
  mapStatus: (raw) => autoGeorgiaExactSource.mapStatus(raw),
  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const row = (offer.operational?.raw || {}) as { images?: string[]; detailUrl?: string };
    const detailUrl = String(offer.operational?.sourceUrl || row.detailUrl || "");
    const limit = Math.min(30, Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
    let urls = [...new Set((row.images || []).map(String).filter(Boolean))];
    if (detailUrl && urls.length < limit) {
      const detail = await request(detailUrl);
      if (detail && identityMatches(detail.markup, offer)) urls = [...urls, ...imageUrls(detail.markup, detail.response.url || detailUrl)];
    }
    const saved: CatalogImage[] = [];
    for (const url of [...new Set(urls)].slice(0, limit * 4)) {
      const image = await cacheImageFromUrl(url, this.market, { headers: { ...HEADERS, referer: detailUrl || "https://www.auto.ge/en/auto/index.html" } }).catch(() => null);
      if (image && image.size > 8_000) saved.push(image);
      if (saved.length >= limit) break;
    }
    return saved;
  },
  healthCheck: () => autoGeorgiaExactSource.healthCheck(),
};

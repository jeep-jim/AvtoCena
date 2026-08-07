import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, SourceRunHealth, VehicleOffer } from "./types";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};
const BAD_IMAGE = /logo|icon|avatar|qrcode|qr-code|banner|sprite|tracking|pixel|favicon|appstore|googleplay|placeholder|default|dealer|seller|brand|wechat|weixin/i;

function clean(value: unknown) {
  return String(value ?? "")
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
function absolute(value: string, base: string) {
  try { return new URL(value.replace(/\\\//g, "/").replace(/&amp;/g, "&"), base).toString(); } catch { return ""; }
}
function cnyWan(value: unknown) {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10_000) : 0;
}
function wanKm(value: unknown) {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10_000) : undefined;
}
function remoteImage(url: string): CatalogImage {
  return { id: "", url, objectKey: "", checksum: "", size: 0, mimeType: /\.png(?:[?#]|$)/i.test(url) ? "image/png" : /\.webp(?:[?#]|$)/i.test(url) ? "image/webp" : "image/jpeg" };
}
function imageUrls(markup: string, base: string, hostPattern: RegExp) {
  const values: string[] = [];
  for (const match of markup.matchAll(/(?:src|data-src|data-original|data-lazy-src|content)\s*=\s*["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']/gi)) match[1].split(",").forEach((item) => values.push(item.trim().split(/\s+/)[0]));
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) values.push(match[0]);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const url = absolute(raw, base);
    if (!url || !hostPattern.test(url) || BAD_IMAGE.test(url)) continue;
    const key = url.replace(/[?#].*$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(url);
    if (result.length >= 30) break;
  }
  return result;
}
function splitMakeModel(title: string) {
  const normalized = clean(title).replace(/^(?:大额补贴|惠购818|新上架|抢购价)\s*/g, "");
  const beforeYear = normalized.split(/\s+(?=20\d{2}款)/)[0] || normalized;
  const parts = beforeYear.split(/\s+/).filter(Boolean);
  return { make: parts[0] || "中国汽车", model: parts.slice(1).join(" ") || parts[0] || "车型" };
}
async function getHtml(url: string, referer?: string) {
  const response = await fetch(url, { headers: { ...HEADERS, ...(referer ? { referer } : {}) }, redirect: "follow", signal: AbortSignal.timeout(Math.max(8_000, Number(process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS || 30_000))) });
  const html = await response.text();
  if (!response.ok) throw new Error(`china_exact_http_${response.status}:${url}`);
  return { response, html };
}

type ChinaRow = { id: string; detailUrl: string; title: string; year: number; mileageKm?: number; price: number; currency: "CNY"; listingText: string };

function parseCards(markup: string, pageUrl: string, linkRe: RegExp, idFromUrl: (url: string) => string): ChinaRow[] {
  const anchors = [...markup.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: absolute(match[1], pageUrl), inner: match[2], index: match.index || 0 }))
    .filter((row) => linkRe.test(row.href));
  const unique = new Map<string, { href: string; index: number; inner: string }>();
  for (const anchor of anchors) {
    const id = idFromUrl(anchor.href);
    if (id && !unique.has(id)) unique.set(id, { href: anchor.href, index: anchor.index, inner: anchor.inner });
  }
  const entries = [...unique.entries()].sort((a, b) => a[1].index - b[1].index);
  const rows: ChinaRow[] = [];
  for (let i = 0; i < entries.length; i++) {
    const [id, entry] = entries[i];
    const end = entries[i + 1]?.[1].index || Math.min(markup.length, entry.index + 18_000);
    const cardHtml = markup.slice(Math.max(0, entry.index - 1_500), end);
    const text = clean(cardHtml);
    const anchorText = clean(entry.inner);
    const titleCandidate = anchorText.length >= 4 && anchorText.length <= 220 ? anchorText : text;
    const title = titleCandidate.replace(/\s+(?:\d+(?:\.\d+)?万公里|\d{4}[-年].*)$/s, "").slice(0, 180).trim();
    const year = Number(titleCandidate.match(/(20\d{2})款/)?.[1] || text.match(/(20\d{2})[-年]/)?.[1] || 0);
    const mileageKm = wanKm(text.match(/([0-9]+(?:\.[0-9]+)?)\s*万公里/)?.[1]);
    const priceMatches = [...text.matchAll(/([0-9]+(?:\.[0-9]+)?)\s*万/g)].map((m) => Number(m[1])).filter((n) => n > 0 && n < 1_000);
    const price = cnyWan(priceMatches[0]);
    if (!id || !entry.href || !title || year < 2011 || !price) continue;
    rows.push({ id, detailUrl: entry.href, title, year, mileageKm, price, currency: "CNY", listingText: text.slice(0, 1_500) });
  }
  return rows;
}

abstract class ExactChinaAdapter implements CatalogSourceAdapter {
  abstract sourceId: string;
  abstract label: string;
  abstract baseUrl: string;
  abstract listUrl(page: number): string;
  abstract detailPattern: RegExp;
  abstract detailId(url: string): string;
  abstract imageHostPattern: RegExp;
  market = "china" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const url = this.listUrl(page);
    const { response, html } = await getHtml(url, this.baseUrl);
    const items = parseCards(html, response.url || url, this.detailPattern, (value) => this.detailId(value));
    return { items, nextCursor: items.length ? String(page + 1) : null, finished: !items.length, count: items.length,
      health: { ok: items.length > 0, message: `${this.label}:exact_list:${items.length}`, checkedAt: new Date().toISOString(), httpStatus: response.status, contentType: response.headers.get("content-type") || "" } };
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as ChinaRow;
    if (!row?.id || !row.detailUrl || !row.title || !row.year || !row.price) return null;
    const now = new Date().toISOString();
    const { make, model } = splitMakeModel(row.title);
    return { id: `${this.sourceId}:${row.id}`, sourceId: this.sourceId, sourceOfferId: row.id, market: "china", offerType: "fixed", status: "active",
      sourceTitle: row.title, make, model, year: row.year, mileageKm: row.mileageKm, sourcePrice: row.price, sourceCurrency: "CNY", priceMode: "fixed",
      images: [], totalRub: null, calculationStatus: "needs_knowledge", firstSeenAt: now, updatedAt: now,
      operational: { sourceUrl: row.detailUrl, sourceVenueName: this.label, sourceTitle: row.title, raw: row, galleryStoredAs: "json_urls" } };
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const sourceUrl = String(offer.operational?.sourceUrl || "");
    if (!sourceUrl || !this.detailPattern.test(sourceUrl)) return [];
    const { html } = await getHtml(sourceUrl, this.baseUrl);
    const pageText = clean(html);
    const title = clean(offer.sourceTitle || offer.operational?.sourceTitle || "");
    const keyWords = title.split(/\s+/).filter((x) => x.length >= 2).slice(0, 2);
    if (keyWords.length && !keyWords.some((key) => pageText.includes(key))) return [];

    const stopIndexes = [html.search(/猜你喜欢/i), html.search(/同款在售/i), html.search(/相关推荐/i), html.search(/热门推荐/i)].filter((n) => n > 0);
    const galleryHtml = stopIndexes.length ? html.slice(0, Math.min(...stopIndexes)) : html.slice(0, Math.min(html.length, 700_000));
    const urls = imageUrls(galleryHtml, sourceUrl, this.imageHostPattern);
    const minimum = Math.max(5, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 5));
    const verified = urls.length >= minimum;
    offer.operational = { ...(offer.operational || {}), photoIdentityVerified: verified, galleryVerified: verified, galleryImageCount: urls.length,
      gallerySafetyMode: "exact_detail_only", galleryStoredAs: "json_urls" };
    return verified ? urls.map(remoteImage) : [];
  }

  mapStatus(): OfferStatus { return "active"; }
  async healthCheck(): Promise<SourceRunHealth> {
    try { const { response } = await getHtml(this.listUrl(1), this.baseUrl); return { ok: response.ok, message: `${this.label}:http_${response.status}`, checkedAt: new Date().toISOString(), httpStatus: response.status }; }
    catch (error) { return { ok: false, message: String((error as Error)?.message || error), checkedAt: new Date().toISOString() }; }
  }
}

class GuaziChinaExactAdapter extends ExactChinaAdapter {
  sourceId = "guazi_china_open";
  label = "Guazi China";
  baseUrl = "https://www.guazi.com";
  detailPattern = /\/car-detail\/c\d+\.html/i;
  imageHostPattern = /guazistatic\.com|guazistatic-global\.com/i;
  listUrl(page: number) { return page <= 1 ? `${this.baseUrl}/` : `${this.baseUrl}/?page=${page}`; }
  detailId(url: string) { return url.match(/\/car-detail\/c(\d+)\.html/i)?.[1] || ""; }
}

class Che168ExactAdapter extends ExactChinaAdapter {
  sourceId = "autohome_used_china_open";
  label = "Che168 Used Cars";
  baseUrl = "https://www.che168.com";
  detailPattern = /\/dealer\/\d+\/\d+\.html/i;
  imageHostPattern = /autoimg\.cn|che168\.com/i;
  listUrl(page: number) { return page <= 1 ? `${this.baseUrl}/china/list/` : `${this.baseUrl}/china/a0_0msdgscncgpi1ltocsp${page}exx0/`; }
  detailId(url: string) { const m = url.match(/\/dealer\/(\d+)\/(\d+)\.html/i); return m ? `${m[1]}_${m[2]}` : ""; }
}

export const guaziChinaExactSource = new GuaziChinaExactAdapter();
export const che168ExactSource = new Che168ExactAdapter();

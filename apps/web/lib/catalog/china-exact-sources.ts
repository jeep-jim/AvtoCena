import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, SourceRunHealth, VehicleOffer } from "./types";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};
const BAD_IMAGE = /logo|icon|avatar|qrcode|qr-code|banner|sprite|tracking|pixel|favicon|appstore|googleplay|placeholder|default|dealer|seller|brand|wechat|weixin|badge|flag/i;
const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i;
const GUAZI_BOT_CHALLENGE = /EO-Bot-Js-Token|solveChallenge|TencentEdgeOne/i;

export function isGuaziSourceBotChallenge(markup: unknown) {
  return GUAZI_BOT_CHALLENGE.test(String(markup ?? ""));
}

function blockedSourceError(message: string, status?: number) {
  const error = new Error(message) as Error & { blocked?: boolean; status?: number };
  error.blocked = true;
  error.status = status;
  return error;
}

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
function decodeAttribute(value: unknown) {
  return String(value ?? "").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").trim();
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
function integer(value: unknown) {
  const n = Number(String(value ?? "").replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

type GuaziEvidenceStatus = "exact" | "ambiguous" | "conflict" | "missing";
type GuaziEvidence<T> = { value?: T; rawValues: string[]; status: GuaziEvidenceStatus };
export type GuaziSpecificationEvidence = {
  year: GuaziEvidence<number>;
  fuel: GuaziEvidence<string>;
  powertrainKind: GuaziEvidence<string>;
  engineCc: GuaziEvidence<number>;
  powerHp: GuaziEvidence<number>;
  powerKw: GuaziEvidence<number>;
};

function unique(values: unknown[]) {
  return [...new Set(values.map((value) => clean(value)).filter(Boolean))];
}
function exactEvidence<T>(rawValues: string[], parsedValues: Array<T | undefined>): GuaziEvidence<T> {
  if (!rawValues.length) return { rawValues, status: "missing" };
  const usable = parsedValues.filter((value): value is T => value !== undefined);
  const distinct = [...new Set(usable)];
  if (distinct.length > 1) return { rawValues, status: "conflict" };
  if (parsedValues.some((value) => value === undefined) || distinct.length !== 1) return { rawValues, status: "ambiguous" };
  return { value: distinct[0], rawValues, status: "exact" };
}
function exactYear(value: string) {
  if (!/^(?:19|20)\d{2}$/.test(value)) return undefined;
  const year = Number(value);
  return year >= 2011 && year <= new Date().getUTCFullYear() + 1 ? year : undefined;
}
function identityYears(value: unknown) {
  return [...String(value ?? "").matchAll(/(?:^|[^0-9])((?:19|20)\d{2})(?=[^0-9]|$)/g)].map((match) => match[1]);
}
function titleEngineTokens(value: unknown) {
  const text = decodeAttribute(value);
  const range = text.match(/\d(?:[.,]\d+)?\s*(?:-|–|—|to)\s*\d(?:[.,]\d+)?\s*[LT]\b/i);
  if (range) return [range[0]];
  return [...text.matchAll(/(?:^|[^0-9])(\d(?:[.,]\d+)?)\s*[LT]\b/gi)].map((match) => `${match[1]}L`);
}
function urlEngineTokens(value: unknown) {
  try {
    const pathname = new URL(String(value ?? "")).pathname;
    return [...pathname.matchAll(/(?:^|[-_])(\d)(\d)[lt](?=[-_.\/]|$)/gi)].map((match) => `${match[1]}.${match[2]}L`);
  } catch {
    return [];
  }
}
function exactEngine(value: string) {
  if (/\d\s*(?:-|–|—|to)\s*\d/i.test(value)) return undefined;
  const match = value.match(/^(\d(?:[.,]\d+)?)L$/i);
  const liters = match ? Number(match[1].replace(",", ".")) : 0;
  return liters >= 0.6 && liters <= 8 ? Math.round(liters * 1_000) : undefined;
}

export function guaziSpecificationEvidence(input: {
  listingYear?: unknown;
  title?: unknown;
  detailUrl?: unknown;
}): GuaziSpecificationEvidence {
  const years = unique([input.listingYear, ...identityYears(input.title), ...identityYears(input.detailUrl)]);
  const engines = unique([...titleEngineTokens(input.title), ...urlEngineTokens(input.detailUrl)]);
  const missing = <T>(): GuaziEvidence<T> => ({ rawValues: [], status: "missing" });
  return {
    year: exactEvidence(years, years.map(exactYear)),
    fuel: missing<string>(),
    powertrainKind: missing<string>(),
    engineCc: exactEvidence(engines, engines.map(exactEngine)),
    powerHp: missing<number>(),
    powerKw: missing<number>(),
  };
}

export function listingEngineCc(value: unknown) {
  const identity = decodeAttribute(value).toLowerCase();
  const decimalLiters = Number(identity.match(/(?:^|[^0-9])([0-9](?:[.,][0-9]))\s*l(?:[^a-z]|$)/i)?.[1]?.replace(",", ".") || 0);
  if (decimalLiters >= 0.6 && decimalLiters <= 8) return Math.round(decimalLiters * 1_000);
  const compact = identity.match(/(?:^|[-_])([0-9])([0-9])l(?:[-_.\/]|$)/i);
  if (!compact) return undefined;
  const liters = Number(`${compact[1]}.${compact[2]}`);
  return liters >= 0.6 && liters <= 8 ? Math.round(liters * 1_000) : undefined;
}
function remoteImage(url: string): CatalogImage {
  return { id: "", url, objectKey: "", checksum: "", size: 0, mimeType: /\.png(?:[?#]|$)/i.test(url) ? "image/png" : /\.webp(?:[?#]|$)/i.test(url) ? "image/webp" : /\.avif(?:[?#]|$)/i.test(url) ? "image/avif" : "image/jpeg" };
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
    if (!url || !hostPattern.test(url) || BAD_IMAGE.test(url) || !IMAGE_EXTENSION.test(url)) continue;
    const key = url.replace(/[?#].*$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(url);
    if (result.length >= 30) break;
  }
  return result;
}
function splitMakeModel(title: string) {
  const normalized = clean(title)
    .replace(/^(?:Grade\s*[SABCD]\s*)?Used\s+/i, "")
    .replace(/^(?:大额补贴|惠购818|新上架|抢购价)\s*/g, "");
  const yearMatch = normalized.match(/\b(?:19|20)\d{2}\b/);
  const beforeYear = yearMatch ? normalized.slice(0, yearMatch.index).trim() : normalized.split(/\s+(?=20\d{2}款)/)[0] || normalized;
  const parts = beforeYear.split(/\s+/).filter(Boolean);
  return { make: parts[0] || "中国汽车", model: parts.slice(1).join(" ") || parts[0] || "车型" };
}
async function getHtml(url: string, referer?: string) {
  const response = await fetch(url, { headers: { ...HEADERS, ...(referer ? { referer } : {}) }, redirect: "follow", signal: AbortSignal.timeout(Math.max(8_000, Number(process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS || 30_000))) });
  const html = await response.text();
  if (!response.ok) throw new Error(`china_exact_http_${response.status}:${url}`);
  return { response, html };
}

type ChinaRow = {
  id: string;
  detailUrl: string;
  title: string;
  year: number;
  mileageKm?: number;
  price: number;
  currency: "CNY" | "USD";
  listingText: string;
  make?: string;
  model?: string;
  trim?: string;
  fuel?: string;
};

function parseChineseCards(markup: string, pageUrl: string, linkRe: RegExp, idFromUrl: (url: string) => string): ChinaRow[] {
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
    const title = titleCandidate.replace(/\s+(?:\d+(?:\.\d+)?万公里|\d{4}[-年].*)$/, "").slice(0, 180).trim();
    const year = Number(titleCandidate.match(/(20\d{2})款/)?.[1] || text.match(/(20\d{2})[-年]/)?.[1] || 0);
    const mileageKm = wanKm(text.match(/([0-9]+(?:\.[0-9]+)?)\s*万公里/)?.[1]);
    const priceMatches = [...text.matchAll(/([0-9]+(?:\.[0-9]+)?)\s*万/g)].map((m) => Number(m[1])).filter((n) => n > 0 && n < 1_000);
    const price = cnyWan(priceMatches[0]);
    if (!id || !entry.href || !title || year < 2011 || !price) continue;
    rows.push({ id, detailUrl: entry.href, title, year, mileageKm, price, currency: "CNY", listingText: text.slice(0, 1_500) });
  }
  return rows;
}

function parseGuaziGlobalCards(markup: string, pageUrl: string): ChinaRow[] {
  const productRe = /\/products\/([a-z0-9-]+)\.html/i;
  const anchors = [...markup.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: absolute(match[1], pageUrl), inner: match[2], index: match.index || 0 }))
    .filter((row) => productRe.test(row.href));
  const unique = new Map<string, { href: string; index: number; inner: string }>();
  for (const anchor of anchors) {
    const id = anchor.href.match(productRe)?.[1];
    if (id && !unique.has(id)) unique.set(id, { href: anchor.href, index: anchor.index, inner: anchor.inner });
  }
  const entries = [...unique.entries()].sort((a, b) => a[1].index - b[1].index);
  const rows: ChinaRow[] = [];
  for (let i = 0; i < entries.length; i++) {
    const [id, entry] = entries[i];
    const end = entries[i + 1]?.[1].index || Math.min(markup.length, entry.index + 24_000);
    const cardHtml = markup.slice(Math.max(0, entry.index - 3_000), end);
    const text = clean(cardHtml);
    const altTitles = [...cardHtml.matchAll(/\balt\s*=\s*["']([^"']+)["']/gi)]
      .map((match) => clean(decodeAttribute(match[1])))
      .filter((value) => /^Used\s+/i.test(value) && /\b(?:19|20)\d{2}\b/.test(value));
    const anchorText = clean(entry.inner);
    const rawTitle = altTitles[0] || (anchorText.match(/(?:Grade\s*[SABCD]\s*)?(Used\s+.+?\b(?:19|20)\d{2}[^$]{0,180})/i)?.[1] || "");
    const title = clean(rawTitle).replace(/\s+Guazi used car.*$/i, "").slice(0, 180);
    const year = Number(title.match(/\b((?:19|20)\d{2})\b/)?.[1] || 0);
    const mileageKm = integer(text.match(/(?:19|20)\d{2}\.\d{1,2}\s+([0-9,]+)\s*km/i)?.[1]
      || text.match(/\b([0-9,]+)\s*km\b/i)?.[1]);
    const price = integer(text.match(/FOB\s*Price:\s*\$\s*([0-9,]+)/i)?.[1]);
    if (!id || !entry.href || !title || year < 2011 || !price) continue;
    rows.push({ id, detailUrl: entry.href, title, year, mileageKm, price, currency: "USD", listingText: text.slice(0, 2_000) });
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

  parseList(html: string, pageUrl: string) {
    return parseChineseCards(html, pageUrl, this.detailPattern, (value) => this.detailId(value));
  }

  protected validateListResponse(_html: string, _response: Response) {}

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const url = this.listUrl(page);
    const { response, html } = await getHtml(url, this.baseUrl);
    this.validateListResponse(html, response);
    const items = this.parseList(html, response.url || url);
    return { items, nextCursor: items.length ? String(page + 1) : null, finished: !items.length, count: items.length,
      health: { ok: items.length > 0, message: `${this.label}:exact_list:${items.length}`, checkedAt: new Date().toISOString(), httpStatus: response.status, contentType: response.headers.get("content-type") || "" } };
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as ChinaRow;
    if (!row?.id || !row.detailUrl || !row.title || !row.year || !row.price) return null;
    const now = new Date().toISOString();
    const derived = splitMakeModel(row.title);
    return { id: `${this.sourceId}:${row.id}`, sourceId: this.sourceId, sourceOfferId: row.id, market: "china", offerType: "fixed", status: "active",
      sourceTitle: row.title, make: clean(row.make) || derived.make, model: clean(row.model) || derived.model, trim: clean(row.trim) || undefined,
      year: row.year, mileageKm: row.mileageKm, engineCc: listingEngineCc(`${row.title} ${row.detailUrl} ${row.listingText}`), fuel: clean(row.fuel) || undefined, sourcePrice: row.price, sourceCurrency: row.currency, priceMode: "fixed",
      images: [], totalRub: null, calculationStatus: "needs_knowledge", firstSeenAt: now, updatedAt: now,
      operational: { sourceUrl: row.detailUrl, sourceVenueName: this.label, sourceTitle: row.title, raw: row, galleryStoredAs: "json_urls" } };
  }

  protected gallerySlice(html: string) {
    const stopIndexes = [
      html.search(/猜你喜欢/i), html.search(/同款在售/i), html.search(/相关推荐/i), html.search(/热门推荐/i),
      html.search(/You May Also Like/i), html.search(/Similar Vehicles/i), html.search(/Recommended/i),
    ].filter((n) => n > 0);
    return stopIndexes.length ? html.slice(0, Math.min(...stopIndexes)) : html.slice(0, Math.min(html.length, 900_000));
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const sourceUrl = String(offer.operational?.sourceUrl || "");
    if (!sourceUrl || !this.detailPattern.test(sourceUrl)) return [];
    const { html } = await getHtml(sourceUrl, this.baseUrl);
    const pageText = clean(html);
    const title = clean(offer.sourceTitle || offer.operational?.sourceTitle || "");
    const identityWords = title.replace(/^(?:Grade\s*[SABCD]\s*)?Used\s+/i, "").split(/\s+/).filter((x) => x.length >= 2).slice(0, 3);
    if (identityWords.length && !identityWords.some((key) => pageText.toLowerCase().includes(key.toLowerCase()))) return [];

    const urls = imageUrls(this.gallerySlice(html), sourceUrl, this.imageHostPattern);
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
  label = "Guazi China Global";
  baseUrl = "https://en.guazi.com";
  detailPattern = /\/products\/([a-z0-9-]+)\.html/i;
  imageHostPattern = /guazistatic-global\.com|guazistatic\.com/i;
  listUrl(page: number) { return page <= 1 ? `${this.baseUrl}/used-cars/` : `${this.baseUrl}/used-cars/page${page}/`; }
  detailId(url: string) { return url.match(this.detailPattern)?.[1] || ""; }
  parseList(html: string, pageUrl: string) { return parseGuaziGlobalCards(html, pageUrl); }
  protected validateListResponse(html: string, response: Response) {
    if (isGuaziSourceBotChallenge(html)) throw blockedSourceError("guazi_source_blocked_bot_challenge", response.status);
  }

  async healthCheck(): Promise<SourceRunHealth> {
    try {
      const page = await this.fetchPage("1");
      return page.health || { ok: false, message: "Guazi exact source health unavailable", checkedAt: new Date().toISOString() };
    } catch (error) {
      const sourceError = error as Error & { blocked?: boolean; status?: number };
      return {
        ok: false,
        blocked: sourceError.blocked === true,
        message: String(sourceError.message || error),
        checkedAt: new Date().toISOString(),
        httpStatus: sourceError.status,
      };
    }
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as ChinaRow;
    if (!row?.id || !row.detailUrl || !row.title || !row.year || !row.price) return null;
    const evidence = guaziSpecificationEvidence({ listingYear: row.year, title: row.title, detailUrl: row.detailUrl });
    if (evidence.year.status !== "exact") return null;
    const now = new Date().toISOString();
    const derived = splitMakeModel(row.title);
    return {
      id: `${this.sourceId}:${row.id}`, sourceId: this.sourceId, sourceOfferId: row.id, market: "china", offerType: "fixed", status: "active",
      sourceTitle: row.title, make: clean(row.make) || derived.make, model: clean(row.model) || derived.model, trim: clean(row.trim) || undefined,
      year: evidence.year.value!, mileageKm: row.mileageKm, engineCc: evidence.engineCc.status === "exact" ? evidence.engineCc.value : undefined,
      fuel: undefined, powertrainKind: "unknown", powerHp: undefined, powerKw: undefined,
      sourcePrice: row.price, sourceCurrency: row.currency, priceMode: "fixed", images: [], totalRub: null, calculationStatus: "needs_data", firstSeenAt: now, updatedAt: now,
      operational: {
        sourceUrl: row.detailUrl, sourceVenueName: this.label, sourceTitle: row.title, galleryStoredAs: "json_urls",
        semanticEvidence: {
          year: { source: "guazi_listing_title_and_product_url", ...evidence.year },
          fuel: { source: "guazi_named_fuel_not_available", ...evidence.fuel },
          powertrainKind: { source: "guazi_named_powertrain_not_available", ...evidence.powertrainKind },
          engineCc: { source: "guazi_listing_title_and_product_url", ...evidence.engineCc },
          powerHp: { source: "guazi_named_power_not_available", ...evidence.powerHp },
          powerKw: { source: "guazi_named_power_not_available", ...evidence.powerKw },
        },
        raw: { listing: row, fieldPolicy: "guazi_identity_bound_year_engine_only_v2" },
      },
    };
  }
}

class Che168ExactAdapter extends ExactChinaAdapter {
  sourceId = "autohome_used_china_open";
  label = "Che168 Global Used Cars";
  baseUrl = "https://global.che168.com";
  detailPattern = /\/(?:en\/)?detail\/(\d+)(?:[/?#]|$)/i;
  imageHostPattern = /autoimg\.cn|che168\.com/i;
  private readonly apiBase = "https://globalapi.che168.com";
  private readonly deviceId = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const value = Math.floor(Math.random() * 16);
    return (token === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });

  listUrl(_page: number) { return `${this.baseUrl}/en/used-cars`; }
  detailId(url: string) { return url.match(this.detailPattern)?.[1] || ""; }

  private apiParams(extra: Record<string, string> = {}) {
    return new URLSearchParams({ _appid: "g", deviceid: this.deviceId, language: "en", fromsource: "0", ...extra });
  }

  private async apiJson(url: string, referer = `${this.baseUrl}/en/used-cars`) {
    const response = await fetch(url, {
      headers: {
        accept: "application/json,text/plain,*/*",
        "accept-language": "en-US,en;q=0.9,zh-CN;q=0.7",
        origin: this.baseUrl,
        referer,
        "user-agent": HEADERS["user-agent"],
      },
      redirect: "follow",
      signal: AbortSignal.timeout(Math.max(8_000, Number(process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS || 30_000))),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`che168_global_api_http_${response.status}:${url}`);
    let payload: any;
    try { payload = JSON.parse(body); } catch { throw new Error(`che168_global_api_non_json_${response.status}_bytes_${body.length}`); }
    if (Number(payload?.returncode) !== 0 || !payload?.result) throw new Error(`che168_global_api_result_${payload?.returncode ?? "missing"}`);
    return { response, result: payload.result as Record<string, any> };
  }

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const params = this.apiParams({ pageindex: String(page), pagesize: "24", sort: "0", vehicle_list: "0" });
    const url = `${this.apiBase}/api/v1/search?${params.toString()}`;
    const { response, result } = await this.apiJson(url);
    const rows = Array.isArray(result.carlist) ? result.carlist : [];
    const items: ChinaRow[] = rows.map((row: Record<string, unknown>) => {
      const id = String(row.infoid || "").trim();
      const title = clean(row.carname);
      const year = Number(title.match(/\b((?:19|20)\d{2})\b/)?.[1] || clean(row.regdate).match(/\b((?:19|20)\d{2})\b/)?.[1] || 0);
      const price = Number(String(row.price ?? "").replace(/,/g, ""));
      return {
        id,
        detailUrl: id ? `${this.baseUrl}/en/detail/${encodeURIComponent(id)}` : "",
        title,
        year,
        mileageKm: integer(row.mileage),
        price: Number.isFinite(price) && price > 0 ? price : 0,
        currency: "USD" as const,
        listingText: "",
        make: clean(row.brandname),
        model: clean(row.seriesname),
        trim: clean(row.specname),
        fuel: clean(row.fuelname),
      };
    }).filter((row: ChinaRow) => Boolean(row.id && row.detailUrl && row.title && row.year >= 2011 && row.price > 0));
    const pageCount = Number(result.pagecount || 0);
    const total = Number(result.totalcount || items.length);
    const finished = items.length === 0 || (pageCount > 0 && page >= pageCount);
    return {
      items,
      count: total,
      finished,
      nextCursor: finished ? null : String(page + 1),
      health: { ok: items.length > 0, message: `Che168 Global API exact:${items.length}/${total}`, checkedAt: new Date().toISOString(), httpStatus: response.status, contentType: response.headers.get("content-type") || "" },
    };
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const id = String(offer.sourceOfferId || "").trim();
    const sourceUrl = String(offer.operational?.sourceUrl || "");
    if (!/^\d+$/.test(id) || !sourceUrl || !this.detailPattern.test(sourceUrl)) return [];
    const params = this.apiParams();
    const { result } = await this.apiJson(`${this.apiBase}/api/v1/carinfo/${encodeURIComponent(id)}?${params.toString()}`, sourceUrl);
    if (String(result.infoid || "") !== id) return [];
    const detailPrice = Number(String(result.price ?? "").replace(/,/g, ""));
    if (!(detailPrice > 0) || detailPrice !== Number(offer.sourcePrice || 0)) return [];
    const expectedTitle = clean(offer.sourceTitle || offer.operational?.sourceTitle || "").toLowerCase();
    const detailTitle = clean(result.carname).toLowerCase();
    if (expectedTitle && detailTitle && expectedTitle !== detailTitle) return [];

    const urls = [...new Set((Array.isArray(result.catepiclist) ? result.catepiclist : [])
      .flatMap((group: any) => Array.isArray(group?.list) ? group.list : [])
      .map((value: unknown) => clean(value))
      .filter((url: string) => /^https?:\/\//i.test(url) && /autoimg\.cn/i.test(url) && !BAD_IMAGE.test(url)))]
      .slice(0, Math.max(5, Math.min(30, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30))));

    offer.engineType = clean(result.engine) || offer.engineType;
    offer.transmission = clean(result.gearbox) || offer.transmission;
    offer.drive = clean(result.drivingmode) || offer.drive;
    offer.bodyType = clean(result.structure) || offer.bodyType;
    offer.color = clean(result.color) || offer.color;
    offer.productionDate = clean(result.manufacturedate || result.producedate) || offer.productionDate;
    offer.operational = {
      ...(offer.operational || {}),
      photoIdentityVerified: urls.length >= 5,
      galleryVerified: urls.length >= 5,
      galleryImageCount: urls.length,
      gallerySafetyMode: "che168_global_exact_api_detail",
      galleryStoredAs: "json_urls",
      apiDetailVerified: true,
    };
    return urls.map(remoteImage);
  }

  async healthCheck(): Promise<SourceRunHealth> {
    try {
      const page = await this.fetchPage(null);
      return { ok: Array.isArray(page.items) && page.items.length > 0, message: page.health?.message || "Che168 Global API exact", checkedAt: new Date().toISOString(), httpStatus: page.health?.httpStatus, contentType: page.health?.contentType };
    } catch (error) {
      return { ok: false, message: String((error as Error)?.message || error), checkedAt: new Date().toISOString() };
    }
  }
}

export const guaziChinaExactSource = new GuaziChinaExactAdapter();
export const che168ExactSource = new Che168ExactAdapter();

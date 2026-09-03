import { stableOfferId } from "./storage";
import { canonicalSourceFuel } from "./powertrain-safety";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, SourceRunHealth, VehicleOffer } from "./types";

const LIST_TEMPLATE = "https://car.autohome.com.cn/price/list-0-0-0-0-0-0-0-0-0-0-0-0-0-0-0-{page}.html";
const SITE_BASE = "https://www.autohome.com.cn";
const CAR_BASE = "https://car.autohome.com.cn";
const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
const MAIN_SPEC_RE = /<a\b[^>]*href=["'](?:https?:)?\/\/www\.autohome\.com\.cn\/spec\/(\d+)\/?(?:#[^"']*)?["'][^>]*>([\s\S]*?)<\/a>/gi;
const PRODUCT_IMAGE_RE = /^(?:https:\/\/g\.autoimg\.cn\/@img\/car\d?\/cardfs\/product\/|https:\/\/car\d+\.autoimg\.cn\/cardfs\/product\/)/i;
const DIRECT_PRODUCT_IMAGE_RE = /^https:\/\/car\d+\.autoimg\.cn\/cardfs\/product\//i;

export type AutohomeNewListRow = {
  specId: string;
  seriesId?: string;
  trimTitle: string;
  year: number;
  priceWan: number;
  sourcePriceCny: number;
  sourceUrl: string;
  galleryUrl?: string;
};

export type ExactConfigFields = {
  title?: string;
  msrpWan?: string;
  energy?: string;
  engine?: string;
  engineMaxHp?: string;
  engineMaxKw?: string;
  overallMaxKw?: string;
  motorTotalHp?: string;
  motorTotalKw?: string;
  systemHp?: string;
  systemKw?: string;
  transmission?: string;
  drive?: string;
  body?: string;
  seats?: string;
  marketDate?: string;
};

type AutohomeEvidenceStatus = "exact" | "ambiguous" | "conflict" | "missing";
type AutohomeEvidence<T> = { value?: T; rawValues: string[]; status: AutohomeEvidenceStatus };
export type AutohomeNewSpecificationEvidence = {
  year: AutohomeEvidence<number>;
  fuel: AutohomeEvidence<string>;
  powertrainKind: AutohomeEvidence<"combustion" | "electric" | "series_hybrid" | "other_hybrid">;
  engineCc: AutohomeEvidence<number>;
  powerHp: AutohomeEvidence<number>;
  powerKw: AutohomeEvidence<number>;
};

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function absolute(value: string, base: string) {
  try { return new URL(String(value || "").replace(/&amp;/g, "&"), base).toString(); }
  catch { return ""; }
}
function uniqueRaw(values: unknown[]) {
  return [...new Set(values.map(clean).filter(Boolean))];
}
function exactEvidence<T>(rawValues: string[], parsedValues: Array<T | undefined>): AutohomeEvidence<T> {
  if (!rawValues.length) return { rawValues, status: "missing" };
  const usable = parsedValues.filter((value): value is T => value !== undefined);
  const unique = [...new Set(usable)];
  if (unique.length > 1) return { rawValues, status: "conflict" };
  if (parsedValues.some((value) => value === undefined) || unique.length !== 1) return { rawValues, status: "ambiguous" };
  return { value: unique[0], rawValues, status: "exact" };
}
function exactYear(value: string) {
  if (!/^(?:19|20)\d{2}$/.test(value)) return undefined;
  const year = Number(value);
  return year >= 1980 && year <= new Date().getUTCFullYear() + 1 ? year : undefined;
}
function energyIdentity(value: string) {
  const normalized = clean(value);
  if (!normalized) return undefined;
  if (/增程/.test(normalized)) return { fuel: "hybrid", powertrainKind: "series_hybrid" } as const;
  if (/轻混|混合|插电|油电/.test(normalized)) return { fuel: "hybrid", powertrainKind: "other_hybrid" } as const;
  const fuel = canonicalSourceFuel(normalized);
  if (fuel === "electric") return { fuel, powertrainKind: "electric" } as const;
  if (fuel === "hybrid") return { fuel, powertrainKind: "other_hybrid" } as const;
  if (fuel) return { fuel, powertrainKind: "combustion" } as const;
  return undefined;
}
function hasRange(value: string) {
  return /\d\s*(?:-|–|—|至|到|~|～)\s*\d/.test(value);
}
function exactEngineCc(value: string) {
  if (!value || hasRange(value)) return undefined;
  const matches = [
    ...[...value.matchAll(/(\d{3,5})\s*(?:cc|cm3|cm³)\b/gi)].map((match) => Number(match[1])),
    ...[...value.matchAll(/(\d+(?:\.\d+)?)\s*[LT]\b/gi)].map((match) => Math.round(Number(match[1]) * 1_000)),
  ].filter((number) => Number.isFinite(number) && number >= 300 && number <= 10_000);
  const unique = [...new Set(matches)];
  return unique.length === 1 ? unique[0] : undefined;
}
function exactPower(value: string, unit: "hp" | "kw") {
  if (!value || hasRange(value)) return undefined;
  const normalized = value.replace(/,/g, "").trim();
  const match = normalized.match(unit === "hp"
    ? /^(\d{1,4}(?:\.\d+)?)\s*(?:Ps|hp|马力)?$/i
    : /^(\d{1,4}(?:\.\d+)?)\s*(?:kW)?$/i);
  const parsed = match ? Number(match[1]) : undefined;
  const maximum = unit === "hp" ? 2_500 : 2_000;
  return parsed !== undefined && parsed >= (unit === "hp" ? 20 : 10) && parsed <= maximum
    ? Math.round(parsed * 10) / 10
    : undefined;
}
function derivedPowerEvidence(rawValues: string[], value: number): AutohomeEvidence<number> {
  return { value: Math.round(value * 10) / 10, rawValues, status: "exact" };
}

export function autohomeNewSpecificationEvidence(input: {
  listingYear?: unknown;
  detailYear?: unknown;
  energy?: unknown;
  engine?: unknown;
  engineMaxHp?: unknown;
  engineMaxKw?: unknown;
}): AutohomeNewSpecificationEvidence {
  const years = uniqueRaw([input.listingYear, input.detailYear]);
  const energy = uniqueRaw([input.energy]);
  const engines = uniqueRaw([input.engine]);
  const hpValues = uniqueRaw([input.engineMaxHp]);
  const kwValues = uniqueRaw([input.engineMaxKw]);
  const year = exactEvidence(years, years.map(exactYear));
  const identities = energy.map(energyIdentity);
  const fuel = exactEvidence(energy, identities.map((value) => value?.fuel));
  const powertrainKind = exactEvidence(energy, identities.map((value) => value?.powertrainKind));
  let engineCc = exactEvidence(engines, engines.map(exactEngineCc));

  let powerHp: AutohomeEvidence<number> = { rawValues: hpValues, status: hpValues.length ? "ambiguous" : "missing" };
  let powerKw: AutohomeEvidence<number> = { rawValues: kwValues, status: kwValues.length ? "ambiguous" : "missing" };
  if (powertrainKind.status === "exact" && powertrainKind.value === "combustion") {
    powerHp = exactEvidence(hpValues, hpValues.map((value) => exactPower(value, "hp")));
    powerKw = exactEvidence(kwValues, kwValues.map((value) => exactPower(value, "kw")));
    if (powerHp.status === "exact" && powerKw.status === "exact") {
      const convertedHp = Number(powerKw.value) * 1.3596216173;
      const toleranceHp = Math.max(2, convertedHp * 0.015);
      if (Math.abs(convertedHp - Number(powerHp.value)) > toleranceHp) {
        const rawValues = [...hpValues, ...kwValues];
        powerHp = { rawValues, status: "conflict" };
        powerKw = { rawValues, status: "conflict" };
      }
    } else if (powerHp.status === "exact" && powerKw.status === "missing") {
      powerKw = derivedPowerEvidence(hpValues, Number(powerHp.value) * 0.73549875);
    } else if (powerKw.status === "exact" && powerHp.status === "missing") {
      powerHp = derivedPowerEvidence(kwValues, Number(powerKw.value) * 1.3596216173);
    }
  } else if (powertrainKind.status === "exact") {
    // Autohome's electrified engine/motor/system fields are peak maxima, not
    // certified 30-minute power. Keep them raw and out of calculation fields.
    powerHp = { rawValues: hpValues, status: "missing" };
    powerKw = { rawValues: kwValues, status: "missing" };
  }
  if (powertrainKind.status === "exact" && powertrainKind.value === "electric" && engineCc.status === "exact") {
    engineCc = { rawValues: engines, status: "conflict" };
  }
  return { year, fuel, powertrainKind, engineCc, powerHp, powerKw };
}
function yearFrom(value: unknown) {
  const year = Number(clean(value).match(/\b((?:19|20)\d{2})款?\b/)?.[1] || 0);
  return year >= 1980 && year <= new Date().getUTCFullYear() + 1 ? year : 0;
}
function listUrl(page: number) {
  return LIST_TEMPLATE.replace("{page}", String(Math.max(1, page)));
}
function specUrl(specId: string) {
  return `${SITE_BASE}/spec/${specId}/`;
}
function configUrl(specId: string) {
  return `${CAR_BASE}/config/spec/${specId}.html`;
}
function galleryUrl(specId: string, seriesId: string) {
  return `${CAR_BASE}/pic/series-s${specId}/${seriesId}.html`;
}
function modernSpecGalleryUrl(specId: string, seriesId: string) {
  return `${SITE_BASE}/cars/imglist-x-x-${seriesId}-${specId}-x-x-x-x-x-1.html`;
}
function image(url: string): CatalogImage {
  const mimeType = /\.png(?:[?#]|$)/i.test(url) ? "image/png" : /\.webp(?:[?#]|$)/i.test(url) ? "image/webp" : /\.avif(?:[?#]|$)/i.test(url) ? "image/avif" : "image/jpeg";
  return { id: "", url, objectKey: "", checksum: "", size: 0, mimeType };
}
function decodeAutohome(bytes: Uint8Array) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("gb18030").decode(bytes); }
}
async function fetchDecoded(url: string, referer: string) {
  const response = await fetch(url, {
    headers: { ...HEADERS, referer },
    redirect: "follow",
    signal: AbortSignal.timeout(Math.max(8_000, Number(process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS || 30_000))),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const body = decodeAutohome(bytes);
  if (!response.ok) throw new Error(`autohome_new_exact_http_${response.status}:${url}`);
  return { response, body };
}
function parseListing(markup: string): AutohomeNewListRow[] {
  const matches = [...markup.matchAll(MAIN_SPEC_RE)];
  const rows: AutohomeNewListRow[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const specId = match[1];
    if (!specId || seen.has(specId)) continue;
    const trimTitle = clean(match[2]);
    const year = yearFrom(trimTitle);
    if (!trimTitle || !year) continue;
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < matches.length ? (matches[index + 1].index || start + 4_000) : Math.min(markup.length, start + 6_000);
    const segment = markup.slice(start, Math.min(end, start + 6_000));
    const priceWan = Number(clean(segment).match(/([0-9]+(?:\.[0-9]+)?)\s*万/)?.[1] || 0);
    if (!(priceWan > 0)) continue;
    const around = markup.slice(Math.max(0, (match.index || 0) - 5_000), Math.min(markup.length, end + 3_000));
    const seriesId = around.match(new RegExp(`/pic/series-s${specId}/(\\d+)\\.html`, "i"))?.[1] || "";
    seen.add(specId);
    rows.push({ specId, seriesId: seriesId || undefined, trimTitle, year, priceWan, sourcePriceCny: Math.round(priceWan * 10_000), sourceUrl: specUrl(specId), galleryUrl: seriesId ? galleryUrl(specId, seriesId) : undefined });
  }
  return rows;
}
function extractJsonObject(markup: string, marker: string) {
  const start = markup.indexOf(marker);
  if (start < 0) return null;
  const open = markup.indexOf("{", start + marker.length);
  if (open < 0) return null;
  let depth = 0, quote = "", escaped = false;
  for (let index = open; index < markup.length; index++) {
    const char = markup[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "{") depth++;
    else if (char === "}" && --depth === 0) { try { return JSON.parse(markup.slice(open, index + 1)); } catch { return null; } }
  }
  return null;
}
function configValue(
  config: any,
  specId: string,
  rules: Array<{ id?: number; re?: RegExp }>,
  section?: RegExp,
) {
  const types = config?.result?.paramtypeitems || [];
  for (const type of types) {
    const typeName = clean(type?.name || type?.typename || type?.title || "");
    if (section && !section.test(typeName)) continue;
    for (const parameter of type?.paramitems || []) {
      const id = Number(parameter?.id), name = clean(parameter?.name);
      if (!rules.some((rule) => (rule.id != null && rule.id === id) || (rule.re && rule.re.test(name)))) continue;
      const item = (parameter?.valueitems || []).find((row: any) => Number(row?.specid) === Number(specId));
      if (!item) continue;
      const sub = (item.sublist || []).map((row: any) => clean(row?.subvalue)).filter(Boolean).join(" / ");
      const value = clean(item.value) || sub;
      if (value && value !== "-") return value;
    }
  }
  return "";
}
function exactConfigFields(config: any, specId: string): ExactConfigFields {
  const anySection = (rules: Array<{ id?: number; re?: RegExp }>) => configValue(config, specId, rules) || undefined;
  const engineSection = (rules: Array<{ id?: number; re?: RegExp }>) => configValue(config, specId, rules, /^发动机$/) || undefined;
  const motorSection = (rules: Array<{ id?: number; re?: RegExp }>) => configValue(config, specId, rules, /^电动机$/) || undefined;
  const basicSection = (rules: Array<{ id?: number; re?: RegExp }>) => configValue(config, specId, rules, /^基本参数$/) || undefined;
  return {
    title: anySection([{ re: /^车型/ }]),
    msrpWan: anySection([{ re: /厂.*指导价/ }]),
    energy: anySection([{ id: 1149 }, { re: /能源类型/ }]),
    engine: anySection([{ id: 1150 }, { re: /^发动机$/ }]),
    engineMaxHp: engineSection([{ id: 1294 }, { re: /^最大马力\(Ps\)$/ }]),
    engineMaxKw: engineSection([{ id: 1185 }, { re: /^最大功率\(kW\)$/ }]),
    overallMaxKw: basicSection([{ id: 1185 }, { re: /^最大功率\(kW\)$/ }]),
    motorTotalHp: motorSection([{ id: 9013 }, { re: /^电动机总马力\(Ps\)$/ }]),
    motorTotalKw: motorSection([{ id: 8448 }, { re: /^电动机总功率\(kW\)$/ }]),
    systemHp: motorSection([{ id: 9014 }, { re: /^系统\s*马力\(Ps\)$/ }]),
    systemKw: motorSection([{ id: 8455 }, { re: /^系统\s*功率\(kW\)$/ }]),
    transmission: anySection([{ id: 1265 }, { re: /^变速箱$/ }, { id: 1230 }]),
    body: anySection([{ id: 1147 }, { re: /^车身结构$/ }]),
    seats: anySection([{ id: 1173 }, { re: /座位数/ }]),
    marketDate: anySection([{ id: 8453 }, { re: /上市/ }]),
  };
}
export function parseAutohomeExactConfigFields(markup: string, specId: string): ExactConfigFields | null {
  const config = extractJsonObject(markup, "var config =");
  return config ? exactConfigFields(config, specId) : null;
}
function identityFromSpecTitle(markup: string, fallbackTrim: string) {
  const pageTitle = clean(markup.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const match = pageTitle.match(/^【图】(.+?)\s+((?:19|20)\d{2}款.+?)报价_图片_(.+?)_汽车之家$/);
  if (match) return { model: clean(match[1]), trim: clean(match[2]), make: clean(match[3]), pageTitle };
  const compact = pageTitle.replace(/^【图】/, "").replace(/报价_图片_.+$/, ""), yearIndex = compact.search(/(?:19|20)\d{2}款/);
  return { model: yearIndex > 0 ? clean(compact.slice(0, yearIndex)) : "", trim: yearIndex > 0 ? clean(compact.slice(yearIndex)) : fallbackTrim, make: clean(pageTitle.match(/_图片_(.+?)_汽车之家$/)?.[1] || ""), pageTitle };
}
function exactProductImages(markup: string, base: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/(?:src|data-src|data-original|data-src2|data-webp|content)=["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) values.push(match[0].replace(/\\\//g, "/"));
  const urls = [...new Set(values.map((value) => absolute(value, base)).filter((url) => PRODUCT_IMAGE_RE.test(url)))];
  return [...urls.filter((url) => DIRECT_PRODUCT_IMAGE_RE.test(url)), ...urls.filter((url) => !DIRECT_PRODUCT_IMAGE_RE.test(url))].slice(0, 30);
}
function nextData(markup: string) {
  const match = markup.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}
function seriesIdFromSpecPage(markup: string) {
  const data = nextData(markup);
  const value = data?.props?.pageProps?.seriesId || data?.props?.pageProps?.specDetails?.bread?.seriesid;
  const parsed = String(value || markup.match(/\bseries\s*:\s*(\d+)/i)?.[1] || "");
  return /^\d+$/.test(parsed) ? parsed : "";
}
export function exactAutohomeSpecGalleryImages(markup: string, specId: string) {
  const data = nextData(markup);
  const groups = data?.props?.pageProps?.SeriesPicList?.picinfo?.callist;
  if (!Array.isArray(groups)) return [];
  const values: string[] = [];
  for (const group of groups) {
    for (const item of Array.isArray(group?.list) ? group.list : []) {
      if (Number(item?.specid) !== Number(specId)) continue;
      const url = absolute(String(item?.picpath || ""), SITE_BASE);
      if (DIRECT_PRODUCT_IMAGE_RE.test(url)) values.push(url);
    }
  }
  return [...new Set(values)].slice(0, 30);
}
export class AutohomeNewExactAdapter implements CatalogSourceAdapter {
  sourceId = "autohome_new_china_open";
  market = "china" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1)), url = listUrl(page);
    const { response, body } = await fetchDecoded(url, page > 1 ? listUrl(page - 1) : "https://car.autohome.com.cn/");
    const items = parseListing(body);
    const nextHref = [...body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].find((match) => /下一页|下页|next/i.test(clean(match[2])))?.[1] || "";
    const nextPage = nextHref.match(/-(\d+)\.html/i)?.[1], finished = !items.length || (!nextPage && page > 1 && items.length < 20);
    return { items, nextCursor: finished ? null : String(nextPage || page + 1), finished, count: items.length, health: { ok: items.length > 0, message: `Autohome new exact list page=${page} items=${items.length}`, checkedAt: new Date().toISOString(), httpStatus: response.status, contentType: response.headers.get("content-type") || "" } };
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as AutohomeNewListRow;
    if (!row?.specId || !row.trimTitle || !row.year || !(row.sourcePriceCny > 0) || !row.sourceUrl) return null;
    const semanticEvidence = autohomeNewSpecificationEvidence({ listingYear: row.year });
    if (semanticEvidence.year.status !== "exact") return null;
    const now = new Date().toISOString();
    return { id: stableOfferId(this.sourceId, row.specId), sourceId: this.sourceId, sourceOfferId: row.specId, market: "china", offerType: "fixed", status: "active", catalogKind: "listing", sourceTitle: row.trimTitle, make: "", model: "", trim: row.trimTitle, year: semanticEvidence.year.value!, sourcePrice: row.sourcePriceCny, sourceCurrency: "CNY", priceMode: "fixed", images: [], totalRub: null, calculationStatus: "needs_data", firstSeenAt: now, updatedAt: now, operational: { sourceUrl: row.sourceUrl, sourceVenueName: "汽车之家 / Autohome", sourceTitle: row.trimTitle, exactDetail: false, exactFields: true, exactPhotos: false, galleryVerified: false, galleryImageCount: 0, gallerySafetyMode: "autohome_exact_spec_next_data_picpath_v2", galleryStoredAs: "json_urls", semanticEvidence: {
      year: { source: "autohome_listing_trim_year", ...semanticEvidence.year },
      fuel: { source: "autohome_named_energy_type", ...semanticEvidence.fuel },
      powertrainKind: { source: "autohome_named_energy_type", ...semanticEvidence.powertrainKind },
      engineCc: { source: "autohome_named_engine", ...semanticEvidence.engineCc },
      powerHp: { source: "autohome_engine_section_max_power", ...semanticEvidence.powerHp },
      powerKw: { source: "autohome_engine_section_max_power", ...semanticEvidence.powerKw },
    }, raw: { listing: row, priceUnit: "CNY_wan_x10000", detailIdentityVerified: false, photoIdentityVerified: false } } };
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const specId = String(offer.sourceOfferId || "");
    if (!/^\d+$/.test(specId)) return [];
    const listing = (offer.operational?.raw as any)?.listing as AutohomeNewListRow | undefined;
    const [specPage, configPage] = await Promise.all([fetchDecoded(specUrl(specId), listing?.sourceUrl || listUrl(1)), fetchDecoded(configUrl(specId), specUrl(specId))]);
    const identity = identityFromSpecTitle(specPage.body, listing?.trimTitle || offer.trim || "");
    if (!identity.make || !identity.model || yearFrom(identity.trim) !== Number(offer.year)) throw new Error(`autohome_new_exact_identity_failed:${specId}`);
    const fields = parseAutohomeExactConfigFields(configPage.body, specId);
    if (!fields) throw new Error(`autohome_new_exact_config_missing:${specId}`);
    const seriesId = String(listing?.seriesId || seriesIdFromSpecPage(specPage.body) || "");
    const exactGalleryUrl = seriesId ? modernSpecGalleryUrl(specId, seriesId) : "";
    const galleryPage = exactGalleryUrl
      ? await fetchDecoded(exactGalleryUrl, specUrl(specId)).catch(() => null)
      : null;
    const minimum = Math.max(5, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 5));
    const exactGallery = galleryPage ? exactAutohomeSpecGalleryImages(galleryPage.body, specId) : [];
    const fallbackGallery = exactProductImages(specPage.body, specPage.response.url || specUrl(specId));
    const gallery = (exactGallery.length >= minimum
      ? exactGallery
      : [...new Set([...exactGallery, ...fallbackGallery])]).slice(0, 30);
    const verifiedGallery = gallery.length >= minimum && (exactGallery.length >= minimum || gallery.every((url) => PRODUCT_IMAGE_RE.test(url)));
    const semanticEvidence = autohomeNewSpecificationEvidence({
      listingYear: offer.year,
      detailYear: yearFrom(identity.trim),
      energy: fields.energy,
      engine: fields.engine,
      engineMaxHp: fields.engineMaxHp,
      engineMaxKw: fields.engineMaxKw,
    });
    offer.make = identity.make; offer.model = identity.model; offer.trim = identity.trim || offer.trim; offer.sourceTitle = `${identity.model} ${identity.trim}`.trim();
    offer.fuel = semanticEvidence.fuel.status === "exact" ? semanticEvidence.fuel.value : undefined;
    offer.powertrainKind = semanticEvidence.powertrainKind.status === "exact" ? semanticEvidence.powertrainKind.value : "unknown";
    offer.engineType = fields.engine || undefined;
    offer.engineCc = semanticEvidence.engineCc.status === "exact" ? semanticEvidence.engineCc.value : undefined;
    offer.transmission = fields.transmission || offer.transmission; offer.bodyType = fields.body || offer.bodyType;
    offer.powerHp = semanticEvidence.powerHp.status === "exact" ? semanticEvidence.powerHp.value : undefined;
    offer.powerKw = semanticEvidence.powerKw.status === "exact" ? semanticEvidence.powerKw.value : undefined;
    const hasExactPower = Boolean(offer.powerHp || offer.powerKw);
    offer.powerDataConfidence = hasExactPower ? "source_exact" : undefined;
    offer.powerDataSource = hasExactPower ? "Autohome exact config: engine-section maximum power" : undefined;
    offer.operational = { ...(offer.operational || {}), sourceUrl: specUrl(specId), sourceVenueName: "汽车之家 / Autohome", sourceTitle: offer.sourceTitle, exactDetail: true, exactFields: true, exactPhotos: verifiedGallery, galleryVerified: verifiedGallery, galleryImageCount: gallery.length, photoIdentityVerified: verifiedGallery, gallerySafetyMode: "autohome_exact_spec_next_data_picpath_v2", galleryStoredAs: "json_urls", semanticEvidence: {
      year: { source: "autohome_listing_and_detail_year", ...semanticEvidence.year },
      fuel: { source: "autohome_named_energy_type", ...semanticEvidence.fuel },
      powertrainKind: { source: "autohome_named_energy_type", ...semanticEvidence.powertrainKind },
      engineCc: { source: "autohome_named_engine", ...semanticEvidence.engineCc },
      powerHp: { source: "autohome_engine_section_max_power", ...semanticEvidence.powerHp },
      powerKw: { source: "autohome_engine_section_max_power", ...semanticEvidence.powerKw },
    }, raw: { listing, configFields: fields, configSpecId: specId, specPageTitle: identity.pageTitle, galleryUrl: exactGalleryUrl || listing?.galleryUrl, legacyGalleryUrl: listing?.galleryUrl, exactProductImages: gallery, exactGalleryImageCount: exactGallery.length, detailIdentityVerified: true, photoIdentityVerified: verifiedGallery, powerFieldPolicy: "section_bound_engine_motor_system_fields_v3_semantic_evidence", electrifiedPowerPolicy: "maximum_motor_system_power_kept_raw_not_used_as_customs_30min_power" } };
    return gallery.map(image);
  }

  mapStatus(): OfferStatus { return "active"; }
  async healthCheck(): Promise<SourceRunHealth> {
    try { const page = await this.fetchPage("1"); return page.health || { ok: page.items.length > 0, message: `Autohome new exact items=${page.items.length}`, checkedAt: new Date().toISOString() }; }
    catch (error) { return { ok: false, message: String((error as Error)?.message || error), checkedAt: new Date().toISOString() }; }
  }
}

export const autohomeNewExactSource = new AutohomeNewExactAdapter();

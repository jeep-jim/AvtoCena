import crypto from "node:crypto";
import { getActiveMarketVersion } from "../business-settings";
import { cacheImageFromUrl, stableOfferId } from "./storage";
import type { CatalogFetchResult, CatalogImage, CatalogMarket, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";
import { convertToRub } from "./rates";
import { openMarketSources } from "./open-market-sources";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import { calculateAvtocenaFromBusinessConfig } from "../../../../packages/engine/src/calculation/calculateAvtocena";

const HONEST_HEADERS = { "user-agent": "AvtoCenaCatalog/1.0", referer: "https://m.encar.com/" };
const ENCAR_HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  origin: "https://m.encar.com",
  referer: "https://m.encar.com/",
  "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};
const BLOCK_RE = /captcha|challenge|access denied|forbidden|cloudflare/i;

function envName(id: string, key: string) { return `CATALOG_${id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${key}`; }
function text(value: any) { return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim(); }
function num(value: any) { const number = Number(String(value ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(number) && number > 0 ? number : undefined; }
function bool(value?: string, fallback = false) { return value == null ? fallback : ["1", "true", "yes", "on"].includes(String(value).toLowerCase()); }
function nowIso() { return new Date().toISOString(); }
function blockError(message: string, status?: number) { const error = new Error(message) as Error & { blocked?: boolean; status?: number }; error.blocked = true; error.status = status; return error; }
function sourceTimeoutMs() { return Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 15000); }
function sourceTimeoutError(error: any) { if (error?.name === "AbortError") { const next = new Error("source_timeout") as Error & { temporary?: boolean }; next.temporary = true; return next; } return error; }

async function withSourceTimeout<T>(fn: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), sourceTimeoutMs());
  try { return await fn(controller.signal); } catch (error: any) { throw sourceTimeoutError(error); } finally { clearTimeout(timeout); }
}

async function fetchTextWithTimeout(input: RequestInfo | URL, init: RequestInit = {}) {
  return withSourceTimeout(async (signal) => { const res = await fetch(input, { ...init, signal }); return { res, text: await res.text() }; });
}

async function fetchJsonBodyWithTimeout(input: RequestInfo | URL, init: RequestInit = {}) {
  return withSourceTimeout(async (signal) => { const res = await fetch(input, { ...init, signal }); return { res, json: await res.json() as any }; });
}

class SourceRateLimiter {
  private queue: Promise<unknown> = Promise.resolve();
  private last = 0;
  constructor(private rpm: number) {}
  run<T>(fn: () => Promise<T>) {
    const gap = Math.ceil(60_000 / Math.max(1, this.rpm));
    const task = this.queue.then(async () => {
      const wait = Math.max(0, this.last + gap - Date.now());
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      this.last = Date.now();
      return fn();
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
}

const limiters = new Map<string, SourceRateLimiter>();
function limiter(key: string, rpm: number) { const existing = limiters.get(key); if (existing) return existing; const next = new SourceRateLimiter(rpm); limiters.set(key, next); return next; }

async function fetchPublicJson(url: string, init: RequestInit = {}) {
  const { res, text: body } = await fetchTextWithTimeout(url, { ...init, headers: { ...HONEST_HEADERS, ...(init.headers || {}) } });
  const contentType = res.headers.get("content-type") || "";
  const bodyPreview = body.replace(/\s+/g, " ").slice(0, 300);
  const diagnostic = `status=${res.status} content-type=${contentType || "unknown"} url=${url} bodyPreview=${bodyPreview}`;
  if ([401, 403].includes(res.status)) throw blockError(`blocked_${res.status} ${diagnostic}`, res.status);
  if (res.status === 429) throw blockError(`rate_limited_429 ${diagnostic}`, 429);
  if (BLOCK_RE.test(body.slice(0, 500))) throw blockError(`html_challenge_instead_of_json ${diagnostic}`, res.status);
  if (!contentType.includes("json")) throw new Error(`non_json_response ${diagnostic}`);
  if (!res.ok) throw new Error(`http_${res.status} ${diagnostic}`);
  return JSON.parse(body);
}

function parseEncarCursor(cursor?: string | null) {
  if (!cursor) return { offset: 0, pagingCursor: "" };
  try { const parsed = JSON.parse(cursor); return { offset: Number(parsed.offset || 0), pagingCursor: text(parsed.cursor) }; }
  catch { const number = Number(cursor); return { offset: Number.isFinite(number) ? number : 0, pagingCursor: "" }; }
}

export function buildEncarListUrl(cursor?: string | null, pageSize = Number(process.env.CATALOG_ENCAR_DIRECT_PAGE_SIZE || 50)) {
  const state = parseEncarCursor(cursor);
  const url = new URL(process.env.CATALOG_ENCAR_DIRECT_LIST_URL || "https://api.encar.com/search/car/list/mobile");
  url.searchParams.set("count", "true");
  url.searchParams.set("q", process.env.CATALOG_ENCAR_DIRECT_QUERY || "(And.Hidden.N._.CarType.A.)");
  url.searchParams.set("sr", `|MobileModifiedDate|${state.offset}|${pageSize}`);
  url.searchParams.set("inav", "|Metadata|Sort");
  if (state.pagingCursor) url.searchParams.set("cursor", state.pagingCursor);
  return { url, offset: state.offset, pageSize };
}

export function normalizeEncarPrice(value: unknown) { const number = num(value); if (!number) return null; return number < 100_000 ? number * 10_000 : number; }

export function buildEncarImageUrl(rawPhoto: any, imageNumber = 1) {
  const raw = text(rawPhoto);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const padded = String(Math.max(1, imageNumber)).padStart(3, "0");
  let path = `/${raw.replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/");
  if (/\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(path)) return `https://ci.encar.com${path}`;
  if (!path.startsWith("/carpicture/")) path = `/carpicture${path}`;
  path = path.replace(/\/{2,}/g, "/");
  return `https://ci.encar.com${path.endsWith("/") ? path : `${path}/`}${padded}.jpg`;
}

export function extractEncarImageUrls(offer: VehicleOffer, detail?: any) {
  const raw: any = offer.operational.raw || {};
  const listRaw = raw.offer || raw;
  const photos = detail?.photos || detail?.PhotoList || detail?.vehicle?.photos || detail?.vehicle?.PhotoList || [];
  const listCover = listRaw?.Photo || listRaw?.photo || raw?.offer?.Photo || raw?.offer?.photo;
  return [...new Set([buildEncarImageUrl(listCover, 1), ...photos.map((photo: any, index: number) => buildEncarImageUrl(photo.path || photo.url || photo.Photo || photo.location || photo, num(photo.imageNumber || photo.no || photo.seq) || index + 1))].filter(Boolean))].slice(0, 10);
}

async function pricedOffer(offer: VehicleOffer) {
  const rate = await convertToRub(offer.sourcePrice, offer.sourceCurrency);
  if (!rate) return offer;
  const version: any = await getActiveMarketVersion(offer.market);
  if (!version) return { ...offer, totalRub: rate.sourcePriceRub, calculationSnapshot: { currencyRate: rate } };
  const calculation = calculateAvtocenaFromBusinessConfig({ marketId: offer.market, marketConfig: version, sourcePriceRub: rate.sourcePriceRub });
  return { ...offer, totalRub: calculation.totalRub, calculationSnapshot: { ...calculation.snapshot, currencyRate: rate }, calculationStatus: offer.priceMode === "auction_start" ? "auction_start" : "ready" as const };
}

function deepFind(value: any, keys: string[], depth = 0): any {
  if (value == null || depth > 8 || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) { const found = deepFind(item, keys, depth + 1); if (found !== undefined && found !== null && String(found).trim()) return found; }
    return undefined;
  }
  for (const key of keys) { const direct = value[key]; if (direct !== undefined && direct !== null && String(direct).trim()) return direct; }
  for (const child of Object.values(value)) { const found = deepFind(child, keys, depth + 1); if (found !== undefined && found !== null && String(found).trim()) return found; }
  return undefined;
}

function mergeEncarDetail(offer: VehicleOffer, detail: any) {
  const vehicle = detail.vehicle || detail.Vehicle || detail;
  return normalizeVehicleOfferSpecs({
    ...offer,
    engineCc: offer.engineCc || num(deepFind(vehicle, ["displacement", "Displacement", "EngineDisplacement", "engineDisplacement", "cc"])),
    powerHp: offer.powerHp || num(deepFind(vehicle, ["power", "Power", "horsePower", "horsepower", "ps"])),
    fuel: offer.fuel || text(deepFind(vehicle, ["fuelType", "FuelType", "fuel", "Fuel"])),
    transmission: offer.transmission || text(deepFind(vehicle, ["transmission", "Transmission", "gearbox", "Gearbox"])),
    drive: offer.drive || text(deepFind(vehicle, ["drive", "Drive", "driveType", "DriveType", "drivetrain"])),
    bodyType: offer.bodyType || text(deepFind(vehicle, ["category", "Category", "bodyType", "BodyType", "carType"])),
    color: offer.color || text(deepFind(vehicle, ["color", "Color", "exteriorColor"])),
    productionDate: offer.productionDate || text(deepFind(vehicle, ["registrationDate", "RegistrationDate", "formYear", "productionDate"])),
    operational: { ...offer.operational, raw: { offer: offer.operational.raw, detail }, vin: text(deepFind(vehicle, ["vin", "VIN"])), frameNumber: text(deepFind(vehicle, ["frameNo", "FrameNo", "frameNumber"])) },
  } as VehicleOffer);
}

export class EncarDirectAdapter implements CatalogSourceAdapter {
  sourceId = "encar_direct";
  market: CatalogMarket = "korea";
  accessMode = "public_json" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const { url, offset, pageSize } = buildEncarListUrl(cursor);
    const json = await limiter(`${this.sourceId}:list`, Number(process.env.CATALOG_ENCAR_DIRECT_LIST_RPM || 10)).run(() => fetchPublicJson(url.toString(), { headers: ENCAR_HEADERS }));
    const items = json.SearchResults || json.searchResults || json.cars || json.items || [];
    const pagingNext = text(json.paging?.next || json.Paging?.next);
    const finished = !items.length || (items.length < pageSize && !pagingNext);
    return { items, count: json.Count || json.count, nextCursor: finished ? null : JSON.stringify({ offset: offset + pageSize, cursor: pagingNext }), finished };
  }

  mapStatus(): OfferStatus { return "active"; }

  normalizeOffer(raw: any): VehicleOffer | null {
    const id = text(raw.Id || raw.CarId || raw.carId);
    const make = text(raw.Manufacturer || raw.ManufacturerName || raw.maker);
    const model = text(raw.Model || raw.ModelName);
    const year = Number(text(raw.FormYear || raw.Year || raw.YearMonth).slice(0, 4));
    const price = normalizeEncarPrice(raw.Price);
    if (!id || !make || !model || !year) return null;
    const updatedAt = text(raw.ModifiedDate || raw.UpdatedDate) || nowIso();
    return normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, id), sourceId: this.sourceId, sourceOfferId: id, market: "korea", offerType: "fixed", status: "active", make, model,
      trim: [raw.Badge, raw.BadgeDetail].map(text).filter(Boolean).join(" "), year, productionDate: text(raw.RegistrationDate), mileageKm: num(raw.Mileage),
      engineCc: num(raw.displacement || raw.Displacement), fuel: text(raw.FuelType), transmission: text(raw.Transmission), drive: text(raw.DriveType || raw.Drive),
      bodyType: text(raw.Category), powerHp: num(raw.power || raw.Power), color: text(raw.color || raw.Color), sourcePrice: price, sourceCurrency: price ? "KRW" : null,
      priceMode: price ? "fixed" : "estimated", images: [], totalRub: null, calculationStatus: price ? "ready" : "needs_data", firstSeenAt: updatedAt, updatedAt,
      operational: { sourceUrl: `https://fem.encar.com/cars/detail/${id}`, sourceVenueName: text(raw.OfficeCityState), raw, vin: text(raw.Vin || raw.VIN), frameNumber: text(raw.FrameNo) },
    } as VehicleOffer);
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const detailUrl = `https://api.encar.com/v1/readside/vehicle/${offer.sourceOfferId}`;
    const detail = await limiter(`${this.sourceId}:detail`, Number(process.env.CATALOG_ENCAR_DIRECT_DETAIL_RPM || 30)).run(() => fetchPublicJson(detailUrl, { headers: ENCAR_HEADERS }));
    Object.assign(offer, mergeEncarDetail(offer, detail));
    const limit = Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 10);
    const saved: CatalogImage[] = [];
    for (const url of extractEncarImageUrls(offer, detail).slice(0, limit)) {
      const image = await limiter(`${this.sourceId}:image`, Number(process.env.CATALOG_ENCAR_DIRECT_IMAGE_RPM || 30)).run(() => cacheImageFromUrl(url, "korea", { headers: ENCAR_HEADERS }).catch(() => null));
      if (image) saved.push(image);
    }
    return saved.slice(0, limit);
  }

  async healthCheck() { return { ok: true, message: "health uses last import result; no extra full fetch", checkedAt: nowIso() }; }
}

function marketFromLocation(location: string): CatalogMarket | null {
  const value = location.toLowerCase();
  if (/japan|yokohama|kyushu|kobe|nagoya|osaka|tokyo/.test(value)) return "japan";
  if (/korea|busan|incheon|seoul/.test(value)) return "korea";
  if (/uae|dubai|sharjah/.test(value)) return "uae";
  return null;
}

export function parseBeForwardStocklist(html: string) {
  const cards = html.match(/<article[\s\S]*?<\/article>|<div[^>]+class="[^"]*(?:vehicle|stock|item)[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi) || [];
  return cards.map((card) => {
    const value = (pattern: RegExp) => text(card.match(pattern)?.[1]?.replace(/<[^>]+>/g, " "));
    const dd = (label: string) => value(new RegExp(`<dt[^>]*>\\s*${label}\\s*<\\/dt>\\s*<dd[^>]*>([^<]+)`, "i"));
    const href = card.match(/href="([^"]*\/stocklist[^"#?]*\/[^"]+|[^"]*\/auto\/[^"]+)"/i)?.[1] || card.match(/href="([^"]*\/vehicle\/[^"]+)"/i)?.[1];
    return {
      refNo: (text(card.match(/BF\d+/i)?.[0]) || value(/Ref\.?\s*No\.?[\s\S]{0,40}?(BF\d+)/i)).toUpperCase(),
      title: value(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i), make: dd("Make"), model: dd("Model"), year: dd("Year"), mileage: dd("Mileage"),
      engine: dd("Engine"), transmission: dd("Transmission"), fuel: dd("Fuel"), drive: dd("Drive"), body: dd("Body Type"), location: dd("Location"),
      price: value(/(?:Vehicle Price|FOB Price|Price)[\s\S]{0,80}US\$?\s*([0-9,]+)/i),
      images: [...card.matchAll(/<img[^>]+(?:src|data-src)="([^"]+)"/gi)].map((match) => match[1]),
      detailUrl: href ? new URL(href, "https://www.beforward.jp").toString() : "",
    };
  }).filter((row) => row.refNo || row.title);
}

export class BeForwardPublicAdapter implements CatalogSourceAdapter {
  sourceId = "beforward_public";
  market = "multi" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null) {
    const page = Number(cursor || 1);
    const url = new URL("https://www.beforward.jp/stocklist");
    url.searchParams.set("page", String(page));
    const { res, text: html } = await limiter(`${this.sourceId}:list`, Number(process.env.CATALOG_BEFORWARD_PUBLIC_LIST_RPM || 10)).run(() => fetchTextWithTimeout(url, { headers: { "user-agent": "AvtoCenaCatalog/1.0" } }));
    if ([401, 403, 429].includes(res.status) || BLOCK_RE.test(html.slice(0, 500))) throw blockError(`beforward_blocked_${res.status}`, res.status);
    const items = parseBeForwardStocklist(html);
    return { items, nextCursor: items.length ? String(page + 1) : null, finished: !items.length, health: { ok: true, message: `parsed ${items.length}`, checkedAt: nowIso(), httpStatus: res.status, contentType: res.headers.get("content-type") || "" } };
  }

  mapStatus(): OfferStatus { return "active"; }

  normalizeOffer(raw: any): VehicleOffer | null {
    const market = marketFromLocation(raw.location || "");
    if (!market) return null;
    const ref = text(raw.refNo || raw.title);
    const title = text(raw.title);
    const make = text(raw.make) || title.split(" ")[0];
    const model = text(raw.model) || title.split(" ").slice(1, 2).join(" ");
    const year = Number(text(raw.year).match(/\d{4}/)?.[0]);
    if (!ref || !make || !model || !year) return null;
    const price = num(raw.price);
    return normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, ref), sourceId: this.sourceId, sourceOfferId: ref, market, offerType: "fixed", status: "active", make, model, trim: title,
      year, mileageKm: num(raw.mileage), engineCc: num(raw.engine), fuel: text(raw.fuel), transmission: text(raw.transmission), drive: text(raw.drive), bodyType: text(raw.body),
      sourcePrice: price || null, sourceCurrency: price ? "USD" : null, priceMode: price ? "fixed" : "estimated", images: [], totalRub: null,
      calculationStatus: price ? "ready" : "needs_data", firstSeenAt: nowIso(), updatedAt: nowIso(), auctionGrade: text(raw.auctionGrade),
      operational: { sourceUrl: raw.detailUrl, sourceVenueName: raw.location, raw },
    } as VehicleOffer);
  }

  async fetchImages(offer: VehicleOffer) {
    const raw: any = offer.operational.raw || {};
    const saved: CatalogImage[] = [];
    for (const url of (raw.images || []).slice(0, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 10))) {
      const image = await limiter(`${this.sourceId}:image`, Number(process.env.CATALOG_BEFORWARD_PUBLIC_IMAGE_RPM || 30)).run(() => cacheImageFromUrl(new URL(url, "https://www.beforward.jp").toString(), offer.market).catch(() => null));
      if (image) saved.push(image);
    }
    return saved.slice(0, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 10));
  }

  async healthCheck() { return { ok: true, message: "health uses last import result; no extra fetch", checkedAt: nowIso() }; }
}

function mergeChe168Detail(offer: VehicleOffer, detail: any) {
  const value = detail.result || detail.data || detail;
  return normalizeVehicleOfferSpecs({
    ...offer, trim: offer.trim || text(value.specname || value.carname), transmission: offer.transmission || text(value.gearbox || value.transmission),
    drive: offer.drive || text(value.drivemode || value.drive), engineType: offer.engineType || text(value.engine), engineCc: offer.engineCc || num(value.displacement),
    fuel: offer.fuel || text(value.fuelname || value.fuel), powerHp: offer.powerHp || num(value.power || value.horsepower), bodyType: offer.bodyType || text(value.levelname || value.bodytype),
    color: offer.color || text(value.color), operational: { ...offer.operational, raw: { offer: offer.operational.raw, detail } },
  } as VehicleOffer);
}

export class Che168GlobalPublicAdapter implements CatalogSourceAdapter {
  sourceId = "che168_global";
  market: CatalogMarket = "china";
  accessMode = "public_json" as const;
  private deviceId = process.env.CATALOG_CHE168_GLOBAL_DEVICE_ID || crypto.createHash("sha256").update("avtocena-che168").digest("hex").slice(0, 16);
  private cachedBrands: string[] | null = null;

  private async brandIds() {
    if (this.cachedBrands) return this.cachedBrands;
    const configured = (process.env.CATALOG_CHE168_GLOBAL_BRAND_IDS || "").split(",").map((value) => value.trim()).filter(Boolean);
    if (configured.length) return this.cachedBrands = configured;
    const url = new URL("https://globalapi.che168.com/api/v1/brand");
    url.search = new URLSearchParams({ _appid: "global.pc", deviceid: this.deviceId }).toString();
    try {
      const json = await limiter(`${this.sourceId}:brand`, 10).run(() => fetchPublicJson(url.toString(), { headers: { "user-agent": "AvtoCenaCatalog/1.0" } }));
      const list = json.result?.brands || json.result?.brandlist || json.result || json.data || json.brandlist || [];
      const flat = (Array.isArray(list) ? list : Object.values(list)).flatMap((group: any) => Array.isArray(group) ? group : group?.brands || group?.items || [group]);
      return this.cachedBrands = flat.map((brand: any) => text(brand.bid || brand.id || brand.brandid || brand.brandId)).filter(Boolean).slice(0, Number(process.env.CATALOG_CHE168_GLOBAL_MAX_BRANDS || 3));
    } catch { return this.cachedBrands = []; }
  }

  async fetchPage(cursor?: string | null) {
    let state = cursor ? JSON.parse(cursor) as { brandIndex: number; pageIndex: number } : { brandIndex: 0, pageIndex: 1 };
    const brands = await this.brandIds();
    if (!brands.length) return { items: [], finished: true };
    while (state.brandIndex < brands.length) {
      const brandId = brands[state.brandIndex];
      const page = state.pageIndex;
      const url = new URL("https://globalapi.che168.com/api/v1/search");
      url.search = new URLSearchParams({ _appid: "global.pc", deviceid: this.deviceId, language: "en", pageindex: String(page), pagesize: String(process.env.CATALOG_CHE168_GLOBAL_PAGE_SIZE || 40), sort: "0", vehicle_list: "0", brandid: brandId }).toString();
      const json = await limiter(`${this.sourceId}:list`, Number(process.env.CATALOG_CHE168_GLOBAL_LIST_RPM || 10)).run(() => fetchPublicJson(url.toString(), { headers: { "user-agent": "AvtoCenaCatalog/1.0" } }));
      const items = json.result?.carlist || json.result?.list || json.data?.carlist || json.data?.list || json.carlist || json.list || [];
      if (!items.length) { state = { brandIndex: state.brandIndex + 1, pageIndex: 1 }; continue; }
      return { items, nextCursor: JSON.stringify({ brandIndex: state.brandIndex, pageIndex: page + 1 }), finished: false };
    }
    return { items: [], finished: true };
  }

  mapStatus(): OfferStatus { return "active"; }

  normalizeOffer(raw: any): VehicleOffer | null {
    const infoId = text(raw.infoid || raw.infoId);
    const make = text(raw.brandname);
    const model = text(raw.seriesname || raw.carname);
    const year = Number(text(raw.regdate || raw.year).match(/\d{4}/)?.[0]);
    if (!infoId || !make || !model || !year) return null;
    return normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, infoId), sourceId: this.sourceId, sourceOfferId: infoId, market: "china", offerType: "fixed", status: "active", make, model,
      trim: text(raw.specname || raw.carname), year, productionDate: text(raw.regdate), mileageKm: num(raw.mileage), engineCc: num(raw.displacement), fuel: text(raw.fuelname),
      transmission: text(raw.gearbox), drive: text(raw.drivemode), bodyType: text(raw.levelname), powerHp: num(raw.power), sourcePrice: null, sourceCurrency: null,
      priceMode: "estimated", images: [], totalRub: null, calculationStatus: "needs_data", firstSeenAt: nowIso(), updatedAt: nowIso(), operational: { sourceVenueName: text(raw.city), raw },
    } as VehicleOffer);
  }

  async fetchImages(offer: VehicleOffer) {
    const raw: any = offer.operational.raw || {};
    const cover = text(raw.imageurl || raw.pic || raw.cover);
    if (!cover) return [];
    const detailUrl = new URL(`https://globalapi.che168.com/api/v1/${offer.sourceOfferId}`);
    detailUrl.search = new URLSearchParams({ _appid: "global.pc", deviceid: this.deviceId, language: "en" }).toString();
    const detail = await limiter(`${this.sourceId}:detail`, 30).run(() => fetchPublicJson(detailUrl.toString(), { headers: { "user-agent": "AvtoCenaCatalog/1.0" } }).catch(() => null));
    if (detail) Object.assign(offer, mergeChe168Detail(offer, detail));
    const urls = [cover, ...(detail?.result?.piclist || detail?.data?.piclist || []).map((photo: any) => photo.url || photo.imageurl || photo)];
    const saved: CatalogImage[] = [];
    for (const url of urls.filter(Boolean).slice(0, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 10))) {
      const image = await limiter(`${this.sourceId}:image`, 30).run(() => cacheImageFromUrl(String(url).startsWith("http") ? String(url) : `https:${url}`, "china").catch(() => null));
      if (image) saved.push(image);
    }
    return saved.slice(0, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 10));
  }

  async healthCheck() { return { ok: true, message: "health uses last import result; no extra fetch", checkedAt: nowIso() }; }
}

export function parseCsv(textValue: string) {
  const source = textValue.replace(/^\uFEFF/, "");
  const candidates = [",", ";", "\t", "|"];
  const delimiter = candidates.map((candidate) => [candidate, (source.split("\n")[0].match(new RegExp(`\\${candidate}`, "g")) || []).length] as const).sort((left, right) => right[1] - left[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index], next = source[index + 1];
    if (character === '"' && quoted && next === '"') { cell += '"'; index++; }
    else if (character === '"') quoted = !quoted;
    else if (character === delimiter && !quoted) { row.push(cell); cell = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) { if (character === "\r" && next === "\n") index++; row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; }
    else cell += character;
  }
  row.push(cell); if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift()?.map((header) => header.trim()) || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

export class JsonPartnerFeedAdapter implements CatalogSourceAdapter {
  sourceId: string;
  market: CatalogMarket;
  accessMode = "partner_feed" as const;
  constructor(sourceId: string, market: CatalogMarket) { this.sourceId = sourceId; this.market = market; }
  get enabled() { return bool(process.env[envName(this.sourceId, "ENABLED")]); }

  async fetchPage() {
    if (!this.enabled) return { items: [], finished: true };
    const url = process.env[envName(this.sourceId, "FEED_URL")];
    if (!url) return { items: [], finished: true };
    const headers: Record<string, string> = {};
    const token = process.env[envName(this.sourceId, "TOKEN")] || process.env[envName(this.sourceId, "API_KEY")];
    if (token) headers.authorization = `Bearer ${token}`;
    const { res, json } = await fetchJsonBodyWithTimeout(url, { headers });
    if (!res.ok) throw new Error(`feed_${this.sourceId}_${res.status}`);
    return { items: Array.isArray(json) ? json : json.items || json.offers || [], nextCursor: json.nextCursor || null, finished: !json.nextCursor };
  }

  mapStatus(raw: any): OfferStatus { return ["sold", "removed", "stale"].includes(text(raw.status)) ? text(raw.status) as OfferStatus : "active"; }

  normalizeOffer(raw: any): VehicleOffer | null {
    const sourceOfferId = text(raw.id || raw.sourceOfferId || raw.lotNumber);
    const make = text(raw.make || raw.brand);
    const model = text(raw.model);
    const year = num(raw.year);
    if (!sourceOfferId || !make || !model || !year) return null;
    const price = num(raw.sourcePrice || raw.price) || null;
    const currency = price ? text(raw.sourceCurrency || raw.currency || (this.market === "japan" ? "JPY" : "KRW")).toUpperCase() : null;
    const now = nowIso();
    return normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, sourceOfferId), sourceId: this.sourceId, sourceOfferId, market: this.market, offerType: raw.offerType === "auction" ? "auction" : "fixed",
      status: this.mapStatus(raw), make, model, generation: text(raw.generation), trim: text(raw.trim), year, productionDate: text(raw.productionDate), mileageKm: num(raw.mileageKm || raw.mileage),
      engineCc: num(raw.engineCc), fuel: text(raw.fuel), transmission: text(raw.transmission), drive: text(raw.drive), bodyType: text(raw.bodyType || raw.body), powerHp: num(raw.powerHp),
      color: text(raw.color), auctionDate: text(raw.auctionDate), lotNumber: text(raw.lotNumber), auctionGrade: text(raw.auctionGrade), sourcePrice: price, sourceCurrency: currency,
      priceMode: raw.priceMode === "auction_start" || raw.offerType === "auction" ? "auction_start" : price ? "fixed" : "estimated", images: [], totalRub: null,
      calculationStatus: price ? raw.offerType === "auction" ? "auction_start" : "ready" : "needs_data", firstSeenAt: text(raw.firstSeenAt) || now, updatedAt: text(raw.updatedAt) || now,
      expiresAt: text(raw.expiresAt), operational: { sourceUrl: text(raw.sourceUrl), sourceVenueName: text(raw.sourceVenueName), raw },
    } as VehicleOffer);
  }

  async fetchImages(offer: VehicleOffer) {
    if (!bool(process.env[envName(this.sourceId, "IMAGE_CACHING_ENABLED")])) return [];
    const raw: any = offer.operational.raw || {};
    const urls = Array.isArray(raw.images) ? raw.images : Array.isArray(raw.imageUrls) ? raw.imageUrls : [];
    const saved = await Promise.all(urls.slice(0, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 10)).map((url: string) => cacheImageFromUrl(url, offer.market).catch(() => null)));
    return saved.filter(Boolean) as CatalogImage[];
  }

  async healthCheck() { return { ok: true, message: "partner adapter configured for future feeds", checkedAt: nowIso() }; }
}

export class CsvPartnerFeedAdapter extends JsonPartnerFeedAdapter {
  async fetchPage(cursor?: string | null) {
    if (!this.enabled) return { items: [], finished: true };
    const url = process.env[envName(this.sourceId, "FEED_URL")];
    if (!url) return { items: [], finished: true };
    const page = Number(cursor || 1), pageSize = Number(process.env[envName(this.sourceId, "PAGE_SIZE")] || 500);
    const { res, text: body } = await fetchTextWithTimeout(url);
    if (!res.ok) throw new Error(`csv_${res.status}`);
    const rows = parseCsv(body);
    const start = (page - 1) * pageSize;
    return { items: rows.slice(start, start + pageSize), nextCursor: start + pageSize < rows.length ? String(page + 1) : null, finished: start + pageSize >= rows.length, count: rows.length };
  }
}

export const catalogSources = [
  new EncarDirectAdapter(),
  new BeForwardPublicAdapter(),
  new Che168GlobalPublicAdapter(),
  ...openMarketSources,
  new JsonPartnerFeedAdapter("japan_partner", "japan"),
  new JsonPartnerFeedAdapter("korea_partner", "korea"),
  new JsonPartnerFeedAdapter("generic_json", "japan"),
  new CsvPartnerFeedAdapter("generic_csv", "korea"),
];

export const sourceRegistry = {
  japan: catalogSources.filter((source) => source.market === "japan" || source.market === "multi"),
  korea: catalogSources.filter((source) => source.market === "korea" || source.market === "multi"),
  china: catalogSources.filter((source) => source.market === "china"),
  uae: catalogSources.filter((source) => source.market === "uae" || source.market === "multi"),
  europe: catalogSources.filter((source) => source.market === "europe"),
};

export async function calculateOffer(offer: VehicleOffer) {
  return pricedOffer(normalizeVehicleOfferSpecs(offer) as VehicleOffer);
}

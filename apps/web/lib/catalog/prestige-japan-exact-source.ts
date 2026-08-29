import { stableOfferId } from "./storage";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, SourceRunHealth, VehicleOffer } from "./types";

const BASE = "https://prestigemotorsport.com.au";
const LANDING = `${BASE}/auctions/`;
const AJAX = `${BASE}/wp-admin/admin-ajax.php`;
const DETAIL_RE = /^https:\/\/prestigemotorsport\.com\.au\/auction-vehicle-display\/\?car_id=([A-Za-z0-9_-]+)$/;
const EXACT_IMAGE_RE = /^https:\/\/(?:\d+\.)?ajes\.com\/imgs\/[A-Za-z0-9_-]+$/i;
const JAPAN_MIN_MODEL_YEAR = 2010;
const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
const PREFERRED_MODELS = [
  "ALPHARD", "PRIUS", "COROLLA", "RAV4", "HARRIER", "VELLFIRE", "AQUA", "YARIS", "CROWN", "CAMRY", "NOAH", "VOXY", "SIENTA",
  "NOTE", "SERENA", "X-TRAIL", "KICKS", "LEAF", "ELGRAND", "SKYLINE",
  "FIT", "VEZEL", "FREED", "N-BOX", "STEPWGN", "CR-V", "CIVIC", "ACCORD",
  "CX-3", "CX-30", "CX-5", "CX-8", "MAZDA2", "MAZDA3", "ROADSTER",
  "FORESTER", "IMPREZA", "XV", "LEVORG", "OUTBACK",
  "OUTLANDER", "DELICA D5", "ECLIPSE CROSS", "RVR",
  "SWIFT", "SOLIO", "SPACIA", "HUSTLER", "JIMNY", "WAGON R", "ALTO",
  "TANTO", "MOVE", "MIRA", "ROCKY", "THOR",
  "CT", "IS", "ES", "NX", "RX", "UX",
];
const MACHINERY_MODEL_RE = /(?:FORK|FORKLIFT|LOADER|EXCAVATOR|TRACTOR|CRANE|DUMP|TRUCK|BUS|COASTER|DYNA|TOYOACE|DUTRO|CANTER|ELF|FORWARD|GIGA|PROFIA|FD\d|FG\d|FGL|FDL|SDK)/i;

type MakeOption = { value: string; name: string };
type ModelOption = { id: string; extId: string; name: string };
export type PrestigeJapanExactRow = {
  carId: string;
  sourceUrl: string;
  sourceTitle: string;
  make: string;
  model: string;
  trim?: string;
  year: number;
  mileageKm?: number;
  engineCc?: number;
  transmission?: string;
  color?: string;
  frameNumber?: string;
  auctionDate?: string;
  lotNumber?: string;
  auctionName?: string;
  auctionGrade?: string;
  startPrice?: number;
  finalPrice: number;
  currentStatus: "Sold";
  images: string[];
  coverContentVerified?: boolean;
  rawFields: Record<string, string>;
};

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function absolute(value: string, base = BASE) {
  try { return new URL(String(value || "").replace(/&amp;/g, "&"), base).toString(); }
  catch { return ""; }
}
function escaped(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function positiveInteger(value: unknown) {
  const n = Number(String(value ?? "").replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
function yen(value: unknown) {
  const match = clean(value).match(/([0-9][0-9,]*)\s*(?:YEN|JPY)\b/i);
  const n = Number(String(match?.[1] || "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function isoDate(value: unknown) {
  const match = clean(value).match(/\b(\d{1,2})-(\d{1,2})-((?:19|20)\d{2})\b/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : undefined;
}
function tableValue(markup: string, label: string) {
  const re = new RegExp(`<tr\\b[^>]*>[\\s\\S]*?<td\\b[^>]*>\\s*<strong>\\s*${escaped(label)}\\s*<\\/strong>\\s*<\\/td>\\s*<td\\b[^>]*>([\\s\\S]*?)<\\/td>`, "i");
  return clean(markup.match(re)?.[1] || "");
}
function exactAuctionGrade(value: unknown) {
  const grade = clean(value).match(/^((?:[0-6](?:\.5)?|R|RA|A\d?|S))\b/i)?.[1] || "";
  return grade ? grade.toUpperCase() : undefined;
}
function makeOptions(markup: string): MakeOption[] {
  const select = markup.match(/<select\b[^>]*id=["']marka_id["'][^>]*>([\s\S]*?)<\/select>/i)?.[1] || "";
  const rows = [...select.matchAll(/<option\b([^>]*)value=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/option>/gi)]
    .map((match) => ({ value: clean(match[2]), name: clean((`${match[1]} ${match[3]}`).match(/data-name=["']([^"']+)/i)?.[1] || match[4]) }))
    .filter((row) => row.value && row.name && !/^(?:all|select)/i.test(row.name));
  const preferred = ["TOYOTA", "NISSAN", "HONDA", "MAZDA", "SUBARU", "MITSUBISHI", "SUZUKI", "DAIHATSU", "LEXUS", "ISUZU"];
  return rows.sort((left, right) => {
    const li = preferred.indexOf(left.name.toUpperCase());
    const ri = preferred.indexOf(right.name.toUpperCase());
    if (li >= 0 || ri >= 0) return (li < 0 ? 999 : li) - (ri < 0 ? 999 : ri);
    return left.name.localeCompare(right.name);
  });
}
function modelRank(name: string) {
  const normalized = clean(name).toUpperCase();
  const preferred = PREFERRED_MODELS.indexOf(normalized);
  if (preferred >= 0) return preferred;
  if (MACHINERY_MODEL_RE.test(normalized)) return 50_000;
  if (/^[A-Z][A-Z0-9 -]{1,40}$/.test(normalized)) return 10_000;
  return 30_000;
}
function modelOptions(payload: any): ModelOption[] {
  const rows: ModelOption[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(payload?.models) ? payload.models : []) {
    const extId = clean(item?.ext_id);
    const id = clean(item?.id);
    const name = clean(item?.name);
    if (!extId || !name || seen.has(extId)) continue;
    seen.add(extId);
    rows.push({ id, extId, name });
  }
  return rows.sort((left, right) => modelRank(left.name) - modelRank(right.name) || left.name.localeCompare(right.name));
}
function carLinks(markup: string) {
  return [...new Set([...markup.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map((match) => absolute(match[1], LANDING)).filter((url) => DETAIL_RE.test(url)))];
}
function exactImages(markup: string, base: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) values.push(absolute(match[1], base));
  return [...new Set(values.filter((url) => EXACT_IMAGE_RE.test(url)))].slice(0, 30);
}
export type PrestigeJapanImageProbeKind = "vehicle" | "placeholder" | "unknown";
export function prestigeJapanImageProbeKind(contentTypeValue: unknown, bytesValue: Uint8Array | number[]) : PrestigeJapanImageProbeKind {
  const contentType = clean(contentTypeValue).toLowerCase().split(";")[0];
  const bytes = bytesValue instanceof Uint8Array ? bytesValue : new Uint8Array(bytesValue || []);
  const gif = bytes.length >= 6
    && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
    && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61;
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/gif" || gif) return "placeholder";
  if (contentType === "image/jpeg" && jpeg) return "vehicle";
  return "unknown";
}
async function probeExactImage(url: string): Promise<PrestigeJapanImageProbeKind> {
  const attempts = Math.max(1, Math.min(3, Number(process.env.PRESTIGE_JAPAN_IMAGE_PROBE_ATTEMPTS || 2)));
  const timeout = Math.max(4_000, Number(process.env.PRESTIGE_JAPAN_IMAGE_PROBE_TIMEOUT_MS || 12_000));
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { ...HEADERS, accept: "image/avif,image/webp,image/jpeg,image/*,*/*;q=0.8", range: "bytes=0-5", referer: LANDING },
        redirect: "follow",
        signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const kind = prestigeJapanImageProbeKind(response.headers.get("content-type"), bytes.subarray(0, 6));
      if (kind !== "unknown") return kind;
    } catch { /* retry isolated AJES probe */ }
  }
  return "unknown";
}
function plainVehicleTitle(markup: string, year: number) {
  const text = clean(markup);
  return clean(text.match(new RegExp(`Japanese Auction Vehicle Details\\s+(.{3,180}?)\\s+Year\\s+${year}\\b`, "i"))?.[1] || "").slice(0, 180);
}
function trimFromTitle(title: string, year: number, make: string, model: string) {
  const trim = clean(title.replace(new RegExp(`^${year}\\s+${escaped(make)}\\s+${escaped(model)}\\s*`, "i"), ""));
  return trim && trim.toUpperCase() !== model.toUpperCase() ? trim : undefined;
}
function image(url: string): CatalogImage { return { id: "", url, objectKey: "", checksum: "", size: 0, mimeType: "image/jpeg" }; }
export function canonicalPrestigeJapanIdentity(makeValue: unknown, modelValue: unknown) {
  const make = clean(makeValue);
  const model = clean(modelValue);
  const miniModel = model.match(/^MINI(?:\s+(.+))?$/i);
  if (make.toUpperCase() !== "BMW" || !miniModel) return { make, model };

  // Prestige groups MINI underneath its parent company BMW. Public catalog
  // identity follows the vehicle marque instead: MINI is a separate brand.
  // Keep an exact bare MINI model instead of guessing Cooper from the photo.
  return { make: "MINI", model: clean(miniModel[1]) || "MINI" };
}
function parseCursor(cursor?: string | null) {
  const value = String(cursor || "0:0:0");
  const full = value.match(/^(\d+):(\d+):(\d+)$/);
  if (full) return { makeIndex: Number(full[1]), modelIndex: Number(full[2]), offset: Number(full[3]) };
  const legacy = value.match(/^(\d+):(\d+)$/);
  return { makeIndex: Number(legacy?.[1] || 0), modelIndex: 0, offset: Number(legacy?.[2] || 0) };
}
function encodeCursor(makeIndex: number, modelIndex: number, offset: number) { return `${Math.max(0, makeIndex)}:${Math.max(0, modelIndex)}:${Math.max(0, offset)}`; }
export function prestigeJapanGithubEgressRequest(url: string, init?: RequestInit) {
  const enabled = /^(?:1|true|yes)$/i.test(String(process.env.GITHUB_ACTIONS || ""))
    && !/^(?:1|true|yes)$/i.test(String(process.env.PRESTIGE_JAPAN_DISABLE_EGRESS || ""));
  if (!enabled) return { url, init };
  const configured = String(process.env.CATALOG_YANDEX_SOURCE_BRIDGE_ORIGIN || "https://avtocena.com").trim();
  let origin = "https://avtocena.com";
  try { const parsed = new URL(configured); if (parsed.protocol === "https:") origin = parsed.origin; } catch { /* fixed safe default */ }
  const endpoint = `${origin}/api/internal/prestige-egress-c1e8b2`;
  if (url === LANDING) return { url: `${endpoint}?kind=landing`, init: { ...init, method: "GET" } };
  if (url === AJAX && String(init?.method || "GET").toUpperCase() === "POST") return { url: `${endpoint}?kind=ajax`, init };
  const carId = url.match(DETAIL_RE)?.[1];
  if (carId) return { url: `${endpoint}?kind=detail&carId=${encodeURIComponent(carId)}`, init: { ...init, method: "GET" } };
  return { url, init };
}
async function request(url: string, init?: RequestInit) {
  const timeout = Math.max(8_000, Number(process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS || 30_000));
  const attempts = Math.max(1, Math.min(5, Number(process.env.PRESTIGE_JAPAN_REQUEST_ATTEMPTS || 3)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const routed = prestigeJapanGithubEgressRequest(url, init);
      const response = await fetch(routed.url, { ...routed.init, headers: { ...HEADERS, ...(routed.init?.headers || {}) }, redirect: "follow", signal: AbortSignal.timeout(timeout) });
      const body = await response.text();
      if (!response.ok) throw new Error(`prestige_japan_exact_http_${response.status}:${url}`);
      return { response, body };
    } catch (error) {
      lastError = error;
      const retryable = /fetch failed|socket|timeout|ECONN|EAI_AGAIN|prestige_japan_exact_http_(?:403|408|425|429|500|502|503|504)/i.test(String((error as Error)?.message || error));
      if (!retryable || attempt >= attempts) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(10_000, 750 * (2 ** (attempt - 1)))));
    }
  }
  throw lastError;
}
async function poolMap<T, R>(rows: T[], limit: number, worker: (row: T) => Promise<R | null>) {
  const result: R[] = [];
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, async () => {
    while (true) {
      const current = index++;
      if (current >= rows.length) return;
      try { const value = await worker(rows[current]); if (value != null) result.push(value); } catch { /* isolate lot failure */ }
    }
  }));
  return result;
}

export function parsePrestigeJapanExactDetail(markup: string, url: string): PrestigeJapanExactRow | null {
  const identity = url.match(DETAIL_RE)?.[1] || "";
  if (!identity) return null;
  const rawFields: Record<string, string> = {};
  for (const label of ["Year", "Make", "Model", "Trans", "Kms", "Capacity", "Colour", "Extras", "Grade", "Chassis", "Auction Date", "Auction Time", "Number", "Location", "Start Price", "Final Price", "Current Status"]) rawFields[label] = tableValue(markup, label);
  const finalPrice = yen(rawFields["Final Price"]);
  if (rawFields["Current Status"] !== "Sold" || !(finalPrice > 0)) return null;
  const year = Number(rawFields.Year.match(/\b((?:19|20)\d{2})\b/)?.[1] || 0);
  const sourceMake = clean(rawFields.Make);
  const sourceModel = clean(rawFields.Model);
  const canonicalIdentity = canonicalPrestigeJapanIdentity(sourceMake, sourceModel);
  const make = canonicalIdentity.make;
  const model = canonicalIdentity.model;
  if (year < JAPAN_MIN_MODEL_YEAR || !make || !model) return null;
  const images = exactImages(markup, url);
  const sourceTitle = plainVehicleTitle(markup, year) || `${year} ${sourceMake} ${sourceModel}`;
  return {
    carId: identity, sourceUrl: url, sourceTitle, make, model, trim: trimFromTitle(sourceTitle, year, sourceMake, sourceModel), year,
    mileageKm: positiveInteger(rawFields.Kms), engineCc: positiveInteger(rawFields.Capacity), transmission: rawFields.Trans || undefined,
    color: rawFields.Colour || undefined, frameNumber: rawFields.Chassis || undefined, auctionDate: isoDate(rawFields["Auction Date"]),
    lotNumber: rawFields.Number || undefined, auctionName: rawFields.Location || undefined, auctionGrade: exactAuctionGrade(rawFields.Grade),
    startPrice: yen(rawFields["Start Price"]) || undefined, finalPrice, currentStatus: "Sold", images, rawFields,
  };
}

export class PrestigeJapanExactSource implements CatalogSourceAdapter {
  sourceId = "prestige_japan_auctions_open";
  market = "japan" as const;
  accessMode = "public_html" as const;
  private makesPromise: Promise<MakeOption[]> | null = null;
  private modelsByMake = new Map<string, Promise<ModelOption[]>>();

  private async makes() {
    if (!this.makesPromise) this.makesPromise = request(LANDING).then(({ body }) => makeOptions(body));
    return this.makesPromise;
  }
  private async models(make: MakeOption) {
    if (!this.modelsByMake.has(make.value)) {
      this.modelsByMake.set(make.value, (async () => {
        const body = new URLSearchParams({ action: "search_model_car", marka_id: make.value, "auction-date": "Past" }).toString();
        const response = await request(AJAX, { method: "POST", body, headers: { accept: "application/json,text/plain,*/*", "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest", origin: BASE, referer: LANDING } });
        let payload: any = null;
        try { payload = JSON.parse(response.body); } catch { payload = null; }
        return modelOptions(payload);
      })());
    }
    return this.modelsByMake.get(make.value)!;
  }
  private async exactDetail(url: string) {
    if (!DETAIL_RE.test(url)) return null;
    const { body } = await request(url, { headers: { referer: LANDING } });
    const row = parsePrestigeJapanExactDetail(body, url);
    if (!row || row.images.length < 5) return row;

    // AJES serves its visual `NO FOTO` card behind opaque /imgs/<token> URLs.
    // The URL therefore looks identical to a real auction photo and cannot be
    // filtered by pathname. A six-byte ranged GET is enough to distinguish the
    // verified JPEG vehicle cover from AJES' GIF placeholder without downloading
    // the full image. Fail closed when the source cannot verify the cover.
    const coverKind = await probeExactImage(row.images[0]);
    if (coverKind !== "vehicle") return null;
    row.coverContentVerified = true;
    return row;
  }
  private async searchPage(make: MakeOption, model: ModelOption, offset: number) {
    const params = new URLSearchParams();
    params.set("action", "search_results_car_dev"); params.set("limit_start", String(offset)); params.set("auction-date", "Past");
    params.set("year_from", String(JAPAN_MIN_MODEL_YEAR)); params.set("year_to", String(new Date().getUTCFullYear() + 1)); params.set("marka_id", make.value); params.set("model_id", model.extId);
    params.append("auction_name[]", "2");
    const { response, body } = await request(AJAX, { method: "POST", body: params.toString(), headers: { accept: "application/json,text/plain,*/*", "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest", origin: BASE, referer: LANDING } });
    let payload: any = null;
    try { payload = JSON.parse(body); } catch { payload = null; }
    const html = String(payload?.cars_html || "");
    return { response, links: carLinks(html), total: Math.max(0, Number(payload?.total || 0)) };
  }

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const makes = await this.makes();
    if (!makes.length) throw new Error("prestige_japan_exact_no_make_options");
    let { makeIndex, modelIndex, offset } = parseCursor(cursor);
    const detailConcurrency = Math.max(1, Math.min(5, Number(process.env.PRESTIGE_JAPAN_DETAIL_CONCURRENCY || 4)));
    const searchPagesPerFetch = Math.max(1, Math.min(10, Number(process.env.PRESTIGE_JAPAN_SEARCH_PAGES_PER_FETCH || 4)));
    const desiredSoldRows = Math.max(1, Math.min(20, Number(process.env.PRESTIGE_JAPAN_DESIRED_SOLD_PER_FETCH || 6)));
    const accepted: PrestigeJapanExactRow[] = [];
    let scannedSearchPages = 0;
    let scannedLinks = 0;
    let lastHttpStatus = 200;
    let lastContentType = "";
    let lastLabel = "";
    let lastTotal = 0;
    const startCursor = encodeCursor(makeIndex, modelIndex, offset);

    while (makeIndex < makes.length && scannedSearchPages < searchPagesPerFetch && accepted.length < desiredSoldRows) {
      const make = makes[makeIndex];
      const models = await this.models(make);
      if (!models.length || modelIndex >= models.length) { makeIndex++; modelIndex = 0; offset = 0; continue; }
      const model = models[modelIndex];
      lastLabel = `${make.name} ${model.name}`;
      const page = await this.searchPage(make, model, offset);
      lastHttpStatus = page.response.status; lastContentType = page.response.headers.get("content-type") || ""; lastTotal = page.total;
      scannedSearchPages++; scannedLinks += page.links.length;
      if (!page.links.length) { modelIndex++; offset = 0; continue; }
      const rows = await poolMap(page.links, detailConcurrency, (link) => this.exactDetail(link));
      for (const row of rows) if (!accepted.some((item) => item.carId === row.carId)) accepted.push(row);
      const nextOffset = offset + 20;
      const exhaustedModel = page.total > 0 ? nextOffset >= page.total : page.links.length < 20;
      if (exhaustedModel) { modelIndex++; offset = 0; } else { offset = nextOffset; }
    }

    const finished = makeIndex >= makes.length;
    const nextCursor = finished ? null : encodeCursor(makeIndex, modelIndex, offset);
    return {
      items: accepted, nextCursor, finished, count: accepted.length,
      health: { ok: true, message: `Prestige exact non-USS cursor=${startCursor} next=${nextCursor || "end"} source=${lastLabel || "end"} searchPages=${scannedSearchPages} links=${scannedLinks} sold=${accepted.length} total=${lastTotal}`, checkedAt: new Date().toISOString(), httpStatus: lastHttpStatus, contentType: lastContentType },
    };
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as PrestigeJapanExactRow;
    if (!row?.carId || !row.sourceUrl || row.currentStatus !== "Sold" || !(row.finalPrice > 0) || !row.make || !row.model || row.year < JAPAN_MIN_MODEL_YEAR) return null;
    const now = new Date().toISOString();
    return {
      id: stableOfferId(this.sourceId, row.carId), sourceId: this.sourceId, sourceOfferId: row.carId, market: "japan", offerType: "auction", status: "active",
      catalogKind: "auction_result", auctionResult: "sold", auctionPriceKind: "published_result", sourceTitle: row.sourceTitle, make: row.make, model: row.model, trim: row.trim,
      year: row.year, mileageKm: row.mileageKm, engineCc: row.engineCc, transmission: row.transmission, color: row.color, frameNumber: row.frameNumber,
      auctionName: row.auctionName, auctionDate: row.auctionDate, lotNumber: row.lotNumber, auctionGrade: row.auctionGrade,
      sourcePrice: row.finalPrice, sourceCurrency: "JPY", priceMode: "fixed", images: row.images.map(image), calculationStatus: "needs_data", firstSeenAt: now, updatedAt: now,
      operational: {
        sourceUrl: row.sourceUrl, sourceVenueName: row.auctionName || "Prestige Motorsport Japan Auctions", exactDetail: true, photoIdentityVerified: true,
        sourceOnlyFieldsPreserved: true, auctionResultPriceVerified: true, resultPriceVerified: true, galleryVerified: row.coverContentVerified === true && row.images.length >= 5, gallerySafetyMode: "prestige_ajes_exact_detail_v2_cover_content_verified",
        raw: { detailIdentityVerified: true, photoIdentityVerified: true, listingBoundImages: true, coverContentVerified: row.coverContentVerified === true, carId: row.carId, currentStatus: row.currentStatus, finalPriceJpy: row.finalPrice, startPriceJpy: row.startPrice, fields: row.rawFields, images: row.images },
      },
    };
  }
  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const raw = offer.operational?.raw && typeof offer.operational.raw === "object" ? offer.operational.raw as Record<string, unknown> : {};
    const urls = [...new Set((Array.isArray(raw.images) ? raw.images : [])
      .map((value: unknown) => clean(value))
      .filter((url: string) => EXACT_IMAGE_RE.test(url)))].slice(0, 30);
    const concurrency = Math.max(1, Math.min(8, Number(process.env.PRESTIGE_JAPAN_IMAGE_PROBE_CONCURRENCY || 6)));
    const verified: string[] = [];
    for (let start = 0; start < urls.length; start += concurrency) {
      const batch = urls.slice(start, start + concurrency);
      const kinds = await Promise.all(batch.map((url) => probeExactImage(url)));
      for (let index = 0; index < batch.length; index++) if (kinds[index] === "vehicle") verified.push(batch[index]);
    }
    const galleryVerified = verified.length >= 5;
    raw.images = verified;
    raw.galleryContentVerified = galleryVerified;
    raw.photoIdentityVerified = galleryVerified;
    raw.listingBoundImages = true;
    offer.operational = {
      ...(offer.operational || {}),
      galleryVerified,
      photoIdentityVerified: galleryVerified,
      galleryImageCount: verified.length,
      gallerySourceImageCount: urls.length,
      galleryRefreshedAt: new Date().toISOString(),
      gallerySafetyMode: "prestige_ajes_exact_detail_v2_cover_content_verified",
      raw,
    } as any;
    return galleryVerified ? verified.map(image) : [];
  }
  mapStatus(): OfferStatus { return "active"; }
  async healthCheck(): Promise<SourceRunHealth> {
    try { const page = await this.fetchPage(null); return page.health || { ok: true, message: `Prestige exact sold=${page.items.length}`, checkedAt: new Date().toISOString() }; }
    catch (error) { return { ok: false, message: String((error as Error)?.message || error), checkedAt: new Date().toISOString() }; }
  }
}

export const prestigeJapanExactSource = new PrestigeJapanExactSource();

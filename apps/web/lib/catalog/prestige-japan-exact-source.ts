import { stableOfferId } from "./storage";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, SourceRunHealth, VehicleOffer } from "./types";

const BASE = "https://prestigemotorsport.com.au";
const LANDING = `${BASE}/auctions/`;
const AJAX = `${BASE}/wp-admin/admin-ajax.php`;
const DETAIL_RE = /^https:\/\/prestigemotorsport\.com\.au\/auction-vehicle-display\/\?car_id=([A-Za-z0-9_-]+)$/;
const EXACT_IMAGE_RE = /^https:\/\/(?:\d+\.)?ajes\.com\/imgs\/[A-Za-z0-9_-]+$/i;
const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

type MakeOption = { value: string; name: string };
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
  const text = clean(value);
  const match = text.match(/([0-9][0-9,]*)\s*(?:YEN|JPY)\b/i);
  const n = Number(String(match?.[1] || "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function isoDate(value: unknown) {
  const match = clean(value).match(/\b(\d{1,2})-(\d{1,2})-((?:19|20)\d{2})\b/);
  if (!match) return undefined;
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}
function tableValue(markup: string, label: string) {
  const re = new RegExp(`<tr\\b[^>]*>[\\s\\S]*?<td\\b[^>]*>\\s*<strong>\\s*${escaped(label)}\\s*<\\/strong>\\s*<\\/td>\\s*<td\\b[^>]*>([\\s\\S]*?)<\\/td>`, "i");
  return clean(markup.match(re)?.[1] || "");
}
function makeOptions(markup: string): MakeOption[] {
  const select = markup.match(/<select\b[^>]*id=["']marka_id["'][^>]*>([\s\S]*?)<\/select>/i)?.[1] || "";
  const rows = [...select.matchAll(/<option\b([^>]*)value=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/option>/gi)]
    .map((match) => ({
      value: clean(match[2]),
      name: clean((`${match[1]} ${match[3]}`).match(/data-name=["']([^"']+)/i)?.[1] || match[4]),
    }))
    .filter((row) => row.value && row.name && !/^(?:all|select)/i.test(row.name));
  const preferred = ["TOYOTA", "NISSAN", "HONDA", "MAZDA", "SUBARU", "MITSUBISHI", "SUZUKI", "DAIHATSU", "LEXUS", "ISUZU"];
  return rows.sort((left, right) => {
    const li = preferred.indexOf(left.name.toUpperCase());
    const ri = preferred.indexOf(right.name.toUpperCase());
    if (li >= 0 || ri >= 0) return (li < 0 ? 999 : li) - (ri < 0 ? 999 : ri);
    return left.name.localeCompare(right.name);
  });
}
function carLinks(markup: string) {
  return [...new Set(
    [...markup.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)]
      .map((match) => absolute(match[1], LANDING))
      .filter((url) => DETAIL_RE.test(url)),
  )];
}
function exactImages(markup: string, base: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) values.push(absolute(match[1], base));
  return [...new Set(values.filter((url) => EXACT_IMAGE_RE.test(url)))].slice(0, 30);
}
function plainVehicleTitle(markup: string, year: number) {
  const text = clean(markup);
  const match = text.match(new RegExp(`Japanese Auction Vehicle Details\\s+(.{3,180}?)\\s+Year\\s+${year}\\b`, "i"));
  return clean(match?.[1] || "").slice(0, 180);
}
function trimFromTitle(title: string, year: number, make: string, model: string) {
  const prefix = new RegExp(`^${year}\\s+${escaped(make)}\\s+${escaped(model)}\\s*`, "i");
  const trim = clean(title.replace(prefix, ""));
  return trim && trim.toUpperCase() !== model.toUpperCase() ? trim : undefined;
}
function image(url: string): CatalogImage {
  return { id: "", url, objectKey: "", checksum: "", size: 0, mimeType: "image/jpeg" };
}
function parseCursor(cursor?: string | null) {
  const match = String(cursor || "0:0").match(/^(\d+):(\d+)$/);
  return { makeIndex: Math.max(0, Number(match?.[1] || 0)), offset: Math.max(0, Number(match?.[2] || 0)) };
}
function encodeCursor(makeIndex: number, offset: number) { return `${Math.max(0, makeIndex)}:${Math.max(0, offset)}`; }
async function request(url: string, init?: RequestInit) {
  const timeout = Math.max(8_000, Number(process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS || 30_000));
  const response = await fetch(url, {
    ...init,
    headers: { ...HEADERS, ...(init?.headers || {}) },
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`prestige_japan_exact_http_${response.status}:${url}`);
  return { response, body };
}
async function poolMap<T, R>(rows: T[], limit: number, worker: (row: T) => Promise<R | null>) {
  const result: R[] = [];
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, async () => {
    while (true) {
      const current = index++;
      if (current >= rows.length) return;
      try {
        const value = await worker(rows[current]);
        if (value != null) result.push(value);
      } catch { /* one unavailable lot must not rewrite or poison another lot */ }
    }
  }));
  return result;
}

export function parsePrestigeJapanExactDetail(markup: string, url: string): PrestigeJapanExactRow | null {
  const identity = url.match(DETAIL_RE)?.[1] || "";
  if (!identity) return null;
  const rawFields: Record<string, string> = {};
  for (const label of ["Year", "Make", "Model", "Trans", "Kms", "Capacity", "Colour", "Extras", "Grade", "Chassis", "Auction Date", "Auction Time", "Number", "Location", "Start Price", "Final Price", "Current Status"]) {
    rawFields[label] = tableValue(markup, label);
  }
  const currentStatus = rawFields["Current Status"];
  const finalPrice = yen(rawFields["Final Price"]);
  if (currentStatus !== "Sold" || !(finalPrice > 0)) return null;
  const year = Number(rawFields.Year.match(/\b((?:19|20)\d{2})\b/)?.[1] || 0);
  const make = clean(rawFields.Make);
  const model = clean(rawFields.Model);
  if (!year || !make || !model) return null;
  const images = exactImages(markup, url);
  const sourceTitle = plainVehicleTitle(markup, year) || `${year} ${make} ${model}`;
  return {
    carId: identity,
    sourceUrl: url,
    sourceTitle,
    make,
    model,
    trim: trimFromTitle(sourceTitle, year, make, model),
    year,
    mileageKm: positiveInteger(rawFields.Kms),
    engineCc: positiveInteger(rawFields.Capacity),
    transmission: rawFields.Trans || undefined,
    color: rawFields.Colour || undefined,
    frameNumber: rawFields.Chassis || undefined,
    auctionDate: isoDate(rawFields["Auction Date"]),
    lotNumber: rawFields.Number || undefined,
    auctionName: rawFields.Location || undefined,
    auctionGrade: rawFields.Grade || undefined,
    startPrice: yen(rawFields["Start Price"]) || undefined,
    finalPrice,
    currentStatus: "Sold",
    images,
    rawFields,
  };
}

export class PrestigeJapanExactSource implements CatalogSourceAdapter {
  sourceId = "prestige_japan_auctions_open";
  market = "japan" as const;
  accessMode = "public_html" as const;
  private makesPromise: Promise<MakeOption[]> | null = null;

  private async makes() {
    if (!this.makesPromise) this.makesPromise = request(LANDING).then(({ body }) => makeOptions(body));
    return this.makesPromise;
  }

  private async exactDetail(url: string): Promise<PrestigeJapanExactRow | null> {
    if (!DETAIL_RE.test(url)) return null;
    const { body } = await request(url, { headers: { referer: LANDING } });
    return parsePrestigeJapanExactDetail(body, url);
  }

  private async searchPage(make: MakeOption, offset: number) {
    const params = new URLSearchParams();
    params.set("action", "search_results_car_dev");
    params.set("limit_start", String(offset));
    params.set("auction-date", "Past");
    params.set("year_from", "2011");
    params.set("year_to", String(new Date().getUTCFullYear() + 1));
    params.set("marka_id", make.value);
    params.append("auction_name[]", "2"); // verified source form value: Non-USS only
    const { response, body } = await request(AJAX, {
      method: "POST",
      body: params.toString(),
      headers: {
        accept: "application/json,text/plain,*/*",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        origin: BASE,
        referer: LANDING,
      },
    });
    let payload: any = null;
    try { payload = JSON.parse(body); } catch { payload = null; }
    const html = String(payload?.cars_html || "");
    return {
      response,
      links: carLinks(html),
      total: Math.max(0, Number(payload?.total || 0)),
    };
  }

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const makes = await this.makes();
    if (!makes.length) throw new Error("prestige_japan_exact_no_make_options");
    let { makeIndex, offset } = parseCursor(cursor);
    const detailConcurrency = Math.max(1, Math.min(5, Number(process.env.PRESTIGE_JAPAN_DETAIL_CONCURRENCY || 4)));
    const searchPagesPerFetch = Math.max(1, Math.min(12, Number(process.env.PRESTIGE_JAPAN_SEARCH_PAGES_PER_FETCH || 6)));
    const desiredSoldRows = Math.max(1, Math.min(20, Number(process.env.PRESTIGE_JAPAN_DESIRED_SOLD_PER_FETCH || 3)));
    const accepted: PrestigeJapanExactRow[] = [];
    let scannedSearchPages = 0;
    let scannedLinks = 0;
    let lastHttpStatus = 200;
    let lastContentType = "";
    let lastMakeName = "";
    let lastTotal = 0;
    const startCursor = encodeCursor(makeIndex, offset);

    while (makeIndex < makes.length && scannedSearchPages < searchPagesPerFetch && accepted.length < desiredSoldRows) {
      const make = makes[makeIndex];
      lastMakeName = make.name;
      const page = await this.searchPage(make, offset);
      lastHttpStatus = page.response.status;
      lastContentType = page.response.headers.get("content-type") || "";
      lastTotal = page.total;
      scannedSearchPages++;
      scannedLinks += page.links.length;

      if (!page.links.length) {
        makeIndex++;
        offset = 0;
        continue;
      }

      const rows = await poolMap(page.links, detailConcurrency, (link) => this.exactDetail(link));
      for (const row of rows) {
        if (!accepted.some((item) => item.carId === row.carId)) accepted.push(row);
      }

      const nextOffset = offset + 20;
      const exhaustedMake = page.total > 0 ? nextOffset >= page.total : page.links.length < 20;
      if (exhaustedMake) {
        makeIndex++;
        offset = 0;
      } else {
        offset = nextOffset;
      }
    }

    const finished = makeIndex >= makes.length;
    const nextCursor = finished ? null : encodeCursor(makeIndex, offset);
    return {
      items: accepted,
      nextCursor,
      finished,
      count: accepted.length,
      health: {
        ok: true,
        message: `Prestige exact non-USS cursor=${startCursor} next=${nextCursor || "end"} make=${lastMakeName || "end"} searchPages=${scannedSearchPages} links=${scannedLinks} sold=${accepted.length} total=${lastTotal}`,
        checkedAt: new Date().toISOString(),
        httpStatus: lastHttpStatus,
        contentType: lastContentType,
      },
    };
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as PrestigeJapanExactRow;
    if (!row?.carId || !row.sourceUrl || row.currentStatus !== "Sold" || !(row.finalPrice > 0) || !row.make || !row.model || !row.year) return null;
    const now = new Date().toISOString();
    return {
      id: stableOfferId(this.sourceId, row.carId),
      sourceId: this.sourceId,
      sourceOfferId: row.carId,
      market: "japan",
      offerType: "auction",
      // The catalog record remains active/searchable while auctionResult carries the historical sold state.
      status: "active",
      catalogKind: "auction_result",
      auctionResult: "sold",
      auctionPriceKind: "published_result",
      sourceTitle: row.sourceTitle,
      make: row.make,
      model: row.model,
      trim: row.trim,
      year: row.year,
      mileageKm: row.mileageKm,
      engineCc: row.engineCc,
      transmission: row.transmission,
      color: row.color,
      frameNumber: row.frameNumber,
      auctionName: row.auctionName,
      auctionDate: row.auctionDate,
      lotNumber: row.lotNumber,
      auctionGrade: row.auctionGrade,
      sourcePrice: row.finalPrice,
      sourceCurrency: "JPY",
      priceMode: "fixed",
      images: row.images.map(image),
      calculationStatus: "needs_data",
      firstSeenAt: now,
      updatedAt: now,
      operational: {
        sourceUrl: row.sourceUrl,
        sourceVenueName: row.auctionName || "Prestige Motorsport Japan Auctions",
        exactDetail: true,
        photoIdentityVerified: true,
        sourceOnlyFieldsPreserved: true,
        auctionResultPriceVerified: true,
        resultPriceVerified: true,
        galleryVerified: row.images.length >= 5,
        gallerySafetyMode: "prestige_ajes_exact_detail_v1",
        raw: {
          detailIdentityVerified: true,
          photoIdentityVerified: true,
          listingBoundImages: true,
          carId: row.carId,
          currentStatus: row.currentStatus,
          finalPriceJpy: row.finalPrice,
          startPriceJpy: row.startPrice,
          fields: row.rawFields,
          images: row.images,
        },
      },
    };
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const urls = Array.isArray((offer.operational?.raw as any)?.images) ? (offer.operational?.raw as any).images : [];
    return [...new Set(urls.map((value: unknown) => clean(value)).filter((url: string) => EXACT_IMAGE_RE.test(url)))].slice(0, 30).map(image);
  }

  mapStatus(): OfferStatus { return "active"; }

  async healthCheck(): Promise<SourceRunHealth> {
    try {
      const page = await this.fetchPage(null);
      return page.health || { ok: true, message: `Prestige exact sold=${page.items.length}`, checkedAt: new Date().toISOString() };
    } catch (error) {
      return { ok: false, message: String((error as Error)?.message || error), checkedAt: new Date().toISOString() };
    }
  }
}

export const prestigeJapanExactSource = new PrestigeJapanExactSource();

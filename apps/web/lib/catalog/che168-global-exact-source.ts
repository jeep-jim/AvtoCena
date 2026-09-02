import crypto from "node:crypto";
import { stableOfferId } from "./storage";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import { canonicalSourceFuel } from "./powertrain-safety";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, SourceRunHealth, VehicleOffer } from "./types";

const API_BASE = "https://globalapi.che168.com";
const SITE_BASE = "https://global.che168.com";
const APP_ID = "2046";
const PAGE_SIZE = 24;
const HEADERS = {
  accept: "application/json,text/plain,*/*",
  "accept-language": "en-US,en;q=0.9,zh-CN;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  origin: SITE_BASE,
  referer: `${SITE_BASE}/en/used-cars`,
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
const IMAGE_RE = /^https:\/\/erscglobal2\.autoimg\.cn\/escimg\/auto\/.+\/1400x0_c42_autohomecar__.+\.(?:jpe?g|webp|png|avif)(?:[?#].*)?$/i;

export type Che168GlobalListRow = {
  infoid: number;
  carname?: string;
  cname?: string;
  brandname?: string;
  seriesname?: string;
  specname?: string;
  dealerid?: number;
  mileage?: string | number;
  price?: string | number;
  regdate?: string;
  fuelname?: string;
  imageurl?: string;
  cert_status?: number;
  claim_status?: number;
  mr_status?: number;
};

type Che168GlobalDetail = Che168GlobalListRow & {
  brandid?: number;
  seriesid?: number;
  specid?: number;
  dealeid?: number;
  producedate?: string;
  yearname?: string;
  engine?: string;
  gearbox?: string;
  steering?: string;
  drivingmode?: string;
  level?: string;
  setcount?: string | number;
  structuredoor?: string | number;
  structure?: string;
  color?: string;
  dimension?: string;
  curbweight?: string | number;
  catepiclist?: Array<{ title?: string; list?: string[] }>;
  paramkey?: string;
  report_url?: string;
  export_fee?: string | number;
  port_fee?: string | number;
  vincode?: string;
  remark?: string;
  manufacturedate?: string;
};

type ApiEnvelope<T> = {
  returncode?: number;
  message?: string;
  result?: T;
};

type SearchResult = {
  totalcount?: number;
  pagesize?: number;
  pageindex?: number;
  pagecount?: number;
  queryid?: string;
  carlist?: Che168GlobalListRow[];
};

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
function positiveNumber(value: unknown) {
  const n = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
function integer(value: unknown) {
  const n = positiveNumber(value);
  return n ? Math.round(n) : undefined;
}
function yearOf(row: Pick<Che168GlobalListRow, "specname" | "carname" | "regdate"> & Partial<Pick<Che168GlobalDetail, "yearname" | "producedate" | "manufacturedate">>) {
  const candidates = [row.specname, row.carname, row.yearname, row.producedate, row.manufacturedate, row.regdate];
  for (const value of candidates) {
    const year = Number(text(value).match(/\b((?:19|20)\d{2})\b/)?.[1] || 0);
    if (year >= 1980 && year <= new Date().getUTCFullYear() + 1) return year;
  }
  return 0;
}
function modelOf(make: string, series: string) {
  const normalized = text(series);
  if (!normalized) return "";
  const escaped = make.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return normalized.replace(new RegExp(`^${escaped}\\s+`, "i"), "").trim() || normalized;
}
type Che168EvidenceStatus = "exact" | "ambiguous" | "conflict" | "missing";

type Che168MetricEvidence = {
  value?: number;
  rawValues: string[];
  status: Che168EvidenceStatus;
};

type Che168FuelEvidence = {
  value?: string;
  rawValues: string[];
  status: Che168EvidenceStatus;
};

function rounded(value: number) {
  return Math.round(value * 10) / 10;
}

function explicitRange(value: string) {
  return /\d\s*(?:-|–|—|~|～|至|到)\s*\d/.test(value);
}

function metricEvidence(rawValue: unknown, field: "engineCc" | "powerHp"): Che168MetricEvidence {
  const raw = text(rawValue);
  const rawValues = raw ? [raw] : [];
  if (!raw) return { rawValues, status: "missing" };
  if (explicitRange(raw)) return { rawValues, status: "ambiguous" };

  const values: number[] = [];
  if (field === "engineCc") {
    for (const match of raw.matchAll(/\b(\d{3,5})\s*(?:cc|cm3|cm³)\b/gi)) {
      const value = integer(match[1]);
      if (value && value >= 300 && value <= 10_000) values.push(value);
    }
    for (const match of raw.matchAll(/\b(\d+(?:[.,]\d+)?)\s*[LT]\b/gi)) {
      const value = Number(match[1].replace(",", "."));
      if (Number.isFinite(value) && value >= 0.3 && value <= 10) values.push(Math.round(value * 1_000));
    }
  } else {
    for (const match of raw.matchAll(/\b(\d{2,4}(?:[.,]\d+)?)\s*(?:hp|ps|bhp)\b/gi)) {
      const value = Number(match[1].replace(",", "."));
      if (Number.isFinite(value) && value >= 20 && value <= 2_500) values.push(rounded(value));
    }
    for (const match of raw.matchAll(/\b(\d{2,4}(?:[.,]\d+)?)\s*kW\b/gi)) {
      const value = Number(match[1].replace(",", "."));
      if (Number.isFinite(value) && value >= 10 && value <= 2_000) values.push(rounded(value * 1.3596216173));
    }
  }

  const unique = [...new Set(values)];
  if (!unique.length) return { rawValues, status: "missing" };
  if (Math.max(...unique) - Math.min(...unique) > (field === "powerHp" ? 1 : 0)) {
    return { rawValues, status: "conflict" };
  }
  return { value: unique[0], rawValues, status: "exact" };
}

function fuelEvidence(...raw: unknown[]): Che168FuelEvidence {
  const rawValues = [...new Set(raw.map(text).filter(Boolean))];
  if (!rawValues.length) return { rawValues, status: "missing" };
  const canonical = rawValues.map(canonicalSourceFuel);
  if (canonical.some((value) => !value)) return { rawValues, status: "ambiguous" };
  const unique = [...new Set(canonical as string[])];
  if (unique.length !== 1) return { rawValues, status: "conflict" };
  return { value: unique[0], rawValues, status: "exact" };
}

function yearEvidence(...raw: unknown[]): Che168MetricEvidence {
  const values = raw.map(Number).filter((value) => Number.isInteger(value) && value >= 1980 && value <= new Date().getUTCFullYear() + 1);
  const rawValues = values.map(String);
  if (!values.length) return { rawValues, status: "missing" };
  const unique = [...new Set(values)];
  if (unique.length !== 1) return { rawValues, status: "conflict" };
  return { value: unique[0], rawValues, status: "exact" };
}

function powertrainKindForFuel(fuel: string | undefined) {
  if (fuel === "electric") return "electric" as const;
  if (fuel === "hybrid") return "other_hybrid" as const;
  if (fuel) return "combustion" as const;
  return "unknown" as const;
}

export function che168GlobalSpecificationEvidence(args: {
  listingYear?: unknown;
  detailYear?: unknown;
  listingFuel?: unknown;
  detailFuel?: unknown;
  detailEngine?: unknown;
}) {
  return {
    year: yearEvidence(args.listingYear, args.detailYear),
    fuel: fuelEvidence(args.listingFuel, args.detailFuel),
    engineCc: metricEvidence(args.detailEngine, "engineCc"),
    powerHp: metricEvidence(args.detailEngine, "powerHp"),
  };
}
function sourceUrl(id: string | number) {
  return `${SITE_BASE}/en/detail/${id}`;
}
function remoteImage(url: string): CatalogImage {
  const mimeType = /\.png(?:[?#]|$)/i.test(url) ? "image/png" : /\.avif(?:[?#]|$)/i.test(url) ? "image/avif" : /\.webp(?:[?#]|$)/i.test(url) ? "image/webp" : "image/jpeg";
  return { id: "", url, objectKey: "", checksum: "", size: 0, mimeType };
}
function exactGallery(detail: Che168GlobalDetail) {
  const urls = (detail.catepiclist || [])
    .flatMap((group) => Array.isArray(group?.list) ? group.list : [])
    .map((url) => text(url))
    .filter((url) => IMAGE_RE.test(url));
  return [...new Set(urls)].slice(0, Math.min(30, Math.max(5, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30))));
}

export class Che168GlobalExactAdapter implements CatalogSourceAdapter {
  sourceId = "autohome_used_china_open";
  market = "china" as const;
  accessMode = "public_json" as const;
  private readonly deviceId = crypto.randomUUID();

  private params(extra: Record<string, string | number> = {}) {
    const params = new URLSearchParams({
      _appid: APP_ID,
      deviceid: this.deviceId,
      language: "en",
      fromsource: "0",
    });
    for (const [key, value] of Object.entries(extra)) params.set(key, String(value));
    return params;
  }

  private async getJson<T>(url: string, referer = `${SITE_BASE}/en/used-cars`) {
    const response = await fetch(url, {
      headers: { ...HEADERS, referer },
      redirect: "follow",
      signal: AbortSignal.timeout(Math.max(8_000, Number(process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS || 30_000))),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`che168_global_http_${response.status}:${url}`);
    let parsed: ApiEnvelope<T>;
    try { parsed = JSON.parse(body) as ApiEnvelope<T>; }
    catch { throw new Error(`che168_global_invalid_json_${response.status}:${url}`); }
    if (Number(parsed.returncode) !== 0 || !parsed.result) {
      throw new Error(`che168_global_api_error_${parsed.returncode ?? "unknown"}:${text(parsed.message)}`);
    }
    return { response, result: parsed.result };
  }

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const params = this.params({ pageindex: page, pagesize: PAGE_SIZE, sort: 0, vehicle_list: 0 });
    const url = `${API_BASE}/api/v1/search?${params.toString()}`;
    const { response, result } = await this.getJson<SearchResult>(url);
    const items = Array.isArray(result.carlist) ? result.carlist.filter((row) => Number(row?.infoid) > 0) : [];
    const pageCount = Math.max(0, Number(result.pagecount || 0));
    const totalCount = Math.max(0, Number(result.totalcount || 0));
    const finished = !items.length || (pageCount > 0 && page >= pageCount);
    return {
      items,
      nextCursor: finished ? null : String(page + 1),
      finished,
      count: items.length,
      health: {
        ok: items.length > 0,
        message: `Che168 Global API page=${page}/${pageCount || "?"} items=${items.length} total=${totalCount}`,
        checkedAt: new Date().toISOString(),
        httpStatus: response.status,
        contentType: response.headers.get("content-type") || "",
      },
    };
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as Che168GlobalListRow;
    const id = String(row?.infoid || "").trim();
    const make = text(row?.brandname);
    const model = modelOf(make, text(row?.seriesname));
    const title = text(row?.carname) || [make, model, text(row?.specname)].filter(Boolean).join(" ");
    const year = yearOf(row || {});
    const price = positiveNumber(row?.price);
    if (!id || !make || !model || !title || !year || !price) return null;
    const now = new Date().toISOString();
    const evidence = che168GlobalSpecificationEvidence({ listingYear: year, listingFuel: row?.fuelname });
    const offer = normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, id),
      sourceId: this.sourceId,
      sourceOfferId: id,
      market: "china",
      offerType: "fixed",
      status: "active",
      catalogKind: "listing",
      sourceTitle: title,
      make,
      model,
      trim: text(row?.specname) || undefined,
      year,
      mileageKm: integer(row?.mileage),
      fuel: evidence.fuel.status === "exact" ? evidence.fuel.value : undefined,
      powertrainKind: powertrainKindForFuel(evidence.fuel.status === "exact" ? evidence.fuel.value : undefined),
      sourcePrice: price,
      sourceCurrency: "USD",
      priceMode: "fixed",
      images: [],
      totalRub: null,
      calculationStatus: "needs_data",
      firstSeenAt: now,
      updatedAt: now,
      operational: {
        sourceUrl: sourceUrl(id),
        sourceVenueName: "Che168 Global",
        sourceTitle: title,
        sourceCity: text(row?.cname) || undefined,
        exactDetail: false,
        exactFields: true,
        exactPhotos: false,
        galleryVerified: false,
        galleryImageCount: 0,
        gallerySafetyMode: "che168_global_carinfo_catepiclist_v1",
        galleryStoredAs: "json_urls",
        semanticEvidence: {
          year: { source: "che168_global_listing", ...evidence.year },
          fuel: { source: "che168_global_listing", ...evidence.fuel },
          engineCc: { source: "che168_global_carinfo", ...evidence.engineCc },
          powerHp: { source: "che168_global_carinfo", ...evidence.powerHp },
        },
        raw: { listing: row, detailIdentityVerified: false, photoIdentityVerified: false },
      },
    } as VehicleOffer);
    // Listing titles and trims can contain model-family displacement tokens.
    // Che168's exact engine/power contract begins only at the identity-bound
    // carinfo response, so generic normalization must not promote them early.
    offer.engineCc = undefined;
    offer.powerHp = undefined;
    offer.powerKw = undefined;
    offer.icePowerKw = undefined;
    offer.utilizationPowerKw = undefined;
    offer.powerDataConfidence = undefined;
    offer.powerDataSource = undefined;
    return offer;
  }

  private async fetchDetail(offer: VehicleOffer) {
    const id = String(offer.sourceOfferId || "");
    if (!/^\d+$/.test(id)) throw new Error("che168_global_invalid_offer_id");
    const params = this.params();
    const url = `${API_BASE}/api/v1/carinfo/${id}?${params.toString()}`;
    const { result } = await this.getJson<Che168GlobalDetail>(url, sourceUrl(id));
    if (String(result.infoid || "") !== id) throw new Error(`che168_global_detail_identity_mismatch:${id}:${result.infoid || ""}`);
    return result;
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const detail = await this.fetchDetail(offer);
    const id = String(offer.sourceOfferId);
    const make = text(detail.brandname) || offer.make;
    const model = modelOf(make, text(detail.seriesname)) || offer.model;
    const title = text(detail.carname) || offer.sourceTitle;
    const detailYear = yearOf(detail);
    const price = positiveNumber(detail.price);
    const evidence = che168GlobalSpecificationEvidence({
      listingYear: offer.year,
      detailYear,
      listingFuel: ((offer.operational?.raw as any)?.listing as Che168GlobalListRow | undefined)?.fuelname,
      detailFuel: detail.fuelname,
      detailEngine: detail.engine,
    });
    const gallery = exactGallery(detail);
    const minimum = Math.max(5, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 5));
    const verifiedGallery = gallery.length >= minimum;

    offer.make = make;
    offer.model = model;
    offer.sourceTitle = title;
    offer.trim = text(detail.specname) || offer.trim;
    if (evidence.year.status === "exact" && evidence.year.value) offer.year = evidence.year.value;
    offer.productionDate = text(detail.manufacturedate || detail.producedate) || offer.productionDate;
    offer.mileageKm = integer(detail.mileage) || offer.mileageKm;
    offer.fuel = evidence.fuel.status === "exact" ? evidence.fuel.value : undefined;
    offer.powertrainKind = powertrainKindForFuel(offer.fuel);
    offer.engineType = text(detail.engine) || offer.engineType;
    offer.engineCc = evidence.engineCc.status === "exact" ? evidence.engineCc.value : undefined;
    offer.transmission = text(detail.gearbox) || offer.transmission;
    offer.drive = text(detail.drivingmode) || offer.drive;
    offer.bodyType = text(detail.structure) || offer.bodyType;
    offer.color = text(detail.color) || offer.color;
    offer.vin = text(detail.vincode) || offer.vin;
    if (evidence.powerHp.status === "exact" && evidence.powerHp.value) {
      offer.powerHp = evidence.powerHp.value;
      offer.powerKw = Math.round((evidence.powerHp.value * 0.73549875) * 10) / 10;
      offer.powerDataConfidence = "source_exact";
      offer.powerDataSource = "Che168 Global carinfo API";
    } else {
      offer.powerHp = undefined;
      offer.powerKw = undefined;
      offer.icePowerKw = undefined;
      offer.utilizationPowerKw = undefined;
      offer.powerDataConfidence = undefined;
      offer.powerDataSource = undefined;
    }
    if (price) offer.sourcePrice = price;
    offer.sourceCurrency = "USD";
    offer.operational = {
      ...(offer.operational || {}),
      sourceUrl: sourceUrl(id),
      sourceVenueName: "Che168 Global",
      sourceTitle: title,
      sourceCity: text(detail.cname) || offer.operational?.sourceCity,
      exactDetail: true,
      exactFields: true,
      exactPhotos: verifiedGallery,
      galleryVerified: verifiedGallery,
      galleryImageCount: gallery.length,
      photoIdentityVerified: verifiedGallery,
      gallerySafetyMode: "che168_global_carinfo_catepiclist_v1",
      galleryStoredAs: "json_urls",
      semanticEvidence: {
        ...((offer.operational as any)?.semanticEvidence || {}),
        year: { source: "che168_global_listing_and_carinfo", ...evidence.year },
        fuel: { source: "che168_global_listing_and_carinfo", ...evidence.fuel },
        engineCc: { source: "che168_global_carinfo", ...evidence.engineCc },
        powerHp: { source: "che168_global_carinfo", ...evidence.powerHp },
      },
      raw: { listing: (offer.operational?.raw as any)?.listing, detail, detailIdentityVerified: true, photoIdentityVerified: verifiedGallery },
    };
    const engineEvidenceReady = offer.powertrainKind === "electric" || evidence.engineCc.status === "exact";
    if (evidence.year.status !== "exact" || evidence.fuel.status !== "exact" || !engineEvidenceReady || evidence.powerHp.status !== "exact") {
      offer.calculationStatus = "needs_data";
    }
    return gallery.map(remoteImage);
  }

  mapStatus(): OfferStatus { return "active"; }

  async healthCheck(): Promise<SourceRunHealth> {
    try {
      const page = await this.fetchPage("1");
      return page.health || { ok: Boolean(page.items.length), message: `Che168 Global API items=${page.items.length}`, checkedAt: new Date().toISOString() };
    } catch (error) {
      return { ok: false, message: String((error as Error)?.message || error), checkedAt: new Date().toISOString() };
    }
  }
}

export const che168GlobalExactSource = new Che168GlobalExactAdapter();

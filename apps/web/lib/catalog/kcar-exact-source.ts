import crypto from "node:crypto";
import { canonicalSourceFuel } from "./powertrain-safety";
import { stableOfferId } from "./storage";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

type KCarListRow = {
  carCd?: string;
  mnuftrNm?: string;
  modelNm?: string;
  prc?: string | number;
  milg?: string | number;
};

type KCarDetailData = {
  photoList?: Array<Record<string, any>>;
  outerPhotoList?: Array<Record<string, any>>;
  rvo?: Record<string, any>;
  vrVo?: Record<string, any>;
};

type Row = {
  id: string;
  url: string;
  title: string;
  make: string;
  model: string;
  trim: string;
  year: number;
  productionDate?: string;
  mileageKm?: number;
  engineCc?: number;
  powerHp?: number;
  powerKw?: number;
  fuel: string;
  transmission: string;
  drive: string;
  bodyType: string;
  color?: string;
  vin?: string;
  sourcePrice: number;
  sourceCurrency: "KRW";
  images: string[];
  rawFuelType: string;
  rawStatus: string;
  semanticEvidence: ReturnType<typeof kcarSpecificationEvidence>;
};

type KCarEvidenceStatus = "exact" | "ambiguous" | "conflict" | "missing";
type KCarMetricEvidence = { value?: number; rawValues: string[]; status: KCarEvidenceStatus };
type KCarFuelEvidence = { value?: string; rawValues: string[]; status: KCarEvidenceStatus };

const API_BASE = "https://api.kcar.com";
const WEB_BASE = "https://www.kcar.com";
const KEY = Buffer.from("SKFJ2424DasfaJRI", "utf8");
const IV = Buffer.from("sfq241sf3dscs321", "utf8");
const HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "ko-KR,ko;q=0.9,en;q=0.7",
  origin: WEB_BASE,
  referer: `${WEB_BASE}/bc/search`,
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function positiveInt(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function structuredIntegerEvidence(values: unknown[], minimum: number, maximum: number): KCarMetricEvidence {
  const rawValues = [...new Set(values.map(clean).filter(Boolean))];
  if (!rawValues.length) return { rawValues, status: "missing" };
  if (rawValues.some((value) => !/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value))) {
    return { rawValues, status: "ambiguous" };
  }
  const parsed = rawValues.map((value) => Number(value.replace(/,/g, "")));
  if (parsed.some((value) => !Number.isInteger(value) || value < minimum || value > maximum)) {
    return { rawValues, status: "ambiguous" };
  }
  const exact = [...new Set(parsed)];
  if (exact.length !== 1) return { rawValues, status: "conflict" };
  return { value: exact[0], rawValues, status: "exact" };
}

function kcarFuelEvidence(value: unknown): KCarFuelEvidence {
  const raw = clean(value);
  const rawValues = raw ? [raw] : [];
  if (!raw) return { rawValues, status: "missing" };
  const canonical = canonicalSourceFuel(raw);
  return canonical
    ? { value: canonical, rawValues, status: "exact" }
    : { rawValues, status: "ambiguous" };
}

export function kcarSpecificationEvidence(input: {
  regModelYear?: unknown;
  manufactureDate?: unknown;
  fuelName?: unknown;
  rawFuelType?: unknown;
  engineDisplacement?: unknown;
  horsepower?: unknown;
}) {
  const manufactureYear = clean(input.manufactureDate).match(/^(19\d{2}|20\d{2})/)?.[1];
  const year = structuredIntegerEvidence([input.regModelYear, manufactureYear], 1900, new Date().getUTCFullYear() + 1);
  const fuel = kcarFuelEvidence(input.fuelName);
  const rawFuelType = clean(input.rawFuelType);
  const electricPowerUnit = rawFuelType === "009" || rawFuelType === "013";
  const unitMatchesFuel = fuel.status === "exact" && electricPowerUnit === (fuel.value === "electric");
  let engineCc = structuredIntegerEvidence([input.engineDisplacement], 300, 10_000);
  if (fuel.value === "electric" && engineCc.status === "exact") {
    engineCc = { ...engineCc, value: undefined, status: "conflict" };
  }
  const peakPower = structuredIntegerEvidence([input.horsepower], 10, 2_000);
  const powerHp = !electricPowerUnit && unitMatchesFuel
    ? peakPower
    : { rawValues: peakPower.rawValues, status: unitMatchesFuel ? "missing" : "conflict" as KCarEvidenceStatus };
  const powerKw = electricPowerUnit && unitMatchesFuel
    ? peakPower
    : { rawValues: peakPower.rawValues, status: unitMatchesFuel ? "missing" : "conflict" as KCarEvidenceStatus };
  return { year, fuel, engineCc, powerHp, powerKw };
}

function powertrainKindForFuel(fuel: string | undefined) {
  if (fuel === "electric") return "electric" as const;
  if (fuel === "hybrid") return "other_hybrid" as const;
  if (fuel) return "combustion" as const;
  return "unknown" as const;
}

function sleep(ms: number) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function encryptedBody(value: Record<string, unknown>) {
  const filtered = Object.fromEntries(Object.entries(value).filter(([, item]) => Boolean(item)));
  const cipher = crypto.createCipheriv("aes-128-cbc", KEY, IV);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(filtered), "utf8"),
    cipher.final(),
  ]).toString("base64");
  return JSON.stringify({ enc: encrypted });
}

function retryDelay(response: Response, fallback: number) {
  const raw = clean(response.headers.get("retry-after"));
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(60_000, Math.round(seconds * 1000));
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.min(60_000, Math.max(0, date - Date.now()));
  return fallback;
}

async function requestJson(url: string, init: RequestInit = {}) {
  const attempts = Math.max(1, Math.min(6, Number(process.env.CATALOG_SOURCE_RETRY_ATTEMPTS || 5)));
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 35_000));
    try {
      const response = await fetch(url, {
        ...init,
        headers: { ...HEADERS, ...(init.headers || {}) },
        redirect: "follow",
        signal: controller.signal,
      });
      const text = await response.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch {}
      const retryable = response.status === 403 || response.status === 429 || [500, 502, 503, 504].includes(response.status);
      if (retryable && attempt < attempts - 1) {
        await sleep(retryDelay(response, Math.min(30_000, 1_500 * (2 ** attempt))));
        continue;
      }
      return { response, json };
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
      await sleep(Math.min(30_000, 1_500 * (2 ** attempt)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("kcar_request_failed");
}

function detailUrl(carCd: string) {
  return `${WEB_BASE}/bc/detail/carInfoDtl?i_sCarCd=${encodeURIComponent(carCd)}`;
}

async function fetchExactDetailData(carCd: string) {
  const url = new URL(`${API_BASE}/bc/car-info-detail-of-ng`);
  url.searchParams.set("i_sCarCd", carCd);
  url.searchParams.set("i_sPassYn", "N");
  const detail = await requestJson(url.toString(), { headers: { referer: detailUrl(carCd) } });
  if (!detail.response.ok || detail.json?.success !== true) throw new Error(`kcar_exact_detail_http_${detail.response.status}_${carCd}`);
  const data = (detail.json?.data?.data ?? detail.json?.data ?? null) as KCarDetailData | null;
  if (!data || clean(data.rvo?.carCd) !== carCd) {
    const message = clean(detail.json?.data?.message ?? detail.json?.message);
    // K Car responds with HTTP 200/success=true for listings that have just sold,
    // but deliberately omits rvo and the exact gallery. Keep this distinct from
    // an identity failure so maintenance can retire only confirmed sold offers.
    if (message.includes("판매완료")) throw new Error(`kcar_exact_detail_sold_${carCd}`);
    throw new Error(`kcar_exact_detail_identity_${carCd}`);
  }
  return data;
}

export const KCAR_EXTERIOR_FIRST_GALLERY_MODE = "kcar_exterior_cover_vr_extra_exact_car_id_v3";

function splitImageList(value: unknown) {
  return clean(value)
    .split(",")
    .map((item) => item.trim().replace(/^['\"]+|['\"]+$/g, "").trim())
    .filter(Boolean);
}

function exactVehiclePhotoUrl(value: unknown, numericId: string) {
  const source = clean(value);
  if (!source) return "";
  try {
    const url = new URL(source);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "img.kcar.com") return "";
    if (!new RegExp(`/3dcarpicture/\\d{4}/\\d{2}/\\d+/${numericId}_[0-9]+/`, "i").test(url.pathname)) return "";
    if (!/\.(?:jpe?g|webp)(?:$|[?#])/i.test(source)) return "";
    return source;
  } catch {
    return "";
  }
}

function representativeExteriorFrames(values: string[]) {
  if (values.length <= 4) return values;
  const indexes = [0, Math.floor(values.length / 4), Math.floor(values.length / 2), Math.floor(values.length * 3 / 4)];
  return [...new Set(indexes)].map((index) => values[index]).filter(Boolean);
}

export function exactVehicleGallery(data: KCarDetailData, carCd: string) {
  const numericId = carCd.replace(/^[^0-9]+/, "");
  if (!numericId) return [];
  const exact = (value: unknown) => exactVehiclePhotoUrl(value, numericId);
  const explicitExterior = [...(data.outerPhotoList || []), ...(data.photoList || [])]
    .filter((photo) => clean(photo?.thumbnailType) === "01" || clean(photo?.thumbnailTypenm) === "외관")
    .sort((left, right) => Number(left?.sortOrdr || Number.MAX_SAFE_INTEGER) - Number(right?.sortOrdr || Number.MAX_SAFE_INTEGER))
    .map((photo) => exact(photo?.elanPath || photo?.url || photo?.path))
    .filter(Boolean);
  const closedExterior = representativeExteriorFrames(splitImageList(data.vrVo?.v_src_close).map(exact).filter(Boolean));
  const openExterior = representativeExteriorFrames(splitImageList(data.vrVo?.v_src_open).map(exact).filter(Boolean));
  const details = splitImageList(data.vrVo?.v_src_show)
    .map(exact)
    .filter((url) => /\/extra\/extra_[0-9]+_hq\.jpg(?:[?#].*)?$/i.test(url));

  // K Car's v_src_show begins with interior/detail frames. Its separately typed
  // exterior cover (and 360-degree exterior frames when present) must lead the
  // customer gallery; cabin, wheels and diagnostics belong after the body.
  return [...new Set([...explicitExterior, ...closedExterior, ...openExterior, ...details])].slice(0, 30);
}

function parseExactDetail(meta: KCarListRow, data: KCarDetailData): Row | null {
  const rvo = data?.rvo || {};
  const id = clean(rvo.carCd);
  if (!id || id !== clean(meta.carCd) || clean(rvo.statCd) !== "CAR_STATUS010") return null;

  const make = clean(rvo.mnuftrNm);
  const model = clean(rvo.modelNm);
  const trim = clean(rvo.grdFullNm || [rvo.grdNm, rvo.grdDtlNm].filter(Boolean).join(" "));
  const evidence = kcarSpecificationEvidence({
    regModelYear: rvo.regModelyr,
    manufactureDate: rvo.mfgDt,
    fuelName: rvo.fuelTypecdNm,
    rawFuelType: rvo.fuelType,
    engineDisplacement: rvo.engdispmnt,
    horsepower: rvo.hrspow,
  });
  const year = evidence.year.status === "exact" ? Number(evidence.year.value) : 0;
  const productionDate = clean(rvo.mfgDt) || undefined;
  const mileageKm = positiveInt(rvo.milg);
  const engineCc = evidence.engineCc.status === "exact" ? evidence.engineCc.value : undefined;
  const powerHp = evidence.powerHp.status === "exact" ? evidence.powerHp.value : undefined;
  const powerKw = evidence.powerKw.status === "exact" ? evidence.powerKw.value : undefined;
  const fuel = evidence.fuel.status === "exact" ? clean(evidence.fuel.value) : "";
  const rawFuelType = clean(rvo.fuelType);
  const transmission = clean(rvo.trnsmsncdNm);
  const drive = clean(rvo.drvgYnNm);
  const bodyType = clean(rvo.carctgr);
  const sourcePriceManwon = Number(rvo.salprc || 0);
  const sourcePrice = Number.isFinite(sourcePriceManwon) && sourcePriceManwon > 0 ? Math.round(sourcePriceManwon * 10_000) : 0;
  const images = exactVehicleGallery(data, id);

  if (!make || !model || !trim || !year || !fuel || !transmission || !drive || !bodyType || !sourcePrice || (!powerHp && !powerKw) || images.length < 5) return null;
  if (clean(meta.mnuftrNm) && clean(meta.mnuftrNm) !== make) return null;
  if (clean(meta.modelNm) && clean(meta.modelNm) !== model) return null;
  const listPrice = positiveInt(meta.prc);
  if (listPrice && listPrice !== Math.round(sourcePriceManwon)) return null;
  const listMileage = positiveInt(meta.milg);
  if (listMileage && mileageKm && listMileage !== mileageKm) return null;

  return {
    id,
    url: detailUrl(id),
    title: [make, model, trim].join(" "),
    make,
    model,
    trim,
    year,
    productionDate,
    mileageKm,
    engineCc,
    powerHp,
    powerKw,
    fuel,
    transmission,
    drive,
    bodyType,
    color: clean(rvo.extrColorNm) || undefined,
    vin: clean(rvo.vin) || undefined,
    sourcePrice,
    sourceCurrency: "KRW",
    images,
    rawFuelType,
    rawStatus: clean(rvo.statCdNm || rvo.statCd),
    semanticEvidence: evidence,
  };
}

function image(url: string): CatalogImage {
  const pathname = (() => { try { return new URL(url).pathname; } catch { return ""; } })();
  const mimeType = /\.png$/i.test(pathname) ? "image/png" : /\.webp$/i.test(pathname) ? "image/webp" : "image/jpeg";
  return { id: "", url, objectKey: "", checksum: "", size: 0, mimeType };
}

class KCarExactSource implements CatalogSourceAdapter {
  sourceId = "kcar_korea_open";
  market = "korea" as const;
  accessMode = "public_json" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const pageDelay = Math.max(0, Math.min(10_000, Number(process.env.CATALOG_SOURCE_PAGE_DELAY_MS || 0)));
    if (page > 1) await sleep(pageDelay);

    const listing = await requestJson(`${API_BASE}/bc/search/list/drct`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: encryptedBody({
        wr_in_multi_columns: "cntr_rgn_cd|cntr_cd",
        pageno: page,
        limit: 20,
        orderFlag: true,
        orderBy: "time_deal_yn:desc|time_deal_end_dt:asc|promo_ordr:asc|event_ordr:asc|sort_ordr:asc",
      }),
    });
    if (!listing.response.ok || listing.json?.success !== true) {
      throw new Error(`kcar_exact_list_http_${listing.response.status}_page_${page}`);
    }
    const root = listing.json?.data?.data ?? listing.json?.data ?? {};
    const metas = (Array.isArray(root?.rows) ? root.rows : []) as KCarListRow[];
    const total = Number(root?.totalCnt || 0);
    const rows: Row[] = [];
    const batchSize = Math.max(1, Math.min(4, Number(process.env.CATALOG_SOURCE_DETAIL_BATCH_SIZE || 2)));
    const batchDelay = Math.max(0, Math.min(5_000, Number(process.env.CATALOG_SOURCE_BATCH_DELAY_MS || 400)));

    for (let index = 0; index < metas.length; index += batchSize) {
      const batch = await Promise.all(metas.slice(index, index + batchSize).map(async (meta) => {
        const carCd = clean(meta.carCd);
        if (!carCd) return null;
        const data = await fetchExactDetailData(carCd).catch(() => null);
        return data ? parseExactDetail(meta, data) : null;
      }));
      rows.push(...batch.filter(Boolean) as Row[]);
      if (index + batchSize < metas.length) await sleep(batchDelay);
    }

    const finished = metas.length === 0 || (total > 0 && page * 20 >= total);
    return {
      items: rows,
      nextCursor: finished ? null : String(page + 1),
      finished,
      count: rows.length,
      health: {
        ok: metas.length > 0,
        message: `K Car exact page ${page}: ${rows.length}/${metas.length}; total=${total || "unknown"}`,
        checkedAt: new Date().toISOString(),
        httpStatus: listing.response.status,
        contentType: listing.response.headers.get("content-type") || "",
      },
    };
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as Row;
    if (!row?.id || !row.make || !row.model || !row.trim || !row.year || !row.sourcePrice || !row.sourceCurrency || row.images.length < 5) return null;
    if (!row.powerHp && !row.powerKw) return null;
    const now = new Date().toISOString();
    const fields = [
      "make", "model", "trim", "year", "sourcePrice", "sourceCurrency",
      ...(row.productionDate ? ["productionDate"] : []),
      ...(row.mileageKm != null ? ["mileageKm"] : []),
      ...(row.engineCc ? ["engineCc"] : []),
      ...(row.powerHp ? ["powerHp"] : []),
      ...(row.powerKw ? ["powerKw"] : []),
      "fuel", "transmission", "drive", "bodyType",
      ...(row.color ? ["color"] : []),
      ...(row.vin ? ["vin"] : []),
    ];
    return {
      id: stableOfferId(this.sourceId, row.id),
      sourceId: this.sourceId,
      sourceOfferId: row.id,
      market: "korea",
      offerType: "fixed",
      status: "active",
      sourceTitle: row.title,
      make: row.make,
      model: row.model,
      trim: row.trim,
      year: row.year,
      productionDate: row.productionDate,
      mileageKm: row.mileageKm,
      engineCc: row.engineCc,
      powerHp: row.powerHp,
      powerKw: row.powerKw,
      powerDataConfidence: "source_exact",
      powerDataSource: row.powerKw ? "kcar_exact_detail_rvo_hrspow_kw" : "kcar_exact_detail_rvo_hrspow_hp",
      fuel: row.fuel,
      powertrainKind: powertrainKindForFuel(row.fuel),
      transmission: row.transmission,
      drive: row.drive,
      bodyType: row.bodyType,
      color: row.color,
      vin: row.vin,
      sourcePrice: row.sourcePrice,
      sourceCurrency: row.sourceCurrency,
      priceMode: "fixed",
      images: [],
      totalRub: null,
      calculationStatus: "needs_data",
      firstSeenAt: now,
      updatedAt: now,
      operational: {
        sourceUrl: row.url,
        sourceTitle: row.title,
        detailIdentityVerified: true,
        fieldIdentityVerified: true,
        photoIdentityVerified: true,
        vehiclePhotoVerified: true,
        sourceExactFields: fields,
        vin: row.vin,
        semanticEvidence: {
          year: { source: "kcar_exact_detail_rvo", ...row.semanticEvidence.year },
          fuel: { source: "kcar_exact_detail_rvo", ...row.semanticEvidence.fuel },
          engineCc: { source: "kcar_exact_detail_rvo_engdispmnt", ...row.semanticEvidence.engineCc },
          powerHp: { source: "kcar_exact_detail_rvo_hrspow", ...row.semanticEvidence.powerHp },
          powerKw: { source: "kcar_exact_detail_rvo_hrspow", ...row.semanticEvidence.powerKw },
        },
        raw: {
          sourceExactFields: fields,
          sourceApi: `${API_BASE}/bc/car-info-detail-of-ng`,
          listingApi: `${API_BASE}/bc/search/list/drct`,
          gallerySafetyMode: KCAR_EXTERIOR_FIRST_GALLERY_MODE,
          rawFuelType: row.rawFuelType,
          rawStatus: row.rawStatus,
          images: row.images,
        },
      },
    };
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const raw = (offer.operational?.raw || {}) as any;
    const previousMode = clean(offer.operational?.gallerySafetyMode || raw.gallerySafetyMode);
    const credentialPattern = /\/ucms\/\d{6}\/CM\/CMBIZ11120D\//i;
    const hasCredentialScans = ["1", "true", "yes", "on"].includes(String(process.env.CATALOG_GALLERY_DROP_CREDENTIAL_SCANS || "false").toLowerCase())
      && (offer.images || []).some((item) => credentialPattern.test(clean(item?.url)));
    let urls = Array.isArray(raw.images) ? raw.images.map(clean).filter(Boolean) : [];
    if (previousMode !== KCAR_EXTERIOR_FIRST_GALLERY_MODE || hasCredentialScans) {
      const carCd = clean(offer.sourceOfferId);
      if (!carCd) throw new Error("kcar_gallery_refresh_missing_source_offer_id");
      const data = await fetchExactDetailData(carCd);
      const rebuilt = exactVehicleGallery(data, carCd);
      if (rebuilt.length < 5) {
        // An active 2D listing can contain detail/cabin photos and dealer
        // credentials but no source-verified full-body image. Do not publish it
        // as a vehicle card until K Car exposes an exact exterior gallery.
        throw new Error(`kcar_exact_gallery_no_exterior_${carCd}`);
      } else {
        urls = rebuilt;
      }
      raw.images = urls;
      raw.gallerySafetyMode = KCAR_EXTERIOR_FIRST_GALLERY_MODE;
    }
    offer.operational = {
      ...(offer.operational || {}),
      gallerySafetyMode: KCAR_EXTERIOR_FIRST_GALLERY_MODE,
      galleryImageCount: urls.length,
      galleryRefreshedAt: new Date().toISOString(),
      vehiclePhotoVerified: urls.length > 0,
      photoIdentityVerified: urls.length > 0,
      raw,
    };
    return [...new Set(urls)].slice(0, 30).map(image);
  }

  mapStatus(): OfferStatus {
    return "active";
  }

  async healthCheck() {
    try {
      const page = await this.fetchPage("1");
      return page.health || { ok: false, message: "K Car exact health unavailable", checkedAt: new Date().toISOString() };
    } catch (error) {
      return { ok: false, message: String((error as Error)?.message || error), checkedAt: new Date().toISOString() };
    }
  }
}

export const kcarKoreaExactSource = new KCarExactSource();

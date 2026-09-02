import { EncarDirectAdapter, buildEncarImageUrl, extractEncarImageUrls } from "./adapters";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import { encarNonCashContractReason } from "./encar-sale-contract";
import { canonicalSourceFuel } from "./powertrain-safety";
import type { CatalogFetchResult, CatalogImage, VehicleOffer } from "./types";

const ENCAR_HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  origin: "https://car.encar.com",
  referer: "https://car.encar.com/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
};

function text(value: unknown) {
  return value == null ? "" : String(value).trim().replace(/\\\//g, "/");
}

function number(value: unknown) {
  const result = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(result) && result > 0 ? result : undefined;
}

function deepFind(value: unknown, keys: string[], depth = 0): unknown {
  if (value == null || depth > 10 || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFind(item, keys, depth + 1);
      if (found !== undefined && found !== null && text(found)) return found;
    }
    return undefined;
  }
  const row = value as Record<string, unknown>;
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && text(row[key])) return row[key];
  }
  for (const child of Object.values(row)) {
    const found = deepFind(child, keys, depth + 1);
    if (found !== undefined && found !== null && text(found)) return found;
  }
  return undefined;
}

function deepFindAll(value: unknown, keys: string[], depth = 0, output: unknown[] = []): unknown[] {
  if (value == null || depth > 10 || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) deepFindAll(item, keys, depth + 1, output);
    return output;
  }
  const row = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = row[key];
    if (candidate !== undefined && candidate !== null && text(candidate)) output.push(candidate);
  }
  for (const child of Object.values(row)) deepFindAll(child, keys, depth + 1, output);
  return output;
}

export function extractEncarExactFuel(vehicle: unknown) {
  const rawValues = [...new Set(deepFindAll(vehicle, ["fuelTypeName", "FuelTypeName", "fuelTypeNm", "fuelName", "fuelType", "FuelType", "fuel", "Fuel"])
    .map(text)
    .filter((value) => value && !/^\d+$/.test(value)))];
  const normalized = rawValues.map((value) => canonicalSourceFuel(value)).filter(Boolean);
  const kinds = new Set(normalized);
  // Some Encar payloads expose gasoline and electricity in separate exact
  // fields. Together they identify one hybrid vehicle; choosing the first
  // recursive key used to downgrade it to ordinary petrol.
  const fuel = kinds.has("hybrid") || (kinds.has("electric") && (kinds.has("petrol") || kinds.has("diesel") || kinds.has("lpg")))
    ? "hybrid"
    : kinds.size === 1
      ? [...kinds][0]
      : undefined;
  return { fuel, rawValues, status: fuel ? "exact" as const : rawValues.length ? "conflict" as const : "missing" as const };
}

function imageLike(value: string) {
  return /ci\.encar\.com|\/carpicture\/|\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(value);
}

function collectImageValues(value: unknown, key = "", depth = 0, output: string[] = []) {
  if (value == null || depth > 14) return output;
  if (typeof value === "string") {
    const candidate = text(value);
    if (candidate && imageLike(candidate) && /photo|image|picture|gallery|media|location|path|url|^$/i.test(key)) output.push(candidate);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectImageValues(item, key, depth + 1, output));
    return output;
  }
  if (typeof value !== "object") return output;
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    if (/photo|image|picture|gallery|media|location|path|url/i.test(childKey) || depth < 7) collectImageValues(child, childKey, depth + 1, output);
  }
  return output;
}

function absoluteImageUrl(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return buildEncarImageUrl(raw, 1);
}

function uniqueUrls(values: string[], limit: number) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const url = absoluteImageUrl(value);
    const key = url.replace(/[?#].*$/, "").toLowerCase();
    if (!url || !imageLike(url) || seen.has(key)) continue;
    seen.add(key);
    result.push(url);
    if (result.length >= limit) break;
  }
  return result;
}

function urlImage(url: string): CatalogImage {
  const extension = url.match(/\.(jpe?g|png|webp)(?:[?#]|$)/i)?.[1]?.toLowerCase();
  return {
    id: "",
    url,
    objectKey: "",
    checksum: "",
    size: 0,
    mimeType: extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg",
  };
}

function retryableEncarError(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return Boolean(
    (error as any)?.temporary
      || /fetch failed|source_timeout|page_timeout|network|econnreset|etimedout|socket|rate_limited_429|http_5\d\d/.test(message),
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/*
 * The complete adapter used to bypass the normal Encar detail limiter and the
 * generic collector could fan out six exact-detail requests at once. In the
 * long Korea run this made page 0 succeed, then every list request for offset
 * 50 fail, while an isolated list-only probe fetched 0/50/100/150 normally.
 * Pace the exact-detail endpoint so list pagination shares a calm connection/IP
 * profile. This changes transport timing only; source identity and acceptance
 * rules remain untouched.
 */
let detailQueue: Promise<unknown> = Promise.resolve();
let lastDetailStart = 0;
async function pacedDetail<T>(operation: () => Promise<T>): Promise<T> {
  const configured = Number(process.env.CATALOG_ENCAR_COMPLETE_DETAIL_RPM || 180);
  const rpm = Math.max(20, Math.min(240, Number.isFinite(configured) ? configured : 180));
  const gapMs = Math.ceil(60_000 / rpm);
  const task = detailQueue.then(async () => {
    const waitMs = Math.max(0, lastDetailStart + gapMs - Date.now());
    if (waitMs) await sleep(waitMs);
    lastDetailStart = Date.now();
    return await operation();
  });
  detailQueue = task.catch(() => undefined);
  return task;
}

async function fetchDetail(sourceOfferId: string) {
  return pacedDetail(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS || 25_000));
    try {
      const response = await fetch(`https://api.encar.com/v1/readside/vehicle/${encodeURIComponent(sourceOfferId)}`, {
        headers: ENCAR_HEADERS,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`encar_detail_http_${response.status}`);
      return await response.json() as any;
    } finally {
      clearTimeout(timeout);
    }
  });
}

export function extractEncarExactBodyType(vehicle: unknown) {
  // `carType` and list `Category` are Encar navigation/classification fields,
  // not proven body-shape fields. Accept only explicitly body-named detail keys.
  return text(deepFind(vehicle, ["bodyType", "BodyType"]));
}

function mergeDetail(offer: VehicleOffer, detail: any) {
  const vehicle = detail?.vehicle || detail?.Vehicle || detail;
  const exactEngineCc = number(deepFind(vehicle, ["displacement", "Displacement", "EngineDisplacement", "engineDisplacement", "cc"]));
  const exactPowerHp = number(deepFind(vehicle, ["power", "Power", "horsePower", "horsepower", "ps"]));
  const exactFuelEvidence = extractEncarExactFuel(vehicle);
  const exactTransmission = text(deepFind(vehicle, ["transmission", "Transmission", "gearbox", "Gearbox"]));
  const exactDrive = text(deepFind(vehicle, ["drive", "Drive", "driveType", "DriveType", "drivetrain"]));
  // Encar list Category and generic carType are not trusted as body-shape fields.
  // Only body-specific exact-detail keys may publish a body type; otherwise it remains unknown.
  const exactBodyType = extractEncarExactBodyType(vehicle);
  const exactColor = text(deepFind(vehicle, ["color", "Color", "exteriorColor"]));
  const exactProductionDate = text(deepFind(vehicle, ["registrationDate", "RegistrationDate", "formYear", "productionDate"]));
  const fuelConflict = exactFuelEvidence.status === "conflict";

  const merged = normalizeVehicleOfferSpecs({
    ...offer,
    engineCc: exactEngineCc || offer.engineCc,
    fuel: fuelConflict ? undefined : exactFuelEvidence.fuel || offer.fuel,
    powertrainKind: fuelConflict ? "unknown" : offer.powertrainKind,
    powerHp: fuelConflict ? undefined : exactPowerHp || offer.powerHp,
    powerKw: fuelConflict ? undefined : offer.powerKw,
    icePowerKw: fuelConflict ? undefined : offer.icePowerKw,
    utilizationPowerKw: fuelConflict ? undefined : offer.utilizationPowerKw,
    transmission: exactTransmission || offer.transmission,
    drive: exactDrive || offer.drive,
    bodyType: exactBodyType || undefined,
    color: exactColor || offer.color,
    productionDate: exactProductionDate || offer.productionDate,
    calculationStatus: fuelConflict ? "needs_data" : offer.calculationStatus,
    operational: {
      ...(offer.operational || {}),
      raw: { offer: offer.operational?.raw, detail },
      semanticEvidence: {
        ...((offer.operational as any)?.semanticEvidence || {}),
        fuel: { source: "encar_exact_detail", ...exactFuelEvidence },
      },
      vin: text(deepFind(vehicle, ["vin", "VIN"])),
      frameNumber: text(deepFind(vehicle, ["frameNo", "FrameNo", "frameNumber"])),
    },
  } as VehicleOffer);
  Object.assign(offer, merged);
}

export class EncarCompleteAdapter extends EncarDirectAdapter {
  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const maxAttempts = Math.max(1, Math.min(8, Number(process.env.CATALOG_ENCAR_DIRECT_LIST_RETRIES || 5)));
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await super.fetchPage(cursor);
      } catch (error) {
        lastError = error;
        if (!retryableEncarError(error) || attempt >= maxAttempts) throw error;
        const delay = Math.min(12_000, 900 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 350);
        console.warn(JSON.stringify({
          sourceId: this.sourceId,
          event: "list_retry",
          attempt,
          maxAttempts,
          cursor: cursor || null,
          delayMs: delay,
          error: String((error as any)?.message || error),
        }));
        await sleep(delay);
      }
    }
    throw lastError;
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const requested = Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30);
    const limit = Math.min(30, Math.max(5, Number.isFinite(requested) ? requested : 30));
    const minimum = Math.min(limit, Math.max(5, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 5)));

    /* Identity rule: once a vehicle ID is known, the gallery comes only from
       that exact Encar detail response. Listing/raw images are not merged in. */
    const detail = await fetchDetail(String(offer.sourceOfferId || ""));
    const nonCashContractReason = encarNonCashContractReason(detail);
    if (nonCashContractReason) {
      offer.sourcePrice = null;
      offer.sourceCurrency = null;
      offer.totalRub = null;
      offer.priceMode = "estimated";
      offer.calculationStatus = "needs_data";
      offer.operational = {
        ...(offer.operational || {}),
        raw: { offer: offer.operational?.raw, detail },
        galleryVerified: false,
        photoIdentityVerified: false,
        nonCashContractRejected: true,
        nonCashContractReason,
      } as any;
      return [];
    }
    mergeDetail(offer, detail);
    const detailUrls = uniqueUrls(extractEncarImageUrls(offer, detail), limit * 2);
    const gallery = detailUrls.slice(0, limit).map(urlImage);
    const verified = gallery.length >= minimum;

    offer.operational = {
      ...(offer.operational || {}),
      galleryVerified: verified,
      photoIdentityVerified: verified,
      galleryImageCount: gallery.length,
      galleryRefreshedAt: new Date().toISOString(),
      gallerySafetyMode: "encar_source_cover_photolist_v3",
      galleryStoredAs: "json_urls",
    } as any;

    return verified ? gallery : [];
  }
}

export const encarCompleteSource = new EncarCompleteAdapter();

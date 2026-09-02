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

function deepFindEntries(value: unknown, keys: string[], depth = 0, output: Array<{ key: string; value: unknown }> = []) {
  if (value == null || depth > 10 || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) deepFindEntries(item, keys, depth + 1, output);
    return output;
  }
  const row = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = row[key];
    if (candidate !== undefined && candidate !== null && text(candidate)) output.push({ key, value: candidate });
  }
  for (const child of Object.values(row)) deepFindEntries(child, keys, depth + 1, output);
  return output;
}

type EncarMetricEvidenceStatus = "exact" | "ambiguous" | "conflict" | "missing";

type EncarMetricEvidence = {
  value?: number;
  rawValues: string[];
  status: EncarMetricEvidenceStatus;
};

function exactMetricText(value: unknown) {
  return text(value).replace(/\u00a0|\u202f/g, " ").replace(/\s+/g, " ").trim();
}

function metricNumber(value: string) {
  const compact = value.replace(/\s/g, "");
  if (/^\d{1,3}(?:,\d{3})+$/.test(compact)) return Number(compact.replace(/,/g, ""));
  if (/^\d{1,3}(?:\.\d{3})+$/.test(compact)) return Number(compact.replace(/\./g, ""));
  if (/^\d+(?:[.,]\d+)?$/.test(compact)) return Number(compact.replace(",", "."));
  return undefined;
}

function rangedMetric(value: string) {
  return /(?:\d\s*(?:-|–|—|~|〜|～)\s*\d)|(?:from|to|up\s+to|under|over|less\s+than|more\s+than|이하|이상|미만|초과)|[<>≤≥]/i.test(value);
}

function engineCcValue(value: unknown, key = "") {
  const raw = exactMetricText(value);
  if (!raw || rangedMetric(raw)) return undefined;
  const match = raw.match(/^([0-9][0-9 ,.]{0,8})\s*(cc|cm3|cm³|시시|씨씨|l|liter|litre|리터)?$/i);
  const unit = String(match?.[2] || "").toLowerCase();
  const liters = /^(?:l|liter|litre|리터)$/.test(unit) || /liters|volume/i.test(key);
  const parsed = liters
    ? Number(String(match?.[1] || "").replace(/\s/g, "").replace(",", "."))
    : metricNumber(match?.[1] || "");
  if (!parsed) return undefined;
  const cc = liters ? parsed * 1_000 : parsed;
  return cc >= 300 && cc <= 10_000 ? Math.round(cc) : undefined;
}

function powerHpValue(value: unknown, key = "") {
  const raw = exactMetricText(value);
  if (!raw || rangedMetric(raw)) return undefined;
  const match = raw.match(/^([0-9][0-9 ,.]{0,8})\s*(hp|ps|bhp|마력|kw|킬로와트)?$/i);
  const parsed = metricNumber(match?.[1] || "");
  if (!parsed) return undefined;
  const unit = String(match?.[2] || "").toLowerCase();
  const kilowatts = /^(?:kw|킬로와트)$/.test(unit) || /kw$/i.test(key);
  const hp = kilowatts ? parsed * 1.3596216173 : parsed;
  return hp >= 20 && hp <= 2_500 ? Math.round(hp * 10) / 10 : undefined;
}

function exactMetricEvidence(
  value: unknown,
  keys: string[],
  parser: (raw: unknown, key: string) => number | undefined,
  tolerance = 0,
): EncarMetricEvidence {
  const entries = deepFindEntries(value, keys);
  const rawValues = [...new Set(entries.map((entry) => exactMetricText(entry.value)).filter(Boolean))];
  if (!entries.length) return { rawValues, status: "missing" };
  const parsed = entries.map((entry) => parser(entry.value, entry.key));
  if (parsed.some((item) => item === undefined)) return { rawValues, status: "ambiguous" };
  const values = [...new Set(parsed as number[])];
  if (Math.max(...values) - Math.min(...values) > tolerance) return { rawValues, status: "conflict" };
  return { value: values[0], rawValues, status: "exact" };
}

export function extractEncarExactEngineCc(vehicle: unknown): EncarMetricEvidence {
  return exactMetricEvidence(vehicle, [
    "displacement", "Displacement", "EngineDisplacement", "engineDisplacement", "engineCc", "engine_cc",
    "engine_displacement", "engineCapacity", "engine_capacity", "cc", "engineLiters", "engine_liters",
    "engineVolume", "engine_volume", "volumeLiters",
  ], engineCcValue);
}

export function extractEncarExactPowerHp(vehicle: unknown): EncarMetricEvidence {
  return exactMetricEvidence(vehicle, [
    "power", "Power", "enginePower", "maxPower", "horsePower", "horsepower", "powerHp", "power_hp",
    "horse_power", "enginePowerHp", "maxPowerHp", "hp", "ps", "cv", "powerKw", "power_kw",
    "enginePowerKw", "engine_power_kw", "motorPowerKw", "maxPowerKw", "kw",
  ], powerHpValue, 1);
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

export function mergeEncarCompleteDetail(offer: VehicleOffer, detail: any) {
  const vehicle = detail?.vehicle || detail?.Vehicle || detail;
  const sourcePayload = { listing: offer.operational?.raw, detail: vehicle };
  const extractedEngineEvidence = extractEncarExactEngineCc(sourcePayload);
  const extractedPowerEvidence = extractEncarExactPowerHp(sourcePayload);
  const extractedFuelEvidence = extractEncarExactFuel(sourcePayload);
  const exactEngineEvidence = extractedEngineEvidence.status === "missing" && offer.engineCc
    ? { ...extractedEngineEvidence, status: "ambiguous" as const, rawValues: [String(offer.engineCc)] }
    : extractedEngineEvidence;
  const exactPowerEvidence = extractedPowerEvidence.status === "missing" && (offer.powerHp || offer.powerKw)
    ? { ...extractedPowerEvidence, status: "ambiguous" as const, rawValues: [String(offer.powerHp || offer.powerKw)] }
    : extractedPowerEvidence;
  const exactFuelEvidence = extractedFuelEvidence.status === "missing" && (offer.fuel || offer.powertrainKind)
    ? { ...extractedFuelEvidence, status: "ambiguous" as const, rawValues: [String(offer.fuel || offer.powertrainKind)] }
    : extractedFuelEvidence;
  const exactTransmission = text(deepFind(vehicle, ["transmission", "Transmission", "gearbox", "Gearbox"]));
  const exactDrive = text(deepFind(vehicle, ["drive", "Drive", "driveType", "DriveType", "drivetrain"]));
  // Encar list Category and generic carType are not trusted as body-shape fields.
  // Only body-specific exact-detail keys may publish a body type; otherwise it remains unknown.
  const exactBodyType = extractEncarExactBodyType(vehicle);
  const exactColor = text(deepFind(vehicle, ["color", "Color", "exteriorColor"]));
  const exactProductionDate = text(deepFind(vehicle, ["registrationDate", "RegistrationDate", "formYear", "productionDate"]));
  const fuelUnsafe = exactFuelEvidence.status !== "exact";
  const engineUnsafe = exactEngineEvidence.status !== "exact" && exactFuelEvidence.fuel !== "electric";
  const powerUnsafe = exactPowerEvidence.status !== "exact";

  const merged = normalizeVehicleOfferSpecs({
    ...offer,
    engineCc: exactEngineEvidence.status === "exact" ? exactEngineEvidence.value : engineUnsafe ? undefined : offer.engineCc,
    fuel: fuelUnsafe ? undefined : exactFuelEvidence.fuel || offer.fuel,
    powertrainKind: fuelUnsafe ? "unknown" : offer.powertrainKind,
    powerHp: fuelUnsafe || powerUnsafe ? undefined : exactPowerEvidence.status === "exact" ? exactPowerEvidence.value : offer.powerHp,
    powerKw: fuelUnsafe || powerUnsafe ? undefined : offer.powerKw,
    icePowerKw: fuelUnsafe || powerUnsafe ? undefined : offer.icePowerKw,
    utilizationPowerKw: fuelUnsafe || powerUnsafe ? undefined : offer.utilizationPowerKw,
    transmission: exactTransmission || offer.transmission,
    drive: exactDrive || offer.drive,
    bodyType: exactBodyType || undefined,
    color: exactColor || offer.color,
    productionDate: exactProductionDate || offer.productionDate,
    powerDataConfidence: exactPowerEvidence.status === "exact" ? "source_exact" : powerUnsafe ? undefined : offer.powerDataConfidence,
    powerDataSource: exactPowerEvidence.status === "exact" ? "encar_listing_and_exact_detail:power" : powerUnsafe ? undefined : offer.powerDataSource,
    calculationStatus: fuelUnsafe || engineUnsafe || powerUnsafe ? "needs_data" : offer.calculationStatus,
    operational: {
      ...(offer.operational || {}),
      raw: { offer: offer.operational?.raw, detail },
      semanticEvidence: {
        ...((offer.operational as any)?.semanticEvidence || {}),
        fuel: { source: "encar_exact_detail", ...exactFuelEvidence },
        engineCc: { source: "encar_listing_and_exact_detail", ...exactEngineEvidence },
        powerHp: { source: "encar_listing_and_exact_detail", ...exactPowerEvidence },
      },
      vin: text(deepFind(vehicle, ["vin", "VIN"])),
      frameNumber: text(deepFind(vehicle, ["frameNo", "FrameNo", "frameNumber"])),
    },
  } as VehicleOffer);
  // Normalization intentionally scans retained raw payloads for legacy sources.
  // Once Encar's own keyed evidence proves ambiguity or conflict, do not let
  // that generic fallback rediscover the first number and undo fail-closed.
  if (exactEngineEvidence.status !== "exact") merged.engineCc = undefined;
  if (fuelUnsafe) {
    merged.fuel = undefined;
    merged.powertrainKind = "unknown";
  }
  if (fuelUnsafe || powerUnsafe) {
    merged.powerHp = undefined;
    merged.powerKw = undefined;
    merged.icePowerKw = undefined;
    merged.utilizationPowerKw = undefined;
    merged.powerDataConfidence = undefined;
    merged.powerDataSource = undefined;
  }
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
    mergeEncarCompleteDetail(offer, detail);
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

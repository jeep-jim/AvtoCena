import { EncarDirectAdapter, buildEncarImageUrl } from "./adapters";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import type { CatalogFetchResult, CatalogImage, VehicleOffer } from "./types";

const ENCAR_HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  origin: "https://fem.encar.com",
  referer: "https://fem.encar.com/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};

function text(value: unknown) {
  return value == null ? "" : String(value).trim().replace(/\\\//g, "/");
}

function number(value: unknown) {
  const result = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(result) && result > 0 ? result : undefined;
}

function deepFind(value: unknown, keys: string[], depth = 0): unknown {
  if (value == null || depth > 12 || typeof value !== "object") return undefined;
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

function imageLike(value: string) {
  return /ci\.encar\.com|\/carpicture\/|\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(value)
    && !/logo|icon|banner|sheet|diagram|inspection|event|promotion/i.test(value);
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

async function fetchDetail(sourceOfferId: string) {
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
}

function mergeDetail(offer: VehicleOffer, detail: any) {
  const vehicle = detail?.vehicle || detail?.Vehicle || detail;
  const powerHp = offer.powerHp || number(deepFind(vehicle, [
    "power", "Power", "horsePower", "horsepower", "HorsePower", "maxPowerPs", "MaxPowerPs", "ps", "PS",
  ]));
  const merged = normalizeVehicleOfferSpecs({
    ...offer,
    engineCc: offer.engineCc || number(deepFind(vehicle, ["displacement", "Displacement", "EngineDisplacement", "engineDisplacement", "cc"])),
    powerHp,
    powerDataConfidence: powerHp ? (offer.powerDataConfidence || "source_exact") : offer.powerDataConfidence,
    powerDataSource: powerHp ? (offer.powerDataSource || "encar_exact_detail") : offer.powerDataSource,
    fuel: offer.fuel || text(deepFind(vehicle, ["fuelType", "FuelType", "fuel", "Fuel"])),
    transmission: offer.transmission || text(deepFind(vehicle, ["transmission", "Transmission", "gearbox", "Gearbox"])),
    drive: offer.drive || text(deepFind(vehicle, ["drive", "Drive", "driveType", "DriveType", "drivetrain"])),
    bodyType: offer.bodyType || text(deepFind(vehicle, ["category", "Category", "bodyType", "BodyType", "carType"])),
    color: offer.color || text(deepFind(vehicle, ["color", "Color", "exteriorColor"])),
    productionDate: offer.productionDate || text(deepFind(vehicle, ["registrationDate", "RegistrationDate", "formYear", "productionDate"])),
    operational: {
      ...(offer.operational || {}),
      detailIdentityVerified: true,
      fieldIdentityVerified: true,
      raw: {
        exactDetail: detail,
        detailIdentityVerified: true,
        fieldIdentityVerified: true,
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

    const detail = await fetchDetail(String(offer.sourceOfferId || ""));
    mergeDetail(offer, detail);
    const detailUrls = uniqueUrls(collectImageValues(detail), limit * 4);
    const gallery = detailUrls.slice(0, limit).map(urlImage);
    const verified = gallery.length >= minimum;

    offer.operational = {
      ...(offer.operational || {}),
      galleryVerified: verified,
      photoIdentityVerified: verified,
      vehiclePhotoVerified: verified,
      detailIdentityVerified: true,
      fieldIdentityVerified: true,
      galleryImageCount: gallery.length,
      galleryRefreshedAt: new Date().toISOString(),
      gallerySafetyMode: "encar_detail_only_v3",
      galleryStoredAs: "json_urls",
      raw: {
        ...((offer.operational as any)?.raw || {}),
        photoIdentityVerified: verified,
        vehiclePhotoVerified: verified,
        detailIdentityVerified: true,
        fieldIdentityVerified: true,
      },
    } as any;

    return verified ? gallery : [];
  }
}

export const encarCompleteSource = new EncarCompleteAdapter();

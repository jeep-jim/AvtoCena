import { EncarDirectAdapter, buildEncarImageUrl } from "./adapters";
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

function positive(value: unknown) {
  const result = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(result) && result > 0 ? result : undefined;
}

function encarPriceWon(value: unknown) {
  const number = positive(value);
  if (!number) return undefined;
  // Encar passenger listings normally expose price in 만원 (10,000 KRW).
  if (number >= 100 && number < 1_000_000) return Math.round(number * 10_000);
  if (number >= 1_000_000 && number <= 5_000_000_000) return Math.round(number);
  return undefined;
}

function fuel(value: unknown) {
  const raw = text(value);
  if (/가솔린|gasoline|petrol/i.test(raw)) return "petrol";
  if (/디젤|diesel/i.test(raw)) return "diesel";
  if (/전기|electric|\bev\b/i.test(raw)) return "electric";
  if (/하이브리드|hybrid|phev|hev/i.test(raw)) return "hybrid";
  if (/lpg/i.test(raw)) return "lpg";
  return raw || undefined;
}

function transmission(value: unknown) {
  const raw = text(value);
  if (/오토|automatic|\bat\b/i.test(raw)) return "automatic";
  if (/수동|manual|\bmt\b/i.test(raw)) return "manual";
  if (/cvt/i.test(raw)) return "cvt";
  if (/dct|dsg|듀얼/i.test(raw)) return "dct";
  return raw || undefined;
}

function exactDrive(category: any) {
  const raw = [category?.gradeEnglishName, category?.gradeName, category?.gradeDetailEnglishName, category?.gradeDetailName]
    .map(text).filter(Boolean).join(" ");
  if (/\b(?:AWD|4WD|4X4)\b|사륜/i.test(raw)) return "awd";
  if (/\bFWD\b|전륜/i.test(raw)) return "fwd";
  if (/\bRWD\b|후륜/i.test(raw)) return "rwd";
  // 2WD alone does not tell us front vs rear drive, so it is deliberately left empty.
  return undefined;
}

function exactYear(category: any) {
  const form = positive(category?.formYear);
  if (form && form >= 1990 && form <= new Date().getFullYear() + 1) return Math.round(form);
  const yearMonth = text(category?.yearMonth || category?.yearMon);
  const match = yearMonth.match(/((?:19|20)\d{2})/);
  return match ? Number(match[1]) : undefined;
}

function imageLike(value: string) {
  return /ci\.encar\.com|\/carpicture\/|\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(value)
    && !/logo|icon|banner|sheet|diagram|inspection|event|promotion/i.test(value);
}

function collectPhotoValues(value: unknown, key = "", depth = 0, output: string[] = []) {
  if (value == null || depth > 10) return output;
  if (typeof value === "string") {
    const candidate = text(value);
    if (candidate && imageLike(candidate) && /photo|image|picture|location|path|url|src|^$/i.test(key)) output.push(candidate);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectPhotoValues(item, key, depth + 1, output));
    return output;
  }
  if (typeof value !== "object") return output;
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    if (/photo|image|picture|location|path|url|src/i.test(childKey) || depth < 5) collectPhotoValues(child, childKey, depth + 1, output);
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

function mergeExactDetail(offer: VehicleOffer, detail: any) {
  const category = detail?.category || {};
  const spec = detail?.spec || {};
  const advertisement = detail?.advertisement || {};
  const exactMake = text(category.manufacturerEnglishName || category.manufacturerName);
  const exactModel = text(category.modelEnglishName || category.modelName || category.modelGroupEnglishName || category.modelGroupName);
  const exactTrim = [category.gradeEnglishName || category.gradeName, category.gradeDetailEnglishName || category.gradeDetailName]
    .map(text).filter(Boolean).join(" ");
  const year = exactYear(category);
  const mileageKm = positive(spec.mileage);
  const engineCc = positive(spec.displacement);
  const exactFuel = fuel(spec.fuelName);
  const exactTransmission = transmission(spec.transmissionName);
  const bodyType = text(spec.bodyName) || undefined;
  const drive = exactDrive(category);
  const sourcePrice = encarPriceWon(advertisement.price);
  const sourceExactFields = [
    ...(exactMake ? ["make"] : []),
    ...(exactModel ? ["model"] : []),
    ...(year ? ["year"] : []),
    ...(mileageKm != null ? ["mileageKm"] : []),
    ...(engineCc ? ["engineCc"] : []),
    ...(exactFuel ? ["fuel"] : []),
    ...(exactTransmission ? ["transmission"] : []),
    ...(bodyType ? ["bodyType"] : []),
    ...(drive ? ["drive"] : []),
    ...(sourcePrice ? ["sourcePrice", "sourceCurrency"] : []),
  ];

  Object.assign(offer, {
    ...offer,
    sourceTitle: [exactMake, exactModel, exactTrim].filter(Boolean).join(" ") || offer.sourceTitle,
    make: exactMake || "",
    model: exactModel || "",
    trim: exactTrim || undefined,
    year: year || 0,
    mileageKm,
    engineCc,
    fuel: exactFuel,
    transmission: exactTransmission,
    drive,
    bodyType,
    powerHp: undefined,
    powerKw: undefined,
    powerDataConfidence: undefined,
    powerDataSource: undefined,
    sourcePrice: sourcePrice || null,
    sourceCurrency: sourcePrice ? "KRW" : null,
    priceMode: sourcePrice ? "fixed" : "estimated",
    totalRub: null,
    calculationStatus: "needs_power_data",
    operational: {
      ...(offer.operational || {}),
      sourceTitle: [exactMake, exactModel, exactTrim].filter(Boolean).join(" "),
      detailIdentityVerified: true,
      fieldIdentityVerified: true,
      sourceExactFields,
      vin: text(detail?.vin) || undefined,
      frameNumber: text(detail?.frameNo || detail?.frameNumber) || undefined,
      raw: {
        exactDetail: detail,
        detailIdentityVerified: true,
        fieldIdentityVerified: true,
        sourceExactFields,
      },
    },
  } satisfies Partial<VehicleOffer>);
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
        console.warn(JSON.stringify({ sourceId: this.sourceId, event: "list_retry", attempt, maxAttempts, cursor: cursor || null, delayMs: delay, error: String((error as any)?.message || error) }));
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
    mergeExactDetail(offer, detail);
    const detailUrls = uniqueUrls(collectPhotoValues(detail?.photos || []), limit * 4);
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
      gallerySafetyMode: "encar_exact_photos_array_only_v4",
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

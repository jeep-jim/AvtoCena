import { EncarDirectAdapter, buildEncarImageUrl } from "./adapters";
import { cacheImageFromUrl } from "./storage";
import type { CatalogImage, VehicleOffer } from "./types";

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

function uniqueImages(images: CatalogImage[], limit: number) {
  const result: CatalogImage[] = [];
  const seen = new Set<string>();
  for (const image of images) {
    const key = String(image.id || image.checksum || image.objectKey || image.url || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(image);
    if (result.length >= limit) break;
  }
  return result;
}

async function cacheUrls(urls: string[], limit: number) {
  const saved: CatalogImage[] = [];
  for (const url of urls) {
    const image = await cacheImageFromUrl(url, "korea", { headers: ENCAR_HEADERS }).catch(() => null);
    if (image && Number(image.size || 0) > 8_000) saved.push(image);
    if (saved.length >= limit) break;
  }
  return uniqueImages(saved, limit);
}

export class EncarCompleteAdapter extends EncarDirectAdapter {
  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const requested = Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30);
    const limit = Math.min(30, Math.max(1, Number.isFinite(requested) ? requested : 30));
    const minimum = Math.max(1, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 1));
    const fastPath = /^(?:1|true|yes)$/i.test(String(process.env.CATALOG_GALLERY_FAST_PATH || ""));
    const raw: any = offer.operational?.raw || {};
    const cover = text(raw.Photo ?? raw.photo ?? raw.Image ?? raw.image ?? raw.PhotoPath ?? raw.photoPath);
    const listing = cover ? await cacheUrls(uniqueUrls([cover], 1), 1) : [];

    // Если выдача уже содержит реальное фото и достаточные характеристики для расчёта,
    // не открываем detail для каждой из тысяч карточек.
    if (fastPath && listing.length >= minimum && Number(offer.engineCc || 0) > 0) {
      (offer.operational as any).galleryVerified = true;
      (offer.operational as any).galleryImageCount = listing.length;
      (offer.operational as any).gallerySafetyMode = "encar_listing_cover";
      return listing;
    }

    // Базовый адаптер один раз получает detail, одновременно обогащает характеристики
    // и сохраняет основные фотографии. Раньше после этого выполнялся второй такой же запрос.
    const detailed = await super.fetchImages(offer).catch(() => [] as CatalogImage[]);
    const enrichedRaw: any = offer.operational?.raw || {};
    const extraUrls = uniqueUrls(collectImageValues(enrichedRaw?.detail || enrichedRaw), limit * 2);
    const existingKeys = new Set([...listing, ...detailed].map((image) => String(image.url || image.objectKey || image.id || "")));
    const extras = await cacheUrls(extraUrls.filter((url) => !existingKeys.has(url)), Math.max(0, limit - listing.length - detailed.length));
    const saved = uniqueImages([...listing, ...detailed, ...extras], limit);

    (offer.operational as any).galleryVerified = saved.length >= minimum;
    (offer.operational as any).galleryImageCount = saved.length;
    (offer.operational as any).galleryRefreshedAt = new Date().toISOString();
    (offer.operational as any).gallerySafetyMode = "encar_single_detail";
    return saved;
  }
}

export const encarCompleteSource = new EncarCompleteAdapter();

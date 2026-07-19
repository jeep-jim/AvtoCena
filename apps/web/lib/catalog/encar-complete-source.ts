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

function positiveNumber(value: unknown) {
  const number = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function imageLike(value: string) {
  return /ci\.encar\.com|\/carpicture\/|\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(value);
}

function collectImageValues(value: unknown, key = "", depth = 0, output: Array<{ value: string; index?: number }> = []) {
  if (value == null || depth > 14) return output;

  if (typeof value === "string") {
    const candidate = text(value);
    if (candidate && (imageLike(candidate) || /photo|image|picture|gallery|media|location|path|url/i.test(key))) {
      if (imageLike(candidate) || /^\/?carpicture\//i.test(candidate)) output.push({ value: candidate });
    }
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (item && typeof item === "object") {
        const object = item as Record<string, unknown>;
        const candidate = text(object.path ?? object.url ?? object.photo ?? object.Photo ?? object.image ?? object.Image ?? object.location ?? object.Location);
        const imageIndex = positiveNumber(object.imageNumber ?? object.ImageNumber ?? object.no ?? object.No ?? object.seq ?? object.order ?? object.index) ?? index + 1;
        if (candidate && (imageLike(candidate) || /^\/?carpicture\//i.test(candidate))) output.push({ value: candidate, index: imageIndex });
      }
      collectImageValues(item, key, depth + 1, output);
    });
    return output;
  }

  if (typeof value !== "object") return output;
  const object = value as Record<string, unknown>;
  const direct = text(object.path ?? object.url ?? object.photo ?? object.Photo ?? object.image ?? object.Image ?? object.location ?? object.Location);
  const directIndex = positiveNumber(object.imageNumber ?? object.ImageNumber ?? object.no ?? object.No ?? object.seq ?? object.order ?? object.index);
  if (direct && (imageLike(direct) || /^\/?carpicture\//i.test(direct))) output.push({ value: direct, index: directIndex });

  for (const [childKey, child] of Object.entries(object)) {
    if (/photo|image|picture|gallery|media|location|path|url/i.test(childKey) || depth < 7) {
      collectImageValues(child, childKey, depth + 1, output);
    }
  }
  return output;
}

function deepNumber(value: unknown, keys: string[], depth = 0): number | undefined {
  if (value == null || depth > 14 || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepNumber(item, keys, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const object = value as Record<string, unknown>;
  for (const key of keys) {
    const found = positiveNumber(object[key]);
    if (found) return found;
  }
  for (const child of Object.values(object)) {
    const found = deepNumber(child, keys, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function deepString(value: unknown, keys: string[], depth = 0): string {
  if (value == null || depth > 14 || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepString(item, keys, depth + 1);
      if (found) return found;
    }
    return "";
  }
  const object = value as Record<string, unknown>;
  for (const key of keys) {
    const found = text(object[key]);
    if (found) return found;
  }
  for (const child of Object.values(object)) {
    const found = deepString(child, keys, depth + 1);
    if (found) return found;
  }
  return "";
}

function sequenceUrl(rawValue: unknown, imageNumber: number) {
  const raw = text(rawValue);
  if (!raw) return "";
  const padded = String(Math.max(1, imageNumber)).padStart(3, "0");

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      if (/(?:^|\/)(\d{3})(\.(?:jpe?g|png|webp))$/i.test(url.pathname)) {
        url.pathname = url.pathname.replace(/(\d{3})(\.(?:jpe?g|png|webp))$/i, `${padded}$2`);
        return url.toString();
      }
      if (!/\.(?:jpe?g|png|webp)$/i.test(url.pathname)) {
        url.pathname = `${url.pathname.replace(/\/+$/, "")}${padded}.jpg`;
        return url.toString();
      }
      return imageNumber === 1 ? url.toString() : "";
    } catch {
      return imageNumber === 1 ? raw : "";
    }
  }

  if (/(\d{3})(\.(?:jpe?g|png|webp))$/i.test(raw)) {
    return buildEncarImageUrl(raw.replace(/(\d{3})(\.(?:jpe?g|png|webp))$/i, `${padded}$2`), imageNumber);
  }
  return buildEncarImageUrl(raw, imageNumber);
}

function uniqueUrls(values: string[], limit: number) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const url = text(value);
    if (!/^https?:\/\//i.test(url) || !imageLike(url)) continue;
    const canonical = url.replace(/[?#].*$/, "").toLowerCase();
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    result.push(url);
    if (result.length >= limit) break;
  }
  return result;
}

function imageIdentity(image: CatalogImage) {
  return String(image.id || image.checksum || image.objectKey || image.url || "");
}

export class EncarCompleteAdapter extends EncarDirectAdapter {
  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const limit = Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 80));
    const originalRaw: any = offer.operational?.raw || {};
    const initial = await super.fetchImages(offer).catch(() => [] as CatalogImage[]);

    const detailUrl = `https://api.encar.com/v1/readside/vehicle/${offer.sourceOfferId}`;
    const response = await fetch(detailUrl, { headers: ENCAR_HEADERS, redirect: "follow" });
    if (!response.ok) return initial.slice(0, limit);
    const detail = await response.json() as any;

    const explicit = collectImageValues(detail);
    const cover = text(
      originalRaw.Photo
      ?? originalRaw.photo
      ?? originalRaw.Image
      ?? originalRaw.image
      ?? originalRaw.PhotoPath
      ?? originalRaw.photoPath
      ?? deepString(detail, ["Photo", "photo", "PhotoPath", "photoPath", "Image", "image", "imagePath", "path"]),
    );
    const reportedCount = Math.min(limit, Math.max(0, Number(
      deepNumber(detail, ["photoCount", "PhotoCount", "photosCount", "imageCount", "ImageCount", "totalPhotoCount", "pictureCount", "PictureCount"])
      ?? positiveNumber(originalRaw.PhotoCount ?? originalRaw.photoCount ?? originalRaw.ImageCount ?? originalRaw.imageCount)
      ?? 0,
    )));

    const candidates: string[] = [];
    for (const item of explicit) {
      candidates.push(sequenceUrl(item.value, item.index || 1) || buildEncarImageUrl(item.value, item.index || 1));
    }

    if (cover) {
      const sequenceCount = reportedCount || limit;
      for (let index = 1; index <= sequenceCount; index++) candidates.push(sequenceUrl(cover, index));
    }

    const urls = uniqueUrls(candidates, limit);
    const saved: CatalogImage[] = [];
    const seenImages = new Set<string>();
    for (const image of initial) {
      const key = imageIdentity(image);
      if (!key || seenImages.has(key)) continue;
      seenImages.add(key);
      saved.push(image);
    }

    let consecutiveFailures = 0;
    for (const url of urls) {
      if (saved.length >= limit) break;
      const image = await cacheImageFromUrl(url, "korea", { headers: ENCAR_HEADERS }).catch(() => null);
      if (!image || image.size <= 8_000) {
        consecutiveFailures++;
        if (!reportedCount && saved.length >= 3 && consecutiveFailures >= 7) break;
        continue;
      }
      consecutiveFailures = 0;
      const key = imageIdentity(image);
      if (!key || seenImages.has(key)) continue;
      seenImages.add(key);
      saved.push(image);
    }

    (offer.operational as any).raw = {
      ...(offer.operational as any).raw,
      completeGallery: {
        checkedAt: new Date().toISOString(),
        reportedCount,
        discoveredUrls: urls.length,
        savedImages: saved.length,
      },
    };
    return saved.slice(0, limit);
  }
}

export const encarCompleteSource = new EncarCompleteAdapter();

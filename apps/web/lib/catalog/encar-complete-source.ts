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

function galleryKey(value: string) {
  try {
    const url = new URL(value);
    const normalizedPath = decodeURIComponent(url.pathname)
      .replace(/\/(?:w|f)?_?\d+x\d+\//i, "/size/")
      .replace(/(\d{3})(\.(?:jpe?g|png|webp))$/i, "{seq}$2")
      .toLowerCase();
    return `${url.hostname.toLowerCase()}${normalizedPath}`;
  } catch {
    return "";
  }
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

function coherentUrls(values: string[], preferredKey: string, limit: number) {
  const groups = new Map<string, string[]>();
  for (const value of uniqueUrls(values, Math.max(limit * 8, 80))) {
    const group = galleryKey(value);
    if (!group) continue;
    groups.set(group, [...(groups.get(group) || []), value]);
  }
  if (preferredKey) return uniqueUrls(groups.get(preferredKey) || [], limit);
  const best = [...groups.entries()].sort((left, right) => right[1].length - left[1].length)[0];
  return best && best[1].length >= 2 ? uniqueUrls(best[1], limit) : [];
}

function imageIdentity(image: CatalogImage) {
  return String(image.id || image.checksum || image.objectKey || image.url || "");
}

function uniqueImages(images: CatalogImage[], limit: number) {
  const result: CatalogImage[] = [];
  const seen = new Set<string>();
  for (const image of images) {
    const key = imageIdentity(image);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(image);
    if (result.length >= limit) break;
  }
  return result;
}

export class EncarCompleteAdapter extends EncarDirectAdapter {
  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const requested = Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 12);
    const limit = Math.min(24, Math.max(1, Number.isFinite(requested) ? requested : 12));
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
    const coverUrl = cover ? sequenceUrl(cover, 1) : "";
    const preferredKey = galleryKey(coverUrl);
    const reportedCount = Math.min(limit, Math.max(0, Number(
      deepNumber(detail, ["photoCount", "PhotoCount", "photosCount", "imageCount", "ImageCount", "totalPhotoCount", "pictureCount", "PictureCount"])
      ?? positiveNumber(originalRaw.PhotoCount ?? originalRaw.photoCount ?? originalRaw.ImageCount ?? originalRaw.imageCount)
      ?? 0,
    )));

    const explicitUrls = explicit
      .map((item) => sequenceUrl(item.value, item.index || 1) || buildEncarImageUrl(item.value, item.index || 1))
      .filter(Boolean);
    const selectedExplicit = coherentUrls(explicitUrls, preferredKey, limit);
    const candidates: string[] = [];

    if (cover) {
      const sequenceCount = reportedCount || Math.max(4, Math.min(limit, selectedExplicit.length || 12));
      for (let index = 1; index <= sequenceCount; index++) candidates.push(sequenceUrl(cover, index));
    }
    candidates.push(...selectedExplicit);

    const urls = coherentUrls(candidates, preferredKey, limit);
    const fresh: CatalogImage[] = [];
    let consecutiveFailures = 0;
    for (const url of urls) {
      if (fresh.length >= limit) break;
      const image = await cacheImageFromUrl(url, "korea", { headers: ENCAR_HEADERS }).catch(() => null);
      if (!image || image.size <= 8_000) {
        consecutiveFailures++;
        if (!reportedCount && fresh.length >= 4 && consecutiveFailures >= 5) break;
        continue;
      }
      consecutiveFailures = 0;
      fresh.push(image);
    }

    const verified = fresh.length >= 2;
    const saved = verified ? uniqueImages(fresh, limit) : uniqueImages(initial, limit);
    (offer.operational as any).galleryVerified = verified;
    (offer.operational as any).gallerySourceKey = preferredKey || (urls[0] ? galleryKey(urls[0]) : "");
    (offer.operational as any).galleryImageCount = saved.length;
    (offer.operational as any).galleryRefreshedAt = new Date().toISOString();
    (offer.operational as any).raw = {
      ...(offer.operational as any).raw,
      completeGallery: {
        checkedAt: new Date().toISOString(),
        verified,
        reportedCount,
        discoveredUrls: urls.length,
        savedImages: saved.length,
      },
    };
    return saved.slice(0, limit);
  }
}

export const encarCompleteSource = new EncarCompleteAdapter();

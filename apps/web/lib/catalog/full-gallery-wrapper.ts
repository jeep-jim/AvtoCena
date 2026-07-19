import type { CatalogImage, CatalogSourceAdapter, VehicleOffer } from "./types";

const bad = /logo|icon|avatar|qrcode|placeholder|banner|tracking|pixel|seller|dealer|recommend|related|similar|favicon|badge|social|share|twitter|facebook|instagram|linkedin|youtube|tiktok|whatsapp|telegram|pinterest|threads/i;

function decode(value: unknown) {
  return String(value || "")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .trim();
}

function validSourceImage(value: unknown) {
  const raw = decode(value);
  if (!raw || bad.test(raw)) return false;
  try {
    const url = new URL(raw);
    return /\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(url.toString())
      || /olxcdn\.com|picture\d*\.goo-net\.com|\/image(?:[;/?#]|$)/i.test(url.toString());
  } catch {
    return /^\/?carpicture\//i.test(raw);
  }
}

function rawGalleryUrls(offer: VehicleOffer) {
  const raw = (offer.operational as any)?.raw;
  const values: unknown[] = [];
  for (const field of [raw?.images, raw?.photos, raw?.gallery, raw?.imageUrls, raw?.photoUrls]) {
    if (Array.isArray(field)) values.push(...field);
  }
  const result: string[] = [];
  for (const value of values) {
    if (typeof value === "string") result.push(value);
    else if (value && typeof value === "object") {
      for (const field of ["url", "src", "location", "path", "large", "original"]) {
        const candidate = (value as Record<string, unknown>)[field];
        if (typeof candidate === "string") result.push(candidate);
      }
    }
  }
  return [...new Set(result.map(decode).filter(validSourceImage))];
}

function imageKey(image: CatalogImage) {
  return String(image.id || image.checksum || image.objectKey || image.url || "");
}

function uniqueImages(images: CatalogImage[], limit: number) {
  const result: CatalogImage[] = [];
  const seen = new Set<string>();
  for (const image of images) {
    const id = imageKey(image);
    if (!id || seen.has(id) || Number(image.size || 0) <= 8_000) continue;
    seen.add(id);
    result.push(image);
    if (result.length >= limit) break;
  }
  return result;
}

export function fullGallery<T extends CatalogSourceAdapter>(source: T): T {
  const original = source.fetchImages.bind(source);
  source.fetchImages = async (offer: VehicleOffer) => {
    const requested = Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 1000);
    const limit = Math.min(1000, Math.max(1, Number.isFinite(requested) ? requested : 1000));
    const result = uniqueImages(await original(offer).catch(() => [] as CatalogImage[]), limit);
    const sourceNativeUrls = rawGalleryUrls(offer);
    const verified = result.length >= 2 && sourceNativeUrls.length >= 2;

    (offer.operational as any).galleryVerified = verified;
    (offer.operational as any).gallerySourceImageCount = sourceNativeUrls.length;
    (offer.operational as any).galleryImageCount = result.length;
    (offer.operational as any).galleryRefreshedAt = new Date().toISOString();
    return result;
  };
  return source;
}

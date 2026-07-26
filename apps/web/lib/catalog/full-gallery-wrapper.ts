import { cacheImageFromUrl } from "./storage";
import type { CatalogImage, CatalogSourceAdapter, VehicleOffer } from "./types";

const bad = /logo|icon|avatar|qrcode|placeholder|banner|tracking|pixel|seller|dealer|recommend|related|similar|favicon|badge|social|share|twitter|facebook|instagram|linkedin|youtube|tiktok|whatsapp|telegram|pinterest|threads|no[-_ ]?photo|no[-_ ]?image|coming[-_ ]?soon|repair|maintenance|wrench|spanner|service[-_ ]?image|camera[-_ ]?off|car[-_ ]?silhouette|dummy/i;

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
  for (const field of [raw?.images, raw?.photos, raw?.gallery, raw?.imageUrls, raw?.photoUrls, raw?.parsed?.images]) {
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
    const requested = Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30);
    const limit = Math.min(30, Math.max(1, Number.isFinite(requested) ? requested : 30));
    const minimum = Math.max(1, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 1));
    const fastPath = /^(?:1|true|yes)$/i.test(String(process.env.CATALOG_GALLERY_FAST_PATH || ""));
    const sourceNativeUrls = rawGalleryUrls(offer);
    const genericOpenSource = source.sourceId.endsWith("_open");
    const sourceUrl = String((offer.operational as any)?.sourceUrl || "");

    // Сначала сохраняем только фотографии, уже находящиеся внутри конкретной карточки
    // выдачи. Это даёт объём и не требует открывать detail-страницу для каждой машины.
    const listingImages: CatalogImage[] = [];
    for (const url of sourceNativeUrls.slice(0, limit * 2)) {
      const image = await cacheImageFromUrl(url, offer.market, {
        headers: sourceUrl ? { referer: sourceUrl } : undefined,
      }).catch(() => null);
      if (image && Number(image.size || 0) > 8_000) listingImages.push(image);
      if (listingImages.length >= limit) break;
    }
    const listingResult = uniqueImages(listingImages, limit);
    if (fastPath && listingResult.length >= minimum) {
      (offer.operational as any).galleryVerified = true;
      (offer.operational as any).gallerySourceImageCount = sourceNativeUrls.length;
      (offer.operational as any).galleryImageCount = listingResult.length;
      (offer.operational as any).galleryRefreshedAt = new Date().toISOString();
      (offer.operational as any).gallerySafetyMode = genericOpenSource ? "listing_bound" : "source_exact";
      return listingResult;
    }

    // Универсальные HTML-адаптеры не имеют надёжного селектора галереи. Если на странице
    // есть блоки похожих машин, общий сбор img способен примешать чужие фотографии.
    const safeLimit = genericOpenSource
      ? Math.min(limit, Math.max(1, sourceNativeUrls.length))
      : limit;
    const detailed = await original(offer).catch(() => [] as CatalogImage[]);
    const result = uniqueImages([...listingResult, ...detailed], safeLimit);
    const verified = result.length >= minimum && (!genericOpenSource || sourceNativeUrls.length >= result.length);

    (offer.operational as any).galleryVerified = verified;
    (offer.operational as any).gallerySourceImageCount = sourceNativeUrls.length;
    (offer.operational as any).galleryImageCount = result.length;
    (offer.operational as any).galleryRefreshedAt = new Date().toISOString();
    (offer.operational as any).gallerySafetyMode = genericOpenSource ? "listing_bound" : "source_exact";
    return verified ? result : [];
  };
  return source;
}

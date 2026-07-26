import { cacheImageFromUrl } from "./storage";
import type { CatalogImage, CatalogSourceAdapter, VehicleOffer } from "./types";

function imageKey(image: CatalogImage) {
  return image.checksum || image.id || image.objectKey || image.url;
}

function uniqueImages(images: CatalogImage[], limit: number) {
  const seen = new Set<string>();
  const result: CatalogImage[] = [];
  for (const image of images) {
    const key = imageKey(image);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(image);
    if (result.length >= limit) break;
  }
  return result;
}

/**
 * Высокообъёмные источники сначала кэшируют реальные фотографии из карточки
 * в выдаче. Детальная страница запрашивается только когда в выдаче нет даже
 * минимально допустимой галереи либо отключён быстрый production-режим.
 */
export function priorityFastGallery(source: CatalogSourceAdapter): CatalogSourceAdapter {
  return {
    sourceId: source.sourceId,
    market: source.market,
    accessMode: source.accessMode,
    fetchPage: (cursor, updatedSince) => source.fetchPage(cursor, updatedSince),
    normalizeOffer: (raw) => source.normalizeOffer(raw),
    mapStatus: (raw) => source.mapStatus(raw),
    healthCheck: () => source.healthCheck(),
    async fetchImages(offer: VehicleOffer) {
      const limit = Math.min(30, Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
      const minimum = Math.max(1, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 1));
      const fastPath = /^(?:1|true|yes)$/i.test(String(process.env.CATALOG_GALLERY_FAST_PATH || ""));
      const raw = (offer.operational?.raw || {}) as { images?: unknown; detailUrl?: unknown };
      const sourceUrl = String(offer.operational?.sourceUrl || raw.detailUrl || "");
      const urls = Array.isArray(raw.images)
        ? [...new Set(raw.images.map((value) => String(value || "")).filter((value) => /^https?:\/\//i.test(value)))]
        : [];

      const listingImages: CatalogImage[] = [];
      for (const url of urls.slice(0, limit * 2)) {
        const image = await cacheImageFromUrl(url, offer.market, {
          headers: sourceUrl ? { referer: sourceUrl } : undefined,
        }).catch(() => null);
        if (image && image.size > 8_000) listingImages.push(image);
        if (listingImages.length >= limit) break;
      }

      if (fastPath && listingImages.length >= minimum) {
        return uniqueImages(listingImages, limit);
      }

      const detailed = await source.fetchImages(offer).catch(() => [] as CatalogImage[]);
      return uniqueImages([...listingImages, ...(Array.isArray(detailed) ? detailed : [])], limit);
    },
  };
}

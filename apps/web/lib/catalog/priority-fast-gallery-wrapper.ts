import { cacheImageFromUrl } from "./storage";
import type { CatalogImage, CatalogSourceAdapter, VehicleOffer } from "./types";

const BAD_SOURCE_IMAGE_RE = /(?:logo|favicon|icon|sprite|banner|bnr|promo|promotion|campaign|advert|placeholder|no[-_ ]?photo|no[-_ ]?image|thumbnail|thumb|tracking|pixel|qrcode|qr-code)/i;
const TINY_RENDITION_RE = /(?:^|[/_-])(?:120|160|180|200|220|240|260|280|300|320|360|400)x(?:0|[1-9]\d{1,3})(?:[/_.-]|$)/i;

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

function sourceUrlImage(value: unknown): CatalogImage | null {
  const url = String(value || "").trim();
  if (!/^https?:\/\//i.test(url) || BAD_SOURCE_IMAGE_RE.test(url) || TINY_RENDITION_RE.test(url)) return null;
  const extension = url.match(/\.(jpe?g|webp|avif|png)(?:[?#]|$)/i)?.[1]?.toLowerCase();
  const mimeType = extension === "png"
    ? "image/png"
    : extension === "webp"
      ? "image/webp"
      : extension === "avif"
        ? "image/avif"
        : "image/jpeg";
  return { id: "", url, objectKey: "", checksum: "", size: 0, mimeType };
}

/**
 * Высокообъёмные источники сохраняют source-bound URL, а не 30 бинарников на
 * каждую карточку. Детальная галерея всё равно запрашивается, пока не достигнут
 * preferred-предел: минимум 2 фото — это допуск, а не повод остановить сбор.
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
      const limit = Math.min(30, Math.max(2, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
      const minimum = Math.min(limit, Math.max(2, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 2)));
      const preferred = Math.min(limit, Math.max(minimum, Number(process.env.CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER || 30)));
      const fastPath = /^(?:1|true|yes)$/i.test(String(process.env.CATALOG_GALLERY_FAST_PATH || ""));
      const sourceUrlsOnly = String(process.env.CATALOG_IMAGE_STORAGE_MODE || "").toLowerCase() === "source_urls_only";
      const raw = (offer.operational?.raw || {}) as { images?: unknown; detailUrl?: unknown };
      const sourceUrl = String(offer.operational?.sourceUrl || raw.detailUrl || "");
      const urls = Array.isArray(raw.images)
        ? [...new Set(raw.images.map((value) => String(value || "")).filter((value) => /^https?:\/\//i.test(value)))]
        : [];

      const listingImages: CatalogImage[] = [];
      if (sourceUrlsOnly) {
        for (const url of urls.slice(0, limit * 3)) {
          const image = sourceUrlImage(url);
          if (image) listingImages.push(image);
          if (listingImages.length >= limit) break;
        }
      } else {
        for (const url of urls.slice(0, limit * 2)) {
          const image = await cacheImageFromUrl(url, offer.market, {
            headers: sourceUrl ? { referer: sourceUrl } : undefined,
          }).catch(() => null);
          if (image && image.size > 8_000) listingImages.push(image);
          if (listingImages.length >= limit) break;
        }
      }

      if (fastPath && listingImages.length >= preferred) {
        return uniqueImages(listingImages, limit);
      }

      const detailed = await source.fetchImages(offer).catch(() => [] as CatalogImage[]);
      const combined = uniqueImages([...listingImages, ...(Array.isArray(detailed) ? detailed : [])], limit);
      return combined.length >= minimum ? combined : [];
    },
  };
}

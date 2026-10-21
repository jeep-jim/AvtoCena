import { cacheImageFromUrl } from "./storage";
import { carusedExactListingUrls, carusedListingGalleryUrls, carusedSourceImageUrl } from "./carused-gallery";
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
  const normalized = carusedSourceImageUrl(value);
  const url = String(normalized || "").trim();
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

async function exactCarusedGallery(sourceId: string, sourceUrl: string, listUrls: string[], limit: number) {
  if (sourceId !== "carused_japan_open" || !/^https:\/\/carused\.jp\/car-list\/detail\//i.test(sourceUrl)) return [] as string[];
  const exactListUrls = carusedExactListingUrls(listUrls);
  const primary = exactListUrls[0] || "";
  if (!primary) return [] as string[];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(30_000, Math.max(5_000, Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 25_000))));
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9,ja;q=0.7",
        referer: "https://carused.jp/car-list",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) return [] as string[];
    const markup = await response.text();
    return carusedListingGalleryUrls(markup, primary, limit);
  } catch {
    return [] as string[];
  } finally {
    clearTimeout(timer);
  }
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
      const rawUrls = Array.isArray(raw.images)
        ? raw.images.map((value) => String(value || "")).filter((value) => /^https?:\/\//i.test(value))
        : [];
      // On Carused list pages, neighbouring stock cards can appear in the same
      // markup window. Keep only the first exact refno-cars family before using
      // any list image as gallery evidence.
      const urls = source.sourceId === "carused_japan_open"
        ? carusedExactListingUrls(rawUrls)
        : [...new Set(rawUrls)];

      const listingImages: CatalogImage[] = [];
      if (sourceUrlsOnly) {
        for (const url of urls.slice(0, limit * 3)) {
          const image = sourceUrlImage(url);
          if (image) listingImages.push(image);
          if (listingImages.length >= limit) break;
        }
      } else {
        for (const rawUrl of urls.slice(0, limit * 2)) {
          const url = carusedSourceImageUrl(rawUrl);
          const image = await cacheImageFromUrl(url, offer.market, {
            headers: sourceUrl ? { referer: sourceUrl } : undefined,
          }).catch(() => null);
          if (image && image.size > 8_000) listingImages.push(image);
          if (listingImages.length >= limit) break;
        }
      }

      const carusedUrls = await exactCarusedGallery(source.sourceId, sourceUrl, urls, limit);
      const carusedImages: CatalogImage[] = [];
      if (carusedUrls.length) {
        if (sourceUrlsOnly) {
          for (const url of carusedUrls) {
            const image = sourceUrlImage(url);
            if (image) carusedImages.push(image);
          }
        } else {
          for (const url of carusedUrls) {
            const image = await cacheImageFromUrl(url, offer.market, { headers: { referer: sourceUrl } }).catch(() => null);
            if (image && image.size > 8_000) carusedImages.push(image);
            if (carusedImages.length >= limit) break;
          }
        }
      }

      // A successful exact Carused detail parse is authoritative and is ordered
      // 001..N, so it must outrank the tiny/search-card rendition and any broad
      // generic detail scrape.
      if (carusedImages.length >= minimum) {
        return uniqueImages(carusedImages, limit);
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

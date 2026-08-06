import { EncarDirectAdapter, buildEncarImageUrl } from "./adapters";
import type { CatalogImage, VehicleOffer } from "./types";

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

function uniqueImages(images: CatalogImage[], limit: number) {
  const result: CatalogImage[] = [];
  const seen = new Set<string>();
  for (const image of images) {
    const key = String(image.url || image.objectKey || image.id || "").replace(/[?#].*$/, "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(image);
    if (result.length >= limit) break;
  }
  return result;
}

export class EncarCompleteAdapter extends EncarDirectAdapter {
  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const requested = Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30);
    const limit = Math.min(30, Math.max(5, Number.isFinite(requested) ? requested : 30));
    const minimum = Math.min(limit, Math.max(5, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 5)));
    const raw: any = offer.operational?.raw || {};
    const listingUrls = uniqueUrls(collectImageValues(raw), limit * 2);

    // Detail is used for source specifications and the full gallery only.
    // Image bytes are never downloaded or written to AvtoCena storage.
    const detailed = await super.fetchImages(offer).catch(() => [] as CatalogImage[]);
    const enrichedRaw: any = offer.operational?.raw || {};
    const detailedUrls = uniqueUrls([
      ...collectImageValues(enrichedRaw?.detail || enrichedRaw),
      ...detailed.map((image) => String(image?.url || "")),
    ], limit * 3);
    const gallery = uniqueImages([...listingUrls, ...detailedUrls].map(urlImage), limit);
    const verified = gallery.length >= minimum;

    offer.operational = {
      ...(offer.operational || {}),
      galleryVerified: verified,
      galleryImageCount: gallery.length,
      galleryRefreshedAt: new Date().toISOString(),
      gallerySafetyMode: "encar_source_urls_only",
      galleryStoredAs: "json_urls",
    } as any;

    return verified ? gallery : [];
  }
}

export const encarCompleteSource = new EncarCompleteAdapter();

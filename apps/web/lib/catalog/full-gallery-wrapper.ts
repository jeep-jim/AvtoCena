import { carusedExactListingUrls, carusedSourceImageUrl } from "./carused-gallery";
import type { CatalogImage, CatalogSourceAdapter, VehicleOffer } from "./types";

const BAD_IMAGE_RE = /logo|icon|avatar|qrcode|placeholder|banner|bnr|promo|promotion|campaign|advert|thumbnail|thumb|tracking|pixel|seller|dealer|recommend|related|similar|favicon|badge|social|share|twitter|facebook|instagram|linkedin|youtube|tiktok|whatsapp|telegram|pinterest|threads|no[-_ ]?photo|no[-_ ]?image|coming[-_ ]?soon|repair|maintenance|wrench|spanner|service[-_ ]?image|camera[-_ ]?off|car[-_ ]?silhouette|dummy/i;

function decode(value: unknown) {
  return String(value || "")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .trim();
}

function absoluteImageUrl(value: unknown, baseUrl = "") {
  const raw = decode(value);
  if (!raw || BAD_IMAGE_RE.test(raw)) return "";
  try {
    const normalized = raw.startsWith("//") ? `https:${raw}` : raw;
    const url = new URL(normalized, baseUrl || undefined);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (/\/api\/catalog\/images\//i.test(url.pathname)) return "";
    return carusedSourceImageUrl(url.toString());
  } catch {
    return "";
  }
}

function imageValues(value: unknown) {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  return [row.url, row.src, row.location, row.path, row.large, row.original, row.imageUrl]
    .filter((item): item is string => typeof item === "string");
}

function sourceGalleryUrls(offer: VehicleOffer) {
  const sourceUrl = String((offer.operational as any)?.sourceUrl || "");
  const raw = (offer.operational as any)?.raw;
  const collections = [
    offer.images,
    raw?.images,
    raw?.photos,
    raw?.gallery,
    raw?.imageUrls,
    raw?.photoUrls,
    raw?.parsed?.images,
  ];
  const urls: string[] = [];
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const value of collection) {
      for (const candidate of imageValues(value)) {
        const url = absoluteImageUrl(candidate, sourceUrl);
        if (url) urls.push(url);
      }
    }
  }
  const unique = [...new Set(urls)];
  // Carused list markup can include neighbouring inventory. Anchor every list
  // image to the first exact refno-cars object family, so an adjacent stock ID
  // can never become photo #2 (or the cover) of this vehicle.
  return /^https:\/\/carused\.jp\/car-list\/detail\//i.test(sourceUrl)
    ? carusedExactListingUrls(unique)
    : unique;
}

function externalImage(value: unknown, baseUrl = ""): CatalogImage | null {
  const url = absoluteImageUrl(
    typeof value === "string" ? value : (value as CatalogImage | undefined)?.url,
    baseUrl,
  );
  if (!url) return null;
  const extension = url.match(/\.(jpe?g|webp|avif|png)(?:[?#]|$)/i)?.[1]?.toLowerCase();
  const mimeType = extension === "png"
    ? "image/png"
    : extension === "webp"
      ? "image/webp"
      : extension === "avif"
        ? "image/avif"
        : "image/jpeg";
  return {
    id: "",
    url,
    objectKey: "",
    checksum: "",
    size: 0,
    mimeType,
  };
}

function uniqueExternalImages(values: unknown[], baseUrl: string, limit: number) {
  const result: CatalogImage[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const image = externalImage(value, baseUrl);
    if (!image || seen.has(image.url)) continue;
    seen.add(image.url);
    result.push(image);
    if (result.length >= limit) break;
  }
  return result;
}

export function fullGallery<T extends CatalogSourceAdapter>(source: T): T {
  const original = source.fetchImages?.bind(source);
  source.fetchImages = async (offer: VehicleOffer) => {
    const requested = Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30);
    const limit = Math.min(30, Math.max(2, Number.isFinite(requested) ? requested : 30));
    const minimum = Math.min(
      limit,
      Math.max(2, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 2)),
    );
    const sourceUrl = String((offer.operational as any)?.sourceUrl || "");

    const listingUrls = sourceGalleryUrls(offer);
    let detailed: CatalogImage[] = [];
    if (listingUrls.length < limit && original) {
      detailed = await original(offer).catch(() => [] as CatalogImage[]);
    }

    const result = uniqueExternalImages(
      [...listingUrls, ...detailed],
      sourceUrl,
      limit,
    );
    const verified = result.length >= minimum;

    offer.operational = {
      ...(offer.operational || {}),
      galleryVerified: verified,
      gallerySourceImageCount: listingUrls.length,
      galleryImageCount: result.length,
      galleryRefreshedAt: new Date().toISOString(),
      gallerySafetyMode: "source_urls_only",
      galleryStoredAs: "json_urls",
    } as any;

    return verified ? result : [];
  };
  return source;
}

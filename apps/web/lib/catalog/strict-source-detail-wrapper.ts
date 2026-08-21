import type { CatalogImage, CatalogSourceAdapter, VehicleOffer } from "./types";

function rawObject(offer: VehicleOffer) {
  return offer.operational?.raw && typeof offer.operational.raw === "object"
    ? offer.operational.raw as Record<string, any>
    : {};
}

function hasExplicitPhotoIdentityProof(offer: VehicleOffer) {
  const raw = rawObject(offer);
  return offer.operational?.photoIdentityVerified === true
    || raw.photoIdentityVerified === true
    || raw.parsed?.photoIdentityVerified === true;
}

function dedupeImages(images: CatalogImage[], limit: number) {
  const result: CatalogImage[] = [];
  const seen = new Set<string>();
  for (const image of images) {
    const key = String(image?.checksum || image?.objectKey || image?.id || image?.url || "").trim();
    if (!key || seen.has(key) || !String(image?.url || "").startsWith("http")) continue;
    seen.add(key);
    result.push(image);
    if (result.length >= limit) break;
  }
  return result;
}

/**
 * Fail-closed compatibility wrapper for sources that do not yet have a dedicated
 * exact-detail adapter registered in importer.ts.
 *
 * The wrapper must never infer vehicle semantics or scrape a whole detail page for
 * images. A source may publish a gallery only when its own fetchImages() method has
 * explicitly proved that the returned photos belong to this exact listing.
 */
export function strictSourceDetail<T extends CatalogSourceAdapter>(source: T): T {
  const originalFetchImages = source.fetchImages.bind(source);

  source.fetchImages = async (offer: VehicleOffer) => {
    const limit = Math.min(30, Math.max(2, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
    const minimum = Math.min(limit, Math.max(2, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 2)));
    const images = dedupeImages(await originalFetchImages(offer).catch(() => [] as CatalogImage[]), limit);
    const verified = hasExplicitPhotoIdentityProof(offer) && images.length >= minimum;

    offer.operational = {
      ...(offer.operational || {}),
      galleryVerified: verified,
      galleryImageCount: images.length,
      galleryRefreshedAt: new Date().toISOString(),
      gallerySafetyMode: "strict_source_adapter_identity_only",
      galleryStoredAs: "json_urls",
      detailParserSourceId: source.sourceId,
      ...(!verified ? { photoIdentityVerified: false } : {}),
    } as any;

    return verified ? images : [];
  };

  return source;
}

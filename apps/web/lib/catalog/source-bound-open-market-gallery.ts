import { OpenMarketAdapter, parseOpenMarketPage } from "./open-market-sources";
import type { CatalogImage, VehicleOffer } from "./types";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function mimeType(url: string) {
  if (/\.png(?:[?#]|$)/i.test(url)) return "image/png";
  if (/\.webp(?:[?#]|$)/i.test(url)) return "image/webp";
  if (/\.avif(?:[?#]|$)/i.test(url)) return "image/avif";
  return "image/jpeg";
}

function asSourceImage(urlValue: unknown): CatalogImage | null {
  const raw = clean(urlValue);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return null;
    return { id: "", url: url.toString(), objectKey: "", checksum: "", size: 0, mimeType: mimeType(url.toString()) };
  } catch {
    return null;
  }
}

function sourceImages(values: unknown, limit: number) {
  const result: CatalogImage[] = [];
  const seen = new Set<string>();
  for (const value of Array.isArray(values) ? values : []) {
    const image = asSourceImage(typeof value === "string" ? value : (value as any)?.url);
    if (!image || seen.has(image.url)) continue;
    seen.add(image.url);
    result.push(image);
    if (result.length >= limit) break;
  }
  return result;
}

function markListingIdentity(offer: VehicleOffer, raw: any, verified: boolean) {
  const rawObject = raw && typeof raw === "object" ? raw : {};
  offer.operational = {
    ...(offer.operational || {}),
    photoIdentityVerified: verified,
    gallerySafetyMode: "exact_listing_row_only",
    galleryStoredAs: "json_urls",
    raw: {
      ...rawObject,
      listingBoundImages: verified,
      photoIdentityVerified: verified,
      detailIdentityVerified: verified,
    },
  } as any;
}

/**
 * The generic OpenMarketAdapter used to append every <img> and every image-like
 * object found on a vehicle detail page. That can mix banners, dealer graphics,
 * related cars and cabin/diagnostic images into the current listing.
 *
 * This wrapper never calls that broad fetchImages implementation. It accepts only
 * images attached to the exact parsed listing row whose source id and detail URL
 * match the current offer. Images remain source URLs in JSON; no binary cache is
 * written by this wrapper.
 */
export function sourceBoundOpenMarketGallery<T extends OpenMarketAdapter>(source: T): T {
  const originalNormalize = source.normalizeOffer.bind(source);

  source.normalizeOffer = (raw: unknown) => {
    const offer = originalNormalize(raw);
    if (!offer) return null;
    const row: any = raw || {};
    const sameId = clean(row.id) && clean(row.id) === clean(offer.sourceOfferId);
    const sameUrl = clean(row.detailUrl) && clean(row.detailUrl) === clean(offer.operational?.sourceUrl);
    const verified = Boolean(sameId && sameUrl && Array.isArray(row.images) && row.images.length > 0);
    markListingIdentity(offer, row, verified);
    return offer;
  };

  source.fetchImages = async (offer: VehicleOffer) => {
    const limit = Math.min(30, Math.max(2, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
    const row: any = offer.operational?.raw || {};
    const sameId = clean(row.id) && clean(row.id) === clean(offer.sourceOfferId);
    const sameUrl = clean(row.detailUrl) && clean(row.detailUrl) === clean(offer.operational?.sourceUrl);
    const listing = sourceImages(row.images, limit);
    if (!sameId || !sameUrl || !row.detailUrl) {
      markListingIdentity(offer, row, false);
      return [];
    }

    let exact: any = null;
    try {
      const request = (source as any).request?.bind(source);
      const config = (source as any).config;
      if (request && config) {
        const detail = await request(row.detailUrl);
        if (detail?.response?.ok && typeof detail.markup === "string") {
          const rows = parseOpenMarketPage(detail.markup, config);
          exact = rows.find((candidate: any) => clean(candidate?.id) === clean(row.id)
            && clean(candidate?.detailUrl) === clean(row.detailUrl)) || null;
        }
      }
    } catch {
      exact = null;
    }

    if (exact) {
      offer.mileageKm ||= exact.mileageKm;
      offer.engineCc ||= exact.engineCc;
      offer.powerHp ||= exact.powerHp;
      offer.fuel ||= exact.fuel;
      offer.transmission ||= exact.transmission;
      offer.drive ||= exact.drive;
      offer.bodyType ||= exact.bodyType;
      if (!offer.sourcePrice && exact.price) {
        offer.sourcePrice = exact.price;
        offer.sourceCurrency = exact.currency;
        offer.priceMode = "fixed";
        offer.calculationStatus = "ready";
      }
    }

    const exactImages = exact ? sourceImages(exact.images, limit) : [];
    const merged = sourceImages([...listing, ...exactImages].map((image) => image.url), limit);
    const verified = merged.length > 0;
    const nextRaw = { ...row, ...(exact ? { exactDetail: { ...exact, images: undefined } } : {}) };
    markListingIdentity(offer, nextRaw, verified);
    return merged;
  };

  return source;
}

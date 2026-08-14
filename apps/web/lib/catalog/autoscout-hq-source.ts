import { AutoScoutEuropeExactAdapter, type AutoScoutExactRow } from "./autoscout-exact-source-base";
import type { CatalogImage, VehicleOffer } from "./types";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-GB,en;q=0.9,de;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

function clean(value: unknown) { return String(value ?? "").replace(/\s+/g, " ").trim(); }

function imageResolution(url: string) {
  const match = url.match(/\/(\d{2,5})x(\d{2,5})\.(jpe?g|webp|avif|png)(?:[?#]|$)/i);
  return { width: Number(match?.[1] || 0) || undefined, height: Number(match?.[2] || 0) || undefined, extension: match?.[3]?.toLowerCase() };
}

function image(url: string): CatalogImage {
  const rendition = imageResolution(url);
  const extension = rendition.extension || "jpeg";
  return { id: "", url, objectKey: "", checksum: "", width: rendition.width, height: rendition.height, size: 0,
    mimeType: extension === "png" ? "image/png" : extension === "avif" ? "image/avif" : extension === "webp" ? "image/webp" : "image/jpeg" };
}

export function parseAutoScoutDetailGallery(markup: string, sourceOfferId: string, limit = 30) {
  const match = markup.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1] || !sourceOfferId) return [];
  let data: any;
  try { data = JSON.parse(match[1]); } catch { return []; }
  const details = data?.props?.pageProps?.listingDetails;
  if (!details || !Array.isArray(details.images)) return [];
  const declaredId = clean(details.id || details.listingId || details.uuid);
  if (declaredId && declaredId !== sourceOfferId) return [];

  // AutoScout exposes an explicit source flag when the dealer's designated cover
  // is a placeholder/promo frame rather than a vehicle photograph. A listing can
  // still have five same-listing JPEG URLs in this state, so listing-bound identity
  // alone is not sufficient. Fail closed instead of showing the dealer artwork as
  // the customer's main vehicle photo.
  if (details.isCoverImagePlaceholder === true) return [];

  const prefix = `/listing-images/${sourceOfferId}_`.toLowerCase();
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of details.images) {
    const url = clean(value);
    if (!/^https?:\/\/prod\.pictures\.autoscout24\.net\/listing-images\//i.test(url)) continue;
    let pathname = "";
    try { pathname = new URL(url).pathname.toLowerCase(); } catch { continue; }
    const { width, height } = imageResolution(url);
    if (!pathname.startsWith(prefix) || !width || !height || width < 900 || height < 600 || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
    if (result.length >= Math.min(30, Math.max(1, limit))) break;
  }
  return result;
}

export class AutoScoutHqAdapter extends AutoScoutEuropeExactAdapter {
  override normalizeOffer(raw: unknown): VehicleOffer | null {
    const offer = super.normalizeOffer(raw as AutoScoutExactRow);
    if (!offer) return null;
    offer.operational = {
      ...(offer.operational || {}), exactDetail: false, exactPhotos: false, galleryVerified: false, galleryImageCount: 0,
      gallerySafetyMode: "autoscout_exact_detail_pending_v2", photoIdentityVerified: false,
      raw: { parsed: raw, searchImages: (raw as AutoScoutExactRow).images, listingBoundSearchImages: true, photoIdentityVerified: false, detailIdentityVerified: false },
    } as any;
    return offer;
  }

  override async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const sourceOfferId = clean(offer.sourceOfferId);
    const sourceUrl = clean(offer.operational?.sourceUrl);
    if (!sourceOfferId || !sourceUrl.includes("/offers/") || !sourceUrl.includes(sourceOfferId)) return [];
    const response = await fetch(sourceUrl, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(Math.max(5_000, Number(process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS || 30_000))) });
    const markup = await response.text();
    if (!response.ok) throw new Error(`autoscout_detail_http_${response.status}:${sourceOfferId}`);
    const urls = parseAutoScoutDetailGallery(markup, sourceOfferId, Math.min(30, Math.max(5, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30))));
    if (urls.length < 5) return [];
    const previousRaw = offer.operational?.raw && typeof offer.operational.raw === "object" ? offer.operational.raw as Record<string, unknown> : {};
    offer.operational = {
      ...(offer.operational || {}), exactDetail: true, exactPhotos: true, galleryVerified: true, galleryImageCount: urls.length,
      gallerySafetyMode: "autoscout_exact_detail_next_gallery_v2", galleryStoredAs: "json_urls", photoIdentityVerified: true, photoResolutionVerified: true,
      raw: { ...previousRaw, detailImages: urls, listingBoundImages: true, photoIdentityVerified: true, photoResolutionVerified: true, detailIdentityVerified: true },
    } as any;
    return urls.map(image);
  }
}

export const autoscoutEuropeHqSource = new AutoScoutHqAdapter();
import review from "../../../../data/catalog/source-gallery-review-v1.json";

// Small, evidence-backed moderation list. It stores source URLs, never photos.
// Rendition/resize parameters do not turn a reviewed ad into a vehicle photo.
function sourceImageIdentity(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    return `${url.origin}${url.pathname}`;
  } catch { return ""; }
}

const excludedImages = new Map(review.excludedImages.map(row => [sourceImageIdentity(row.url), row.reason]));
const heldOffers = new Map(review.heldOffers.map(row => [`${row.sourceId}:${row.sourceOfferId}`, row.reason]));

export function reviewedCatalogImageExclusion(url: unknown) {
  return excludedImages.get(sourceImageIdentity(url)) || "";
}

export function reviewedCatalogGalleryHold(offer: { sourceId?: unknown; sourceOfferId?: unknown }) {
  return heldOffers.get(`${offer?.sourceId || ""}:${offer?.sourceOfferId || ""}`) || "";
}

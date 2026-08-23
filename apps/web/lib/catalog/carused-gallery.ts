const CARUSED_CDN_HOST = "d1og64tg0ubvon.cloudfront.net";
const CARUSED_PATH_RE = /^\/refno-cars\/(?:[^/?#]+\/)+([0-9]+)\/([0-9]+)\.(?:jpe?g|webp|png)$/i;

function decode(value: unknown) {
  return String(value || "")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .trim();
}

export function carusedSourceImageUrl(value: unknown) {
  const raw = decode(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.hostname.toLowerCase() !== CARUSED_CDN_HOST || !CARUSED_PATH_RE.test(url.pathname)) return raw;
    // Carused list/search markup asks CloudFront for tiny 133px renditions. The
    // exact same listing-bound object is 640x480 when the resize parameter is
    // omitted, so never persist or render the deliberately tiny rendition.
    url.searchParams.delete("w");
    return url.toString();
  } catch {
    return raw;
  }
}

export function carusedImageGroup(value: unknown) {
  const normalized = carusedSourceImageUrl(value);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    if (url.hostname.toLowerCase() !== CARUSED_CDN_HOST) return "";
    return url.pathname.match(CARUSED_PATH_RE)?.[1] || "";
  } catch {
    return "";
  }
}

function imageSequence(value: string) {
  try {
    return Number(new URL(value).pathname.match(CARUSED_PATH_RE)?.[2] || Number.MAX_SAFE_INTEGER);
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/**
 * Extract only the current Carused listing's photo object family. Carused pages
 * can contain recommendation cards from neighbouring stock IDs; those must
 * never be mixed into the vehicle gallery. `primaryUrl` anchors the exact
 * refno-cars directory observed on the listing card.
 */
export function carusedListingGalleryUrls(markup: string, primaryUrl: unknown, limit = 30) {
  const group = carusedImageGroup(primaryUrl);
  if (!group) return [];
  const candidates: string[] = [];
  const decoded = decode(markup);
  for (const match of decoded.matchAll(/https?:\/\/d1og64tg0ubvon\.cloudfront\.net\/refno-cars\/[^"'<>\s]+?\.(?:jpe?g|webp|png)(?:\?[^"'<>\s]*)?/gi)) {
    const url = carusedSourceImageUrl(match[0]);
    if (url && carusedImageGroup(url) === group) candidates.push(url);
  }
  return [...new Set(candidates)]
    .sort((left, right) => imageSequence(left) - imageSequence(right))
    .slice(0, Math.max(1, Math.min(30, limit)));
}

export function carusedExactListingUrls(values: unknown[]) {
  const normalized = values.map(carusedSourceImageUrl).filter(Boolean);
  const primary = normalized.find((value) => carusedImageGroup(value));
  const group = carusedImageGroup(primary);
  if (!group) return normalized;
  return normalized.filter((value) => carusedImageGroup(value) === group);
}

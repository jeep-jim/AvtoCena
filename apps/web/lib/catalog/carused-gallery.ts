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

function uniqueByObject(values: string[]) {
  const byPath = new Map<string, string>();
  for (const value of values) {
    try {
      const url = new URL(value);
      const key = `${url.hostname.toLowerCase()}${url.pathname}`;
      if (!byPath.has(key)) byPath.set(key, value);
    } catch {
      // ignore malformed image values
    }
  }
  return [...byPath.values()];
}

function groupedDetailImages(markup: string) {
  const groups = new Map<string, string[]>();
  const decoded = decode(markup);
  for (const match of decoded.matchAll(/https?:\/\/d1og64tg0ubvon\.cloudfront\.net\/refno-cars\/[^"'<>\s]+?\.(?:jpe?g|webp|png)(?:\?[^"'<>\s]*)?/gi)) {
    const url = carusedSourceImageUrl(match[0]);
    const group = carusedImageGroup(url);
    if (!url || !group) continue;
    const rows = groups.get(group) || [];
    rows.push(url);
    groups.set(group, rows);
  }
  return [...groups.entries()].map(([group, values]) => ({
    group,
    urls: uniqueByObject(values).sort((left, right) => imageSequence(left) - imageSequence(right)),
  }));
}

/**
 * Extract only the current Carused listing's real gallery. Search/list markup
 * can put a neighbouring stock card before the current listing, so the first
 * thumbnail is NOT an identity anchor. On the exact detail page, the current
 * vehicle is the one coherent refno-cars family with the deep numbered gallery;
 * recommendation groups contain only a few images. Prefer the deepest family,
 * using the list-card group only as a tie-breaker.
 */
export function carusedListingGalleryUrls(markup: string, primaryUrl: unknown, limit = 30) {
  const preferredGroup = carusedImageGroup(primaryUrl);
  const groups = groupedDetailImages(markup)
    .filter((row) => row.urls.length >= 2)
    .sort((left, right) => right.urls.length - left.urls.length
      || Number(right.group === preferredGroup) - Number(left.group === preferredGroup)
      || left.group.localeCompare(right.group));
  const selected = groups[0];
  if (!selected) return [];
  return selected.urls.slice(0, Math.max(1, Math.min(30, limit)));
}

/** List-page evidence is never allowed to mix two stock image families. */
export function carusedExactListingUrls(values: unknown[]) {
  const normalized = values.map(carusedSourceImageUrl).filter(Boolean);
  const groups = new Map<string, string[]>();
  for (const value of normalized) {
    const group = carusedImageGroup(value);
    if (!group) continue;
    const rows = groups.get(group) || [];
    rows.push(value);
    groups.set(group, rows);
  }
  if (!groups.size) return normalized;
  const selected = [...groups.values()].sort((left, right) => right.length - left.length)[0];
  return uniqueByObject(selected);
}

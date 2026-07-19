import { cacheImageFromUrl } from "./storage";
import type { CatalogImage, CatalogSourceAdapter, VehicleOffer } from "./types";

const headers = {
  accept: "text/html,application/xhtml+xml,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ja;q=0.8,ko;q=0.8,zh-CN;q=0.8,pl;q=0.8",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};

const bad = /logo|icon|avatar|qrcode|placeholder|banner|tracking|pixel|seller|dealer|recommend|related|similar|favicon|badge|social|share|twitter|facebook|instagram|linkedin|youtube|tiktok|whatsapp|telegram|pinterest|threads|x[-_ ]?(?:logo|icon|brand)|(?:^|[\/_-])twitter[-_]|(?:^|[\/_-])social[-_]/i;
const socialHosts = /(?:^|\.)(?:x\.com|twitter\.com|twimg\.com|facebook\.com|fbcdn\.net|instagram\.com|cdninstagram\.com|linkedin\.com|youtube\.com|ytimg\.com|tiktok\.com|whatsapp\.com|telegram\.org)$/i;

function decode(value: unknown) {
  return String(value || "")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&");
}

function absolute(value: unknown, base: string) {
  try { return new URL(decode(value), base).toString(); } catch { return ""; }
}

function valid(url: string) {
  if (!url || bad.test(url)) return false;
  try {
    const parsed = new URL(url);
    if (socialHosts.test(parsed.hostname)) return false;
    if (/\/(?:x|twitter|social|share)(?:[-_@.][^/]*)?\.(?:jpe?g|png|webp|avif)(?:$|[?#])/i.test(parsed.pathname)) return false;
  } catch {
    return false;
  }
  return /\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(url)
    || /olxcdn\.com|picture\d*\.goo-net\.com|\/image(?:[;/?#]|$)/i.test(url);
}

function key(url: string) {
  try {
    const parsed = new URL(url);
    const file = parsed.pathname.match(/\/v1\/files\/([^/]+)\/image/i)?.[1];
    return file
      ? `${parsed.hostname}:${file}`
      : `${parsed.hostname}${parsed.pathname}`
        .toLowerCase()
        .replace(/\/(?:w|f)?_?\d+x\d+\//i, "/size/")
        .replace(/;s=\d+x\d+/i, "");
  } catch {
    return url.replace(/[?#].*$/, "").toLowerCase();
  }
}

function groupKey(url: string) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname
      .replace(/\/(?:w|f)?_?\d+x\d+\//i, "/size/")
      .replace(/\/v1\/files\/[^/]+\/image.*$/i, "/v1/files/gallery")
      .split("/")
      .filter(Boolean);
    return `${parsed.hostname.toLowerCase()}/${path.slice(0, Math.max(1, path.length - 1)).join("/")}`;
  } catch {
    return "";
  }
}

function rawGalleryUrls(offer: VehicleOffer) {
  const raw = (offer.operational as any)?.raw;
  const values: unknown[] = [];
  for (const field of [raw?.images, raw?.photos, raw?.gallery, raw?.imageUrls, raw?.photoUrls]) {
    if (Array.isArray(field)) values.push(...field);
  }
  const result: string[] = [];
  for (const value of values) {
    if (typeof value === "string") result.push(value);
    else if (value && typeof value === "object") {
      for (const field of ["url", "src", "location", "path", "large", "original"]) {
        const candidate = (value as Record<string, unknown>)[field];
        if (typeof candidate === "string") result.push(candidate);
      }
    }
  }
  return result;
}

function pageUrls(markup: string, base: string, preferredGroups: Set<string>) {
  if (!preferredGroups.size) return [];
  const body = decode(markup);
  const found: string[] = [];

  // Do not read generic href attributes: navigation and related listings are not gallery photos.
  for (const match of body.matchAll(/(?:src|poster|data-src|data-original|data-lazy-src|data-image|data-large|data-full|data-zoom)\s*=\s*["']([^"']+)["']/gi)) found.push(match[1]);
  for (const match of body.matchAll(/(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']/gi)) {
    for (const part of match[1].split(",")) found.push(part.trim().split(/\s+/)[0]);
  }
  for (const match of body.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]+content=["']([^"']+)["']/gi)) found.push(match[1]);
  for (const match of body.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["']/gi)) found.push(match[1]);
  for (const match of body.matchAll(/https?:\/\/[^\s"'<>]+?(?:\.(?:jpe?g|png|webp|avif)|\/image(?:[;/?#]|$))[^\s"'<>]*/gi)) found.push(match[0]);

  const groups = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const value of found) {
    const url = absolute(value, base);
    const id = key(url);
    const group = groupKey(url);
    if (!valid(url) || !group || seen.has(id) || !preferredGroups.has(group)) continue;
    seen.add(id);
    groups.set(group, [...(groups.get(group) || []), url]);
  }

  return [...groups.values()].sort((left, right) => right.length - left.length)[0] || [];
}

function imageKey(image: CatalogImage) {
  return String(image.id || image.checksum || image.objectKey || image.url || "");
}

function uniqueImages(images: CatalogImage[], limit: number) {
  const result: CatalogImage[] = [];
  const seen = new Set<string>();
  for (const image of images) {
    const id = imageKey(image);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(image);
    if (result.length >= limit) break;
  }
  return result;
}

export function fullGallery<T extends CatalogSourceAdapter>(source: T): T {
  const original = source.fetchImages.bind(source);
  source.fetchImages = async (offer: VehicleOffer) => {
    const requested = Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 12);
    const limit = Math.min(24, Math.max(1, Number.isFinite(requested) ? requested : 12));
    const initial = await original(offer).catch(() => [] as CatalogImage[]);
    const pageUrl = String(offer.operational?.sourceUrl || "");
    if (!pageUrl) return uniqueImages(initial, limit);

    const preferredGroups = new Set(
      rawGalleryUrls(offer)
        .map((value) => absolute(value, pageUrl))
        .filter(valid)
        .map(groupKey)
        .filter(Boolean),
    );
    if (!preferredGroups.size) {
      (offer.operational as any).galleryVerified = false;
      return uniqueImages(initial, limit);
    }

    let markup = "";
    try {
      const response = await fetch(pageUrl, { headers: { ...headers, referer: pageUrl }, redirect: "follow" });
      if (response.ok) markup = await response.text();
    } catch {
      return uniqueImages(initial, limit);
    }

    const fresh: CatalogImage[] = [];
    for (const url of pageUrls(markup, pageUrl, preferredGroups).slice(0, limit)) {
      const image = await cacheImageFromUrl(url, String(offer.market), { headers: { ...headers, referer: pageUrl } }).catch(() => null);
      if (!image || image.size <= 8_000) continue;
      const width = Number(image.width || 0);
      const height = Number(image.height || 0);
      if (width && height) {
        const ratio = width / height;
        if (width < 280 || height < 170 || ratio < 0.72 || ratio > 3.2) continue;
      }
      fresh.push(image);
    }

    // Only a coherent, source-native group may replace a listing's previous gallery.
    const verified = fresh.length >= 2;
    const result = verified ? uniqueImages(fresh, limit) : uniqueImages(initial, limit);
    (offer.operational as any).galleryVerified = verified;
    (offer.operational as any).galleryImageCount = result.length;
    (offer.operational as any).galleryRefreshedAt = new Date().toISOString();
    return result;
  };
  return source;
}

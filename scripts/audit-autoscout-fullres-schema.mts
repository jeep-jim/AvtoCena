import { readMarketOffers } from "../apps/web/lib/catalog/storage.ts";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-GB,en;q=0.9,de;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function decodeUrlish(value: string) {
  return value
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .trim();
}

function imageIdentity(value: string) {
  const decoded = decodeUrlish(value);
  try {
    const u = new URL(decoded);
    if (!/(?:^|\.)prod\.pictures\.autoscout24\.net$/i.test(u.hostname)) return "";
    const m = u.pathname.match(/\/listing-images\/([^/]+?)(?:\/[0-9]{2,5}x[0-9]{2,5}\.(?:webp|jpe?g|png|avif))?$/i);
    return m?.[1]?.toLowerCase() || "";
  } catch {
    return "";
  }
}

function rendition(value: string) {
  const decoded = decodeUrlish(value);
  try {
    const u = new URL(decoded);
    const m = u.pathname.match(/\/([0-9]{2,5})x([0-9]{2,5})\.(webp|jpe?g|png|avif)$/i);
    return m ? { width: Number(m[1]), height: Number(m[2]), format: m[3].toLowerCase() } : null;
  } catch {
    return null;
  }
}

function collectAutoscoutUrls(markup: string) {
  const found: string[] = [];
  const patterns = [
    /https?:\\?\/\\?\/prod\.pictures\.autoscout24\.net\\?\/listing-images\\?\/[^"'\\\s<>]+/gi,
    /https?:\/\/prod\.pictures\.autoscout24\.net\/listing-images\/[^"'\s<>]+/gi,
  ];
  for (const pattern of patterns) {
    for (const match of markup.matchAll(pattern)) {
      const url = decodeUrlish(match[0]).replace(/[),;]+$/, "");
      if (url) found.push(url);
    }
  }
  for (const attr of markup.matchAll(/(?:srcset|data-srcset)=["']([^"']+)["']/gi)) {
    for (const part of attr[1].split(",")) {
      const candidate = decodeUrlish(part.trim().split(/\s+/)[0] || "");
      if (/^https?:\/\/prod\.pictures\.autoscout24\.net\/listing-images\//i.test(candidate)) found.push(candidate);
    }
  }
  return [...new Set(found)];
}

function currentUrls(row: any) {
  const images = Array.isArray(row?.images) ? row.images : [];
  return images.map((image: any) => text(image?.url)).filter((url: string) => /^https?:\/\/prod\.pictures\.autoscout24\.net\/listing-images\//i.test(url));
}

const all: any[] = await readMarketOffers("europe");
const rows = all.filter((row: any) => row?.sourceId === "autoscout_europe_open" && Number(row?.year || 0) >= 2020 && currentUrls(row).length);
const sample = rows
  .slice()
  .sort((a: any, b: any) => String(a?.id || "").localeCompare(String(b?.id || "")))
  .slice(0, Math.max(1, Math.min(8, Number(process.env.AUDIT_LIMIT || 5))));

const results: any[] = [];
for (const row of sample) {
  const sourceUrl = text(row?.operational?.sourceUrl);
  const stored = currentUrls(row);
  const response = await fetch(sourceUrl, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  const markup = await response.text();
  const discovered = collectAutoscoutUrls(markup);
  const storedIds = new Set(stored.map(imageIdentity).filter(Boolean));
  const matching = discovered.filter((url) => storedIds.has(imageIdentity(url)));
  const variantsByIdentity = Object.fromEntries([...storedIds].map((id) => {
    const urls = matching.filter((url) => imageIdentity(url) === id);
    return [id, urls.map((url) => ({ url, rendition: rendition(url) }))];
  }));
  const discoveredRenditions = discovered
    .map((url) => ({ url, identity: imageIdentity(url), rendition: rendition(url) }))
    .filter((row) => row.identity);
  const sizes = discoveredRenditions.map((row) => row.rendition).filter(Boolean) as { width: number; height: number; format: string }[];
  results.push({
    id: row.id,
    sourceOfferId: row.sourceOfferId,
    make: row.make,
    model: row.model,
    year: row.year,
    sourceUrl,
    httpStatus: response.status,
    finalUrl: response.url,
    bytes: Buffer.byteLength(markup),
    storedCount: stored.length,
    storedSample: stored.slice(0, 3).map((url) => ({ url, identity: imageIdentity(url), rendition: rendition(url) })),
    discoveredCount: discovered.length,
    matchingStoredIdentityCount: new Set(matching.map(imageIdentity).filter(Boolean)).size,
    discoveredMaxWidth: sizes.length ? Math.max(...sizes.map((x) => x.width)) : null,
    discoveredMaxHeight: sizes.length ? Math.max(...sizes.map((x) => x.height)) : null,
    discoveredRenditionHistogram: Object.entries(discoveredRenditions.reduce((acc: Record<string, number>, row) => {
      const r = row.rendition;
      const key = r ? `${r.width}x${r.height}.${r.format}` : "no-size-suffix";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    variantsByIdentity,
  });
}

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  publicEuropeCount: all.length,
  autoscoutRows: rows.length,
  sampled: results.length,
  samples: results,
}, null, 2));

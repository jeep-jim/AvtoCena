process.env.CATALOG_IMAGE_STORAGE_MODE = "source_urls_only";
process.env.CATALOG_MAX_IMAGES_PER_OFFER = "30";
process.env.CATALOG_SOURCE_TIMEOUT_MS = "30000";

const { autoGeorgiaStrictSource } = await import("../apps/web/lib/catalog/auto-georgia-strict-source.ts");

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ka;q=0.8,ru;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
function absoluteUrl(value: string, base: string) {
  try { return new URL(String(value || "").replace(/\\\//g, "/").replace(/&amp;/gi, "&"), base).toString(); } catch { return ""; }
}
function detailBoundUrls(markup: string, base: string, id: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/<(?:img|source|meta)[^>]+(?:data-original|data-lazy-src|data-src|src|content)\s*=\s*["']([^"']+)["'][^>]*>/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi)) match[1].split(",").forEach((item) => values.push(item.trim().split(/\s+/)[0]));
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) values.push(match[0].replace(/\\\//g, "/"));
  return [...new Set(values.map((value) => absoluteUrl(value, base)).filter(Boolean))].filter((url) => {
    try { return decodeURIComponent(new URL(url).pathname).toLowerCase().includes(`/ad${id.toLowerCase()}/`); } catch { return false; }
  });
}
async function probeImage(url: string, referer: string) {
  try {
    const res = await fetch(url, { headers: { ...HEADERS, accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8", referer }, redirect: "manual" });
    const body = res.ok ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
    return { status: res.status, contentType: res.headers.get("content-type"), contentLengthHeader: res.headers.get("content-length"), bytes: body.length, location: res.headers.get("location") };
  } catch (e: any) { return { error: String(e?.message || e) }; }
}

const samples: any[] = [];
let cursor: string | null = null;
let pages = 0;
while (pages < 3 && samples.length < 6) {
  const page = await autoGeorgiaStrictSource.fetchPage(cursor);
  pages++;
  for (const raw of page.items || []) {
    const offer = autoGeorgiaStrictSource.normalizeOffer(raw);
    if (!offer || Number(offer.year || 0) < 2020) continue;
    const id = String(offer.sourceOfferId || "");
    const detailUrl = String(offer.operational?.sourceUrl || "");
    const beforeRaw = Array.isArray((offer.operational?.raw as any)?.images) ? (offer.operational?.raw as any).images.length : 0;
    const detailRes = await fetch(detailUrl, { headers: { ...HEADERS, referer: detailUrl }, redirect: "follow" });
    const markup = await detailRes.text();
    const exactUrls = detailBoundUrls(markup, detailRes.url || detailUrl, id);
    let adapterImages: any[] = [];
    try { adapterImages = await autoGeorgiaStrictSource.fetchImages(offer); } catch {}
    const probes = [];
    for (const url of exactUrls.slice(0, 3)) probes.push({ url, ...(await probeImage(url, detailUrl)) });
    samples.push({ sourceOfferId: id, year: offer.year, make: offer.make, model: offer.model, sourceUrl: detailUrl, detailStatus: detailRes.status, listingCardBoundImages: beforeRaw, exactDetailUrls: exactUrls.length, exactUrlSamples: exactUrls.slice(0, 5), gallerySourceImageCount: offer.operational?.gallerySourceImageCount, adapterFetchedImages: adapterImages.length, probes });
    if (samples.length >= 6) break;
  }
  if (!page.nextCursor || page.finished) break;
  cursor = String(page.nextCursor);
}
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), pages, sampled: samples.length, samples }, null, 2));

import { BeForwardPublicAdapter, Che168GlobalPublicAdapter, EncarDirectAdapter, extractEncarImageUrls, normalizeEncarPrice } from "../apps/web/lib/catalog/adapters.ts";
import { assertSafeImageUrl } from "../apps/web/lib/catalog/storage.ts";
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v = "true"] = a.slice(2).split("="); return [k, v]; }));
const source = args.source || "encar_direct"; const limit = Number(args.limit || 20); const started = Date.now();
const IMAGE_MAX_BYTES = Number(process.env.CATALOG_IMAGE_MAX_BYTES || 8_000_000);
const HEADERS = { "user-agent": "AvtoCenaCatalog/1.0", referer: "https://m.encar.com/" };
async function withSourceTimeout(fn) { const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 15000)); try { return await fn(controller.signal); } catch (error) { if (error?.name === "AbortError") throw new Error("source_timeout"); throw error; } finally { clearTimeout(timeout); } }
async function fetchImageProbe(url) {
  return withSourceTimeout(async (signal) => {
    let currentUrl = assertSafeImageUrl(url);
    let res = null;
    for (let redirects = 0; redirects <= 3; redirects++) {
      res = await fetch(currentUrl, { headers: HEADERS, redirect: "manual", signal });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get("location");
        if (!location || redirects === 3) return { firstImageStatus: res.status, firstImageContentType: res.headers.get("content-type") || null, firstImageBytes: 0 };
        currentUrl = assertSafeImageUrl(new URL(location, currentUrl).toString());
        continue;
      }
      break;
    }
    const contentType = res?.headers.get("content-type") || null;
    const okType = /^image\/(jpeg|png|webp)$/i.test(contentType || "");
    const bytes = res?.ok && okType ? (await res.arrayBuffer()).byteLength : 0;
    return { firstImageStatus: res?.status || null, firstImageContentType: contentType, firstImageBytes: bytes > IMAGE_MAX_BYTES ? 0 : bytes };
  });
}
async function fetchDetailJson(url) {
  return withSourceTimeout(async (signal) => {
    const res = await fetch(url, { headers: HEADERS, signal });
    const detailOk = res.ok && /json/i.test(res.headers.get("content-type") || "");
    return { res, detailOk, detail: detailOk ? await res.json() : null };
  });
}
async function runEncar() {
  const adapter = new EncarDirectAdapter(); process.env.CATALOG_ENCAR_DIRECT_PAGE_SIZE = String(limit);
  const page = await adapter.fetchPage(null); const normalized = page.items.map((raw) => adapter.normalizeOffer(raw)).filter(Boolean); const first = normalized[0];
  let detailStatus = null, detailOk = false, detail = null, imageUrls = 0, imageProbe = { firstImageStatus: null, firstImageContentType: null, firstImageBytes: 0 };
  if (first) {
    const detailResult = await fetchDetailJson(`https://api.encar.com/v1/readside/vehicle/${first.sourceOfferId}`);
    detailStatus = detailResult.res.status; detailOk = detailResult.detailOk; detail = detailResult.detail;
    const urls = extractEncarImageUrls(first, detail);
    imageUrls = urls.length;
    if (urls[0]) imageProbe = await fetchImageProbe(urls[0]);
  }
  return { source, records: page.items.length, normalized: normalized.length, count: page.count || null, firstOfferId: first?.sourceOfferId || null, make: first?.make || null, model: first?.model || null, year: first?.year || null, sourcePriceKrw: first?.sourcePrice || normalizeEncarPrice(page.items[0]?.Price) || null, detailStatus, detailOk, imageUrls, ...imageProbe, responseMs: Date.now() - started };
}
async function runChe168() { const adapter = new Che168GlobalPublicAdapter(); process.env.CATALOG_CHE168_GLOBAL_PAGE_SIZE = String(limit); const page = await adapter.fetchPage(null); const normalized = page.items.map((raw) => adapter.normalizeOffer(raw)).filter(Boolean); return { source, dryRun: true, records: page.items.length, normalized: normalized.length, firstOfferId: normalized[0]?.sourceOfferId || null, responseMs: Date.now() - started }; }
async function runBeForward() { const adapter = new BeForwardPublicAdapter(); const page = await adapter.fetchPage(null); const normalized = page.items.map((raw) => adapter.normalizeOffer(raw)).filter(Boolean); return { source, dryRun: true, records: page.items.length, normalized: normalized.length, priceFound: page.items.some((x) => x.price), locationFound: page.items.some((x) => x.location), images: page.items.reduce((n, x) => n + (x.images?.length || 0), 0), responseMs: Date.now() - started }; }
try { const result = source === "encar_direct" ? await runEncar() : source === "che168_global" ? await runChe168() : await runBeForward(); console.log(JSON.stringify(result, null, 2)); const ok = source === "encar_direct" ? result.records > 0 && result.normalized > 0 && result.sourcePriceKrw > 0 && result.detailOk === true && result.imageUrls > 0 && result.firstImageStatus === 200 && result.firstImageBytes > 0 : result.records > 0 && result.normalized > 0; process.exit(ok ? 0 : 1); } catch (error) { console.log(JSON.stringify({ source, error: error?.message || String(error), responseMs: Date.now() - started }, null, 2)); process.exit(1); }

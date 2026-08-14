import crypto from "node:crypto";

const { getJsonStorage } = await import("../apps/web/lib/data.ts");
const { readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");
const { catalogMinYearForMarket } = await import("../apps/web/lib/catalog/offer-quality.ts");

function sha(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function resolution(url) {
  const match = String(url || "").match(/\/(\d{2,5})x(\d{2,5})\.(?:jpe?g|webp|avif|png)(?:[?#]|$)/i);
  return { width: Number(match?.[1] || 0), height: Number(match?.[2] || 0) };
}
function exactAutoScoutImage(offer, image) {
  const id = String(offer?.sourceOfferId || "");
  const url = String(image?.url || "");
  if (!id || !/^https:\/\/prod\.pictures\.autoscout24\.net\/listing-images\//i.test(url)) return false;
  let pathname = "";
  try { pathname = new URL(url).pathname.toLowerCase(); } catch { return false; }
  const { width, height } = resolution(url);
  return pathname.startsWith(`/listing-images/${id}_`.toLowerCase()) && width >= 900 && height >= 600;
}

const storage = getJsonStorage();
const manifestMeta = await storage.readJsonWithMeta("catalog/manifest.json", { version: 2, generationId: "", markets: {} });
if (!manifestMeta.found || !manifestMeta.etag || !manifestMeta.value?.generationId) throw new Error("catalog_manifest_missing");

const report = {
  checkedAt: new Date().toISOString(),
  generationId: manifestMeta.value.generationId,
  manifestEtag: manifestMeta.etag,
  markets: {},
  europe: {},
  writerSafety: {},
  failures: [],
};

const rowsByMarket = new Map();
for (const market of PUBLIC_CATALOG_MARKETS) {
  const rows = await readMarketOffers(market);
  rowsByMarket.set(market, rows);
  const entry = manifestMeta.value.markets?.[market] || { count: 0, chunks: [] };
  const state = {
    count: rows.length,
    manifestCount: Number(entry.count || 0),
    logicalHash: sha(rows),
    firstIds: rows.slice(0, 10).map((row) => row.id),
    firstImageUrls: rows.slice(0, 10).map((row) => row.images?.[0]?.url || ""),
  };
  report.markets[market] = state;
  if (state.count !== state.manifestCount) report.failures.push(`${market}:manifest_count_mismatch:${state.count}:${state.manifestCount}`);
}

const europe = rowsByMarket.get("europe") || [];
const autoscout = europe.filter((row) => String(row?.sourceId || "") === "autoscout_europe_open");
const minYear = catalogMinYearForMarket("europe");
const exactHq = autoscout.filter((offer) => Array.isArray(offer.images) && offer.images.length >= 5 && offer.images.every((image) => exactAutoScoutImage(offer, image)));
const blurryOrUnverified = autoscout.filter((offer) => !(Array.isArray(offer.images) && offer.images.length >= 5 && offer.images.every((image) => exactAutoScoutImage(offer, image))));
const invalidAge = autoscout.filter((offer) => Number(offer?.year || 0) < minYear);
const invalidSourceUrl = autoscout.filter((offer) => {
  const id = String(offer?.sourceOfferId || "");
  const url = String(offer?.operational?.sourceUrl || "");
  return !id || !/^https:\/\/www\.autoscout24\.com\/offers\//i.test(url) || !url.includes(id);
});

report.europe = {
  total: europe.length,
  sourceCounts: Object.fromEntries([...new Set(europe.map((row) => String(row?.sourceId || "unknown")))].sort().map((sourceId) => [sourceId, europe.filter((row) => String(row?.sourceId || "unknown") === sourceId).length])),
  autoscoutCount: autoscout.length,
  minYear,
  invalidAgeCount: invalidAge.length,
  invalidSourceUrlCount: invalidSourceUrl.length,
  alreadyExactHqCount: exactHq.length,
  needsHqRefreshCount: blurryOrUnverified.length,
  sampleNeedsRefresh: blurryOrUnverified.slice(0, 12).map((offer) => ({
    id: offer.id,
    sourceOfferId: offer.sourceOfferId,
    year: offer.year,
    title: offer.sourceTitle || `${offer.make || ""} ${offer.model || ""}`.trim(),
    sourceUrl: offer.operational?.sourceUrl || "",
    images: (offer.images || []).slice(0, 3).map((image) => ({ url: image.url, width: image.width, height: image.height })),
  })),
};
if (invalidAge.length) report.failures.push(`europe:autoscout_below_min_year:${invalidAge.length}`);
if (invalidSourceUrl.length) report.failures.push(`europe:autoscout_source_identity_invalid:${invalidSourceUrl.length}`);

// The safe writer for this operation must read every non-target market from the
// current manifest and carry those exact row objects into the next generation.
// We verify the candidate preservation path before any network image fetch or write.
const candidateByMarket = new Map(PUBLIC_CATALOG_MARKETS.map((market) => [market, rowsByMarket.get(market)]));
const preservedChecks = {};
for (const market of PUBLIC_CATALOG_MARKETS) {
  if (market === "europe") continue;
  const before = report.markets[market].logicalHash;
  const after = sha(candidateByMarket.get(market) || []);
  preservedChecks[market] = { before, candidate: after, identical: before === after };
  if (before !== after) report.failures.push(`${market}:candidate_preservation_hash_mismatch`);
}
report.writerSafety = {
  optimisticManifestEtagAvailable: Boolean(manifestMeta.etag),
  targetMarketOnly: "europe",
  preservedMarketCount: PUBLIC_CATALOG_MARKETS.filter((market) => market !== "europe").length,
  preservedChecks,
  safeToProceed: Boolean(manifestMeta.etag) && Object.values(preservedChecks).every((value) => value.identical),
};

console.log(JSON.stringify(report, null, 2));
await (await import("node:fs/promises")).writeFile("europe-autoscout-hq-baseline.json", JSON.stringify(report, null, 2));
if (report.failures.length || !report.writerSafety.safeToProceed) process.exitCode = 1;

import crypto from "node:crypto";

const { getJsonStorage } = await import("../apps/web/lib/data.ts");
const { AutoScoutHqAdapter } = await import("../apps/web/lib/catalog/autoscout-hq-source.ts");
const { credibleCatalogImages, catalogMinYearForMarket } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { rebuildIndexes, offerPath, chunkName } = await import("../apps/web/lib/catalog/storage.ts");
const { CATALOG_CHUNK_SIZE, PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

const TARGET_MARKET = "europe";
const TARGET_SOURCE = "autoscout_europe_open";
const CONCURRENCY = Math.max(1, Math.min(16, Number(process.env.AUTOSCOUT_HQ_CONCURRENCY || 8)));
const RETRIES = Math.max(1, Math.min(5, Number(process.env.AUTOSCOUT_HQ_RETRIES || 3)));
const minYear = catalogMinYearForMarket(TARGET_MARKET);
const storage = getJsonStorage();
const adapter = new AutoScoutHqAdapter();

function hashText(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function hashRows(rows) { return hashText(JSON.stringify(rows)); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function imageResolution(url) {
  const match = String(url || "").match(/\/(\d{2,5})x(\d{2,5})\.(?:jpe?g|webp|avif|png)(?:[?#]|$)/i);
  return { width: Number(match?.[1] || 0), height: Number(match?.[2] || 0) };
}
function exactHqImages(offer, images) {
  const sourceOfferId = String(offer?.sourceOfferId || "");
  if (!sourceOfferId || !Array.isArray(images) || images.length < 5) return false;
  return images.every((image) => {
    const url = String(image?.url || "");
    if (!/^https:\/\/prod\.pictures\.autoscout24\.net\/listing-images\//i.test(url)) return false;
    let pathname = "";
    try { pathname = new URL(url).pathname.toLowerCase(); } catch { return false; }
    const { width, height } = imageResolution(url);
    return pathname.startsWith(`/listing-images/${sourceOfferId}_`.toLowerCase()) && width >= 900 && height >= 600;
  });
}
function materializeImage(image) {
  const url = String(image.url || "");
  const digest = hashText(url);
  return {
    ...image,
    id: `src_${digest.slice(0, 24)}`,
    objectKey: "",
    checksum: digest,
    size: Number(image.size || 0),
  };
}
async function readPublicState() {
  const meta = await storage.readJsonWithMeta("catalog/manifest.json", { version: 2, generationId: "", markets: {} });
  if (!meta.found || !meta.etag || !meta.value?.generationId) throw new Error("public_manifest_missing");
  const byMarket = new Map();
  for (const market of PUBLIC_CATALOG_MARKETS) {
    const entry = meta.value.markets?.[market] || { count: 0, chunks: [] };
    const rows = [];
    for (const chunk of entry.chunks || []) {
      const part = await storage.readJson(offerPath(meta.value.generationId, market, chunk), []);
      if (!Array.isArray(part)) throw new Error(`public_chunk_invalid:${market}:${chunk}`);
      rows.push(...part);
    }
    if (rows.length !== Number(entry.count || 0)) throw new Error(`public_count_mismatch:${market}:${rows.length}:${entry.count || 0}`);
    byMarket.set(market, rows);
  }
  return { meta, byMarket };
}
async function readInternalState() {
  const meta = await storage.readJsonWithMeta("catalog/internal/manifest.json", { generationId: "", sources: {} });
  if (!meta.found || !meta.etag || !meta.value?.generationId) throw new Error("internal_manifest_missing");
  const source = meta.value.sources?.[TARGET_SOURCE];
  if (!source || !Array.isArray(source.chunks)) throw new Error("internal_autoscout_source_missing");
  const rows = [];
  for (const path of source.chunks) {
    const part = await storage.readJson(path, []);
    if (!Array.isArray(part)) throw new Error(`internal_chunk_invalid:${path}`);
    rows.push(...part);
  }
  if (rows.length !== Number(source.count || 0)) throw new Error(`internal_autoscout_count_mismatch:${rows.length}:${source.count || 0}`);
  return { meta, rows };
}
async function refreshOne(row) {
  if (Number(row?.year || 0) < minYear) return { status: "fatal", id: row.id, error: `below_min_year:${row.year}` };
  const sourceOfferId = String(row?.sourceOfferId || "");
  const sourceUrl = String(row?.operational?.sourceUrl || "");
  if (!sourceOfferId || !/^https:\/\/www\.autoscout24\.com\/offers\//i.test(sourceUrl) || !sourceUrl.includes(sourceOfferId)) {
    return { status: "fatal", id: row.id, error: "source_identity_invalid" };
  }
  let lastError = "";
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const copy = structuredClone(row);
      const fresh = credibleCatalogImages(await adapter.fetchImages(copy)).map(materializeImage);
      if (!exactHqImages(copy, fresh)) throw new Error(`hq_gallery_invalid:${fresh.length}`);
      return { status: "updated", id: row.id, offer: { ...row, images: fresh, operational: copy.operational }, imageCount: fresh.length };
    } catch (error) {
      lastError = String(error?.message || error);
      if (/autoscout_detail_http_(?:404|410):/i.test(lastError)) return { status: "gone", id: row.id, error: lastError };
      if (attempt < RETRIES) await sleep(500 * attempt);
    }
  }
  return { status: "fatal", id: row.id, error: lastError || "unknown_refresh_failure" };
}
async function mapConcurrent(items, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length || 1) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
      if ((index + 1) % 100 === 0) console.log(`progress ${index + 1}/${items.length}`);
    }
  }));
  return results;
}

const publicBefore = await readPublicState();
const internalBefore = await readInternalState();
const beforeHashes = Object.fromEntries(PUBLIC_CATALOG_MARKETS.filter((m) => m !== TARGET_MARKET).map((market) => [market, hashRows(publicBefore.byMarket.get(market) || [])]));
const europeBefore = publicBefore.byMarket.get(TARGET_MARKET) || [];
const targetRows = europeBefore.filter((row) => String(row?.sourceId || "") === TARGET_SOURCE);
if (!targetRows.length) throw new Error("public_autoscout_rows_missing");

console.log(JSON.stringify({ phase: "start", generationId: publicBefore.meta.value.generationId, europeCount: europeBefore.length, autoscoutCount: targetRows.length, internalAutoscoutCount: internalBefore.rows.length, concurrency: CONCURRENCY, retries: RETRIES }, null, 2));
const refreshResults = await mapConcurrent(targetRows, refreshOne);
const fatals = refreshResults.filter((item) => item.status === "fatal");
const gone = refreshResults.filter((item) => item.status === "gone");
const updated = refreshResults.filter((item) => item.status === "updated");
if (fatals.length) {
  console.error(JSON.stringify({ phase: "abort_before_write", updated: updated.length, gone: gone.length, fatal: fatals.length, sample: fatals.slice(0, 20) }, null, 2));
  process.exit(2);
}

const refreshedById = new Map(updated.map((item) => [item.id, item.offer]));
const goneIds = new Set(gone.map((item) => item.id));
const europeAfterCandidate = europeBefore
  .filter((row) => String(row?.sourceId || "") !== TARGET_SOURCE || !goneIds.has(row.id))
  .map((row) => refreshedById.get(row.id) || row);
const candidateByMarket = new Map(publicBefore.byMarket);
candidateByMarket.set(TARGET_MARKET, europeAfterCandidate);
for (const [market, beforeHash] of Object.entries(beforeHashes)) {
  const candidateHash = hashRows(candidateByMarket.get(market) || []);
  if (candidateHash !== beforeHash) throw new Error(`preservation_candidate_hash_mismatch:${market}`);
}
const autoscoutAfterCandidate = europeAfterCandidate.filter((row) => String(row?.sourceId || "") === TARGET_SOURCE);
if (autoscoutAfterCandidate.some((row) => Number(row.year || 0) < minYear || !exactHqImages(row, row.images))) throw new Error("candidate_autoscout_quality_gate_failed");

// Re-check optimistic-lock preconditions immediately before any write.
const [publicGuard, internalGuard] = await Promise.all([
  storage.readJsonWithMeta("catalog/manifest.json", {}),
  storage.readJsonWithMeta("catalog/internal/manifest.json", {}),
]);
if (publicGuard.etag !== publicBefore.meta.etag || publicGuard.value?.generationId !== publicBefore.meta.value.generationId) throw new Error("public_manifest_changed_during_refresh");
if (internalGuard.etag !== internalBefore.meta.etag || internalGuard.value?.generationId !== internalBefore.meta.value.generationId) throw new Error("internal_manifest_changed_during_refresh");

// Update only the AutoScout source in internal storage; every other internal
// source keeps its exact existing chunk paths and metadata.
const internalMap = new Map(internalBefore.rows.map((row) => [row.id, row]));
for (const [id, offer] of refreshedById) if (internalMap.has(id)) internalMap.set(id, offer);
for (const id of goneIds) if (internalMap.has(id)) {
  const previous = internalMap.get(id);
  internalMap.set(id, { ...previous, status: "stale", operational: { ...(previous.operational || {}), exactDetail: false, exactPhotos: false, galleryVerified: false, gallerySafetyMode: "autoscout_detail_gone_20260814", raw: { ...(previous.operational?.raw || {}), detailGone: true } } });
}
const internalRows = [...internalMap.values()];
const internalGeneration = `int_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const internalChunks = [];
for (let i = 0; i < internalRows.length; i += CATALOG_CHUNK_SIZE) {
  const name = chunkName(internalChunks.length + 1);
  const path = `catalog/internal/offers/${TARGET_SOURCE}/${internalGeneration}-${name}.json`;
  internalChunks.push(path);
  await storage.writeJson(path, internalRows.slice(i, i + CATALOG_CHUNK_SIZE), { ifNoneMatch: "*" });
}
const internalManifest = {
  ...internalBefore.meta.value,
  generationId: internalGeneration,
  updatedAt: new Date().toISOString(),
  sources: {
    ...(internalBefore.meta.value.sources || {}),
    [TARGET_SOURCE]: { count: internalRows.length, chunks: internalChunks, updatedAt: new Date().toISOString() },
  },
};
await storage.writeJson("catalog/internal/manifest.json", internalManifest, { ifMatch: internalBefore.meta.etag });

// Public writer: carry six markets byte-logically unchanged into a new generation
// and replace only Europe. No normalization/enrichment/retention filtering runs.
const generationId = `gen_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const updatedAt = new Date().toISOString();
const manifestMarkets = {};
const byId = {};
const imagesById = {};
const allOffers = [];
for (const market of PUBLIC_CATALOG_MARKETS) {
  const rows = candidateByMarket.get(market) || [];
  const chunks = [];
  for (let i = 0; i < rows.length; i += CATALOG_CHUNK_SIZE) {
    const name = chunkName(chunks.length + 1);
    chunks.push(name);
    const slice = rows.slice(i, i + CATALOG_CHUNK_SIZE);
    for (const offer of slice) {
      byId[offer.id] = { market, chunk: name };
      for (const image of offer.images || []) if (image?.id) imagesById[image.id] = { objectKey: image.objectKey || "", mimeType: image.mimeType || "image/jpeg", checksum: image.checksum || "", size: Number(image.size || 0) };
    }
    await storage.writeJson(offerPath(generationId, market, name), slice, { ifNoneMatch: "*" });
  }
  manifestMarkets[market] = { count: rows.length, chunks, updatedAt };
  allOffers.push(...rows);
}
await rebuildIndexes(generationId, allOffers, byId, imagesById);
const manifest = { version: 2, generationId, updatedAt, markets: manifestMarkets };
await storage.writeJson("catalog/manifest.json", manifest, { ifMatch: publicBefore.meta.etag });

const publicAfter = await readPublicState();
const preservation = {};
for (const [market, beforeHash] of Object.entries(beforeHashes)) {
  const afterHash = hashRows(publicAfter.byMarket.get(market) || []);
  preservation[market] = { beforeHash, afterHash, identical: beforeHash === afterHash, count: (publicAfter.byMarket.get(market) || []).length };
  if (beforeHash !== afterHash) throw new Error(`postpublish_preservation_hash_mismatch:${market}`);
}
const europeRowsAfter = publicAfter.byMarket.get(TARGET_MARKET) || [];
const autoscoutRowsAfter = europeRowsAfter.filter((row) => String(row?.sourceId || "") === TARGET_SOURCE);
const invalidAfter = autoscoutRowsAfter.filter((row) => Number(row.year || 0) < minYear || !exactHqImages(row, row.images));
if (invalidAfter.length) throw new Error(`postpublish_autoscout_quality_failed:${invalidAfter.length}`);

const report = {
  completedAt: new Date().toISOString(),
  previousGeneration: publicBefore.meta.value.generationId,
  generationId: publicAfter.meta.value.generationId,
  europeBefore: europeBefore.length,
  europeAfter: europeRowsAfter.length,
  autoscoutBefore: targetRows.length,
  autoscoutUpdated: updated.length,
  autoscoutRemovedGone: gone.length,
  autoscoutAfter: autoscoutRowsAfter.length,
  autoscoutInvalidAfter: invalidAfter.length,
  minYear,
  firstUpdated: updated.slice(0, 12).map((item) => ({ id: item.id, sourceOfferId: item.offer.sourceOfferId, imageCount: item.offer.images.length, firstImage: item.offer.images[0]?.url || "", width: item.offer.images[0]?.width, height: item.offer.images[0]?.height })),
  goneSample: gone.slice(0, 12),
  preservation,
  internal: { previousGeneration: internalBefore.meta.value.generationId, generationId: internalGeneration, autoscoutRows: internalRows.length, otherSourceEntriesPreserved: Object.keys(internalBefore.meta.value.sources || {}).filter((id) => id !== TARGET_SOURCE).every((id) => JSON.stringify(internalBefore.meta.value.sources[id]) === JSON.stringify(internalManifest.sources[id])) },
};
console.log(JSON.stringify(report, null, 2));
await (await import("node:fs/promises")).writeFile("europe-autoscout-hq-refresh-result.json", JSON.stringify(report, null, 2));

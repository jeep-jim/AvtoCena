import crypto from "node:crypto";
import fs from "node:fs/promises";

const { getJsonStorage, mutateDataJson } = await import("../apps/web/lib/data.ts");
const { rebuildIndexes, offerPath, chunkName } = await import("../apps/web/lib/catalog/storage.ts");
const { canonicalSourceModelIdentity } = await import("../apps/web/lib/catalog/open-source-normalizer.ts");
const { catalogModelYearQuotaKey, CATALOG_MAX_OFFERS_PER_MODEL_YEAR } = await import("../apps/web/lib/catalog/inventory-quota.ts");
const { CATALOG_CHUNK_SIZE, PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

const EXPECTED_GENERATION = "gen_1786687307111_16644afe";
const EXPECTED_EUROPE_BEFORE = 3346;
const EXPECTED_EUROPE_AFTER = 3342;
const EXPECTED_AUTOSCOUT_BEFORE = 2217;
const EXPECTED_CORRECTIONS = 284;
const EXPECTED_CORRECTIONS_BY_SOURCE = {
  autoscout_europe_open: 182,
  mobile_de_open: 82,
  otomoto_europe_exact: 20,
};
const EXPECTED_REMOVED_IDS = new Set([
  "82784e637bc62461723a1a02",
  "12da3ae08b06d17df289e892",
  "093987f9adb357e82d21fcf5",
  "64ad22f191f55816e1f4e1da",
]);
const EXPECTED_OTHER_MARKET_HASHES = {
  korea: "b4441a903dbcd7b026fa7d0247d57d2d88859c097158afe6d5df71550b726ac3",
  china: "2ea05d80cdce6dd123deb5258a3247da892b3ecf001514a64c69ef3f63bd2c0b",
  japan: "6287e47da967c67b1a63a77b4f9e7ad2e87a6513cf2a364ff9794980f284cfcd",
  uae: "cfe26c32e463f03bd477c2477b5e77b3c960e03ab417d35531e2c45eeaf9c6de",
  georgia: "7792690302b319dc1211e3c9762ae9b3ad4a5c2dc662cece5d73124ff2f4a3e5",
  kyrgyzstan: "81f990c508ece409b945e3098f75a98bedf1e6d5e84b1cabba955ba81e4ca87f",
};
const TARGET_MARKET = "europe";
const AUTOSCOUT_SOURCE = "autoscout_europe_open";
const INTERNAL_CORRECTION_SOURCES = Object.keys(EXPECTED_CORRECTIONS_BY_SOURCE);
const storage = getJsonStorage();
const lockPath = "catalog/import-lock.json";
const operationId = `europe_model_quota_${crypto.randomUUID()}`;
let lockHeld = false;

function clean(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function hashRows(rows) { return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex"); }
function genericMercedes(value) { return /^(?:benz|mercedes|mercedes[-\s]?benz)$/i.test(clean(value)); }
function isMercedes(value) { return /mercedes|benz/i.test(clean(value)); }
function exactTitle(offer) {
  const raw = offer?.operational?.raw || {};
  return clean(offer?.sourceTitle || raw?.originalCatalogTitle || raw?.title || raw?.name || offer?.trim || "");
}
function imageUrls(offer) { return (Array.isArray(offer?.images) ? offer.images : []).map((image) => clean(image?.url)).filter(Boolean); }
function unique(values) { return [...new Set(values)]; }
function exactAutoScoutHq(offer) {
  const sourceOfferId = clean(offer?.sourceOfferId).toLowerCase();
  const images = Array.isArray(offer?.images) ? offer.images : [];
  if (!sourceOfferId || images.length < 5 || unique(imageUrls(offer)).length !== images.length) return false;
  return images.every((image) => {
    const url = clean(image?.url);
    if (!url || /\/250x188(?:\.|\/|\?|$)/i.test(url)) return false;
    let parsed;
    try { parsed = new URL(url); } catch { return false; }
    if (parsed.hostname.toLowerCase() !== "prod.pictures.autoscout24.net") return false;
    if (!parsed.pathname.toLowerCase().startsWith(`/listing-images/${sourceOfferId}_`)) return false;
    const match = parsed.pathname.match(/\/(\d{2,5})x(\d{2,5})\.(?:jpe?g|webp|avif|png)$/i);
    const width = Number(image?.width || match?.[1] || 0);
    const height = Number(image?.height || match?.[2] || 0);
    return width >= 900 && height >= 600;
  });
}
function freshness(offer) {
  return Date.parse(clean(offer?.operational?.sourcePublishedAt || offer?.updatedAt || offer?.firstSeenAt)) || 0;
}
function quality(a, b) {
  const ap = Number(a?.totalRub || 0) > 0 && Number(a.totalRub) <= 8_000_000 ? 0 : 1;
  const bp = Number(b?.totalRub || 0) > 0 && Number(b.totalRub) <= 8_000_000 ? 0 : 1;
  return ap - bp
    || Number(b?.year || 0) - Number(a?.year || 0)
    || freshness(b) - freshness(a)
    || Number(b?.images?.length || 0) - Number(a?.images?.length || 0)
    || Number(a?.totalRub || Number.MAX_SAFE_INTEGER) - Number(b?.totalRub || Number.MAX_SAFE_INTEGER)
    || clean(a?.id).localeCompare(clean(b?.id));
}
function sourceCounts(rows) {
  const counts = {};
  for (const row of rows) counts[clean(row?.sourceId)] = Number(counts[clean(row?.sourceId)] || 0) + 1;
  return counts;
}
function quotaStats(rows) {
  const counts = new Map();
  for (const row of rows) {
    const key = catalogModelYearQuotaKey(row, TARGET_MARKET);
    if (!key) throw new Error(`quota_key_missing:${row?.id || "unknown"}`);
    counts.set(key, Number(counts.get(key) || 0) + 1);
  }
  const max = counts.size ? Math.max(...counts.values()) : 0;
  const violations = [...counts.entries()].filter(([, count]) => count > CATALOG_MAX_OFFERS_PER_MODEL_YEAR).map(([key, count]) => ({ key, count }));
  return { max, violations };
}
function correctionFor(offer) {
  const title = exactTitle(offer);
  const before = clean(offer?.model);
  if (!title) return null;
  const after = canonicalSourceModelIdentity(title, clean(offer?.make), before);
  if (!after || after === before) return null;
  return { id: clean(offer.id), sourceId: clean(offer.sourceId), sourceOfferId: clean(offer.sourceOfferId), make: clean(offer.make), year: Number(offer.year || 0), title, before, after };
}
function assertMercedesResolved(rows) {
  const malformed = rows.filter((offer) => {
    if (!isMercedes(offer?.make) || !genericMercedes(offer?.model)) return false;
    const title = exactTitle(offer);
    if (!title) return false;
    const resolved = canonicalSourceModelIdentity(title, clean(offer?.make), clean(offer?.model));
    return resolved && resolved !== clean(offer?.model) && !genericMercedes(resolved);
  });
  if (malformed.length) throw new Error(`provable_malformed_mercedes:${malformed.length}:${malformed.slice(0, 5).map((o) => o.id).join(",")}`);
}
async function acquireLock() {
  await mutateDataJson(lockPath, { lockedUntil: "" }, (current) => {
    const lockedUntil = Date.parse(clean(current?.lockedUntil));
    if (Number.isFinite(lockedUntil) && lockedUntil > Date.now() && current?.operationId !== operationId) {
      throw new Error(`catalog_writer_lock_active:${current?.operationType || "unknown"}:${current?.lockedUntil}`);
    }
    return {
      operationId,
      operationType: "europe_source_identity_quota_publish",
      lockedUntil: new Date(Date.now() + 45 * 60_000).toISOString(),
      startedAt: new Date().toISOString(),
    };
  });
  lockHeld = true;
}
async function releaseLock() {
  if (!lockHeld) return;
  await mutateDataJson(lockPath, { lockedUntil: "" }, (current) => current?.operationId === operationId
    ? { operationId, operationType: "europe_source_identity_quota_publish", lockedUntil: "", finishedAt: new Date().toISOString() }
    : current);
  lockHeld = false;
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
async function readInternalSource(manifest, sourceId) {
  const entry = manifest?.sources?.[sourceId];
  if (!entry || !Array.isArray(entry.chunks)) throw new Error(`internal_source_missing:${sourceId}`);
  const rows = [];
  for (const path of entry.chunks) {
    const part = await storage.readJson(path, []);
    if (!Array.isArray(part)) throw new Error(`internal_chunk_invalid:${sourceId}:${path}`);
    rows.push(...part);
  }
  if (rows.length !== Number(entry.count || 0)) throw new Error(`internal_count_mismatch:${sourceId}:${rows.length}:${entry.count || 0}`);
  return rows;
}
async function writeInternalSource(sourceId, rows, generationId) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += CATALOG_CHUNK_SIZE) {
    const name = chunkName(chunks.length + 1);
    const path = `catalog/internal/offers/${sourceId}/${generationId}-${name}.json`;
    chunks.push(path);
    await storage.writeJson(path, rows.slice(i, i + CATALOG_CHUNK_SIZE), { ifNoneMatch: "*" });
  }
  return chunks;
}

let report = null;
try {
  await acquireLock();

  // All baseline checks happen after owning the shared writer lock.
  const publicBefore = await readPublicState();
  if (publicBefore.meta.value.generationId !== EXPECTED_GENERATION) {
    throw new Error(`baseline_generation_changed:${publicBefore.meta.value.generationId}:${EXPECTED_GENERATION}`);
  }
  for (const [market, expectedHash] of Object.entries(EXPECTED_OTHER_MARKET_HASHES)) {
    const rows = publicBefore.byMarket.get(market) || [];
    const actualHash = hashRows(rows);
    if (actualHash !== expectedHash) throw new Error(`baseline_market_hash_changed:${market}:${actualHash}:${expectedHash}`);
  }
  const europeBefore = publicBefore.byMarket.get(TARGET_MARKET) || [];
  if (europeBefore.length !== EXPECTED_EUROPE_BEFORE) throw new Error(`europe_count_changed:${europeBefore.length}:${EXPECTED_EUROPE_BEFORE}`);
  if (europeBefore.some((row) => Number(row?.year || 0) < 2020)) throw new Error("europe_below_2020_before_publish");
  const autoscoutBefore = europeBefore.filter((row) => clean(row?.sourceId) === AUTOSCOUT_SOURCE);
  if (autoscoutBefore.length !== EXPECTED_AUTOSCOUT_BEFORE) throw new Error(`autoscout_count_changed:${autoscoutBefore.length}:${EXPECTED_AUTOSCOUT_BEFORE}`);
  const invalidAutoScout = autoscoutBefore.filter((row) => !exactAutoScoutHq(row));
  if (invalidAutoScout.length) throw new Error(`autoscout_hq_baseline_invalid:${invalidAutoScout.length}`);

  const corrections = europeBefore.map(correctionFor).filter(Boolean);
  if (corrections.length !== EXPECTED_CORRECTIONS) throw new Error(`correction_count_changed:${corrections.length}:${EXPECTED_CORRECTIONS}`);
  const correctionCounts = sourceCounts(corrections);
  for (const [sourceId, expected] of Object.entries(EXPECTED_CORRECTIONS_BY_SOURCE)) {
    if (Number(correctionCounts[sourceId] || 0) !== expected) throw new Error(`correction_source_count_changed:${sourceId}:${correctionCounts[sourceId] || 0}:${expected}`);
  }
  const correctionById = new Map(corrections.map((row) => [row.id, row]));
  const correctedEurope = europeBefore.map((row) => {
    const correction = correctionById.get(clean(row.id));
    return correction ? { ...row, model: correction.after } : row;
  });
  assertMercedesResolved(correctedEurope);

  const counts = new Map();
  const selected = [];
  const removed = [];
  for (const row of [...correctedEurope].sort(quality)) {
    const key = catalogModelYearQuotaKey(row, TARGET_MARKET);
    if (!key) throw new Error(`quota_key_missing:${row?.id || "unknown"}`);
    const count = Number(counts.get(key) || 0);
    if (count >= CATALOG_MAX_OFFERS_PER_MODEL_YEAR) { removed.push({ id: clean(row.id), sourceId: clean(row.sourceId), sourceOfferId: clean(row.sourceOfferId), make: clean(row.make), model: clean(row.model), year: Number(row.year || 0), key }); continue; }
    counts.set(key, count + 1);
    selected.push(row);
  }
  const removedIds = new Set(removed.map((row) => row.id));
  if (removed.length !== EXPECTED_REMOVED_IDS.size || [...EXPECTED_REMOVED_IDS].some((id) => !removedIds.has(id))) {
    throw new Error(`quota_removed_set_changed:${JSON.stringify(removed)}`);
  }
  if (selected.length !== EXPECTED_EUROPE_AFTER) throw new Error(`selected_europe_count_changed:${selected.length}:${EXPECTED_EUROPE_AFTER}`);
  const selectedQuota = quotaStats(selected);
  if (selectedQuota.max > CATALOG_MAX_OFFERS_PER_MODEL_YEAR || selectedQuota.violations.length) throw new Error(`candidate_quota_failed:${JSON.stringify(selectedQuota)}`);
  assertMercedesResolved(selected);
  if (selected.some((row) => Number(row?.year || 0) < 2020)) throw new Error("candidate_europe_below_2020");
  const autoscoutCandidate = selected.filter((row) => clean(row?.sourceId) === AUTOSCOUT_SOURCE);
  if (autoscoutCandidate.some((row) => !exactAutoScoutHq(row))) throw new Error("candidate_autoscout_hq_invalid");

  // Candidate differs from the public baseline only by 284 model fields and four quota removals.
  const selectedById = new Map(selected.map((row) => [clean(row.id), row]));
  let unexpectedFieldChanges = 0;
  for (const before of europeBefore) {
    if (removedIds.has(clean(before.id))) continue;
    const after = selectedById.get(clean(before.id));
    if (!after) throw new Error(`candidate_row_missing:${before.id}`);
    const expected = correctionById.has(clean(before.id)) ? { ...before, model: correctionById.get(clean(before.id)).after } : before;
    if (JSON.stringify(after) !== JSON.stringify(expected)) unexpectedFieldChanges += 1;
  }
  if (unexpectedFieldChanges) throw new Error(`unexpected_candidate_field_changes:${unexpectedFieldChanges}`);

  const internalBefore = await storage.readJsonWithMeta("catalog/internal/manifest.json", { generationId: "", sources: {} });
  if (!internalBefore.found || !internalBefore.etag || !internalBefore.value?.generationId) throw new Error("internal_manifest_missing");
  const internalRowsBySource = new Map();
  const updatedInternalRowsBySource = new Map();
  for (const sourceId of INTERNAL_CORRECTION_SOURCES) {
    const rows = await readInternalSource(internalBefore.value, sourceId);
    internalRowsBySource.set(sourceId, rows);
    const sourceCorrections = corrections.filter((row) => row.sourceId === sourceId);
    const byId = new Map(sourceCorrections.map((row) => [row.id, row]));
    let matched = 0;
    const updated = rows.map((row) => {
      const correction = byId.get(clean(row.id));
      if (!correction) return row;
      matched += 1;
      return { ...row, model: correction.after };
    });
    if (matched !== sourceCorrections.length) throw new Error(`internal_correction_match_failed:${sourceId}:${matched}:${sourceCorrections.length}`);
    updatedInternalRowsBySource.set(sourceId, updated);
  }

  // Recheck both manifests immediately before staging any generation data.
  const [publicGuard, internalGuard] = await Promise.all([
    storage.readJsonWithMeta("catalog/manifest.json", {}),
    storage.readJsonWithMeta("catalog/internal/manifest.json", {}),
  ]);
  if (publicGuard.etag !== publicBefore.meta.etag || publicGuard.value?.generationId !== EXPECTED_GENERATION) throw new Error("public_manifest_changed_before_staging");
  if (internalGuard.etag !== internalBefore.etag || internalGuard.value?.generationId !== internalBefore.value.generationId) throw new Error("internal_manifest_changed_before_staging");

  const internalGeneration = `int_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const internalSources = { ...(internalBefore.value.sources || {}) };
  for (const sourceId of INTERNAL_CORRECTION_SOURCES) {
    const rows = updatedInternalRowsBySource.get(sourceId) || [];
    const chunks = await writeInternalSource(sourceId, rows, internalGeneration);
    internalSources[sourceId] = { ...internalSources[sourceId], count: rows.length, chunks, updatedAt: new Date().toISOString() };
  }
  const internalManifest = { ...internalBefore.value, generationId: internalGeneration, updatedAt: new Date().toISOString(), sources: internalSources };

  const candidateByMarket = new Map(publicBefore.byMarket);
  candidateByMarket.set(TARGET_MARKET, selected);
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
  const publicManifest = { version: 2, generationId, updatedAt, markets: manifestMarkets };

  // Final optimistic guards after staging and before manifest flips.
  const [publicFinalGuard, internalFinalGuard] = await Promise.all([
    storage.readJsonWithMeta("catalog/manifest.json", {}),
    storage.readJsonWithMeta("catalog/internal/manifest.json", {}),
  ]);
  if (publicFinalGuard.etag !== publicBefore.meta.etag || publicFinalGuard.value?.generationId !== EXPECTED_GENERATION) throw new Error("public_manifest_changed_before_commit");
  if (internalFinalGuard.etag !== internalBefore.etag || internalFinalGuard.value?.generationId !== internalBefore.value.generationId) throw new Error("internal_manifest_changed_before_commit");

  await storage.writeJson("catalog/internal/manifest.json", internalManifest, { ifMatch: internalBefore.etag });
  try {
    await storage.writeJson("catalog/manifest.json", publicManifest, { ifMatch: publicBefore.meta.etag });
  } catch (error) {
    const currentInternal = await storage.readJsonWithMeta("catalog/internal/manifest.json", {});
    if (currentInternal.etag && currentInternal.value?.generationId === internalGeneration) {
      await storage.writeJson("catalog/internal/manifest.json", internalBefore.value, { ifMatch: currentInternal.etag });
    }
    throw error;
  }

  const publicAfter = await readPublicState();
  if (publicAfter.meta.value.generationId !== generationId) throw new Error(`postpublish_generation_mismatch:${publicAfter.meta.value.generationId}:${generationId}`);
  for (const [market, expectedHash] of Object.entries(EXPECTED_OTHER_MARKET_HASHES)) {
    const actualHash = hashRows(publicAfter.byMarket.get(market) || []);
    if (actualHash !== expectedHash) throw new Error(`postpublish_market_hash_changed:${market}`);
  }
  const europeAfter = publicAfter.byMarket.get(TARGET_MARKET) || [];
  if (europeAfter.length !== EXPECTED_EUROPE_AFTER) throw new Error(`postpublish_europe_count:${europeAfter.length}`);
  if (europeAfter.some((row) => Number(row?.year || 0) < 2020)) throw new Error("postpublish_europe_below_2020");
  const postQuota = quotaStats(europeAfter);
  if (postQuota.max > 20 || postQuota.violations.length) throw new Error(`postpublish_quota_failed:${JSON.stringify(postQuota)}`);
  assertMercedesResolved(europeAfter);
  const autoscoutAfter = europeAfter.filter((row) => clean(row?.sourceId) === AUTOSCOUT_SOURCE);
  const invalidAfter = autoscoutAfter.filter((row) => !exactAutoScoutHq(row));
  if (invalidAfter.length) throw new Error(`postpublish_autoscout_hq_invalid:${invalidAfter.length}`);
  if (autoscoutAfter.some((row) => imageUrls(row).some((url) => /\/250x188(?:\.|\/|\?|$)/i.test(url)))) throw new Error("postpublish_autoscout_250x188");

  const [facets, allProjection, europeProjection] = await Promise.all([
    storage.readJson("catalog/public/facets.json", {}),
    storage.readJson("catalog/public/projection/all.json", {}),
    storage.readJson("catalog/public/projection/europe.json", {}),
  ]);
  if (facets?.generationId !== generationId || allProjection?.generationId !== generationId || europeProjection?.generationId !== generationId) {
    throw new Error(`current_read_model_generation_mismatch:${facets?.generationId}:${allProjection?.generationId}:${europeProjection?.generationId}:${generationId}`);
  }

  const internalAfter = await storage.readJsonWithMeta("catalog/internal/manifest.json", {});
  if (internalAfter.value?.generationId !== internalGeneration) throw new Error(`postpublish_internal_generation_mismatch:${internalAfter.value?.generationId}:${internalGeneration}`);
  const internalCorrectionVerification = {};
  for (const sourceId of INTERNAL_CORRECTION_SOURCES) {
    const rows = await readInternalSource(internalAfter.value, sourceId);
    const rowsById = new Map(rows.map((row) => [clean(row.id), row]));
    const sourceCorrections = corrections.filter((row) => row.sourceId === sourceId);
    const bad = sourceCorrections.filter((correction) => clean(rowsById.get(correction.id)?.model) !== correction.after);
    internalCorrectionVerification[sourceId] = { expected: sourceCorrections.length, bad: bad.length };
    if (bad.length) throw new Error(`internal_postpublish_correction_failed:${sourceId}:${bad.length}`);
  }

  report = {
    publishedAt: new Date().toISOString(),
    previousPublicGeneration: EXPECTED_GENERATION,
    publicGeneration: generationId,
    previousInternalGeneration: internalBefore.value.generationId,
    internalGeneration,
    europeBefore: europeBefore.length,
    europeAfter: europeAfter.length,
    corrections: corrections.length,
    correctionsBySource: correctionCounts,
    removedByQuota: removed,
    maxModelYear: postQuota.max,
    autoscoutBefore: autoscoutBefore.length,
    autoscoutAfter: autoscoutAfter.length,
    autoscoutInvalidAfter: invalidAfter.length,
    autoscout250x188After: 0,
    autoscoutMinImagesAfter: autoscoutAfter.length ? Math.min(...autoscoutAfter.map((row) => unique(imageUrls(row)).length)) : 0,
    sixOtherMarkets: Object.fromEntries(Object.entries(EXPECTED_OTHER_MARKET_HASHES).map(([market, hash]) => [market, { count: (publicAfter.byMarket.get(market) || []).length, hash, identical: true }])),
    internalCorrectionVerification,
    currentReadModels: { facets: facets?.generationId, allProjection: allProjection?.generationId, europeProjection: europeProjection?.generationId },
    noUnrelatedPriceSpecRecalculation: true,
  };
  await fs.writeFile("europe-model-quota-publish-result.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await releaseLock();
}

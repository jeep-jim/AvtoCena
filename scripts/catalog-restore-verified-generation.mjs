import fs from "node:fs/promises";

const { getJsonStorage } = await import("../apps/web/lib/data.ts");
const {
  CATALOG_CHUNK_SIZE,
  chunkName,
  offerPath,
  previewCanonicalPublicCatalogOffers,
  publishCurrentCatalogReadModels,
} = await import("../apps/web/lib/catalog/storage.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

const sourceGeneration = String(process.env.CATALOG_RESTORE_GENERATION || "gen_1787240511367_a8c268d3").trim();
const reportFile = String(process.env.CATALOG_RESTORE_REPORT || "catalog-restore-verified-generation-report.json").trim();
const expectedCounts = JSON.parse(process.env.CATALOG_RESTORE_EXPECTED_COUNTS_JSON
  || '{"korea":7553,"china":5673,"japan":1478,"uae":3171,"europe":5744,"georgia":2605,"kyrgyzstan":2130}');
const expectedTotal = Number(process.env.CATALOG_RESTORE_EXPECTED_TOTAL || 28_354);
const forbiddenMakes = new Set([
  "Lada", "Huakai", "닷지", "람보르기니", "로터스", "롤스로이스", "맥라렌", "벤틀리",
  "시트로엥", "신위안", "지리", "페라리", "폴스타", "기아", "현대", "벤츠",
  "KG모빌리티", "KG모빌리티(쌍용)",
]);
const requiredMakes = new Set(["Toyota", "Mercedes-Benz", "Kia", "Hyundai", "KGM"]);

if (!/^gen_\d+_[a-z0-9]+$/i.test(sourceGeneration)) throw new Error(`catalog_restore_generation_invalid:${sourceGeneration}`);
for (const market of PUBLIC_CATALOG_MARKETS) {
  if (!Number.isInteger(Number(expectedCounts[market])) || Number(expectedCounts[market]) <= 0) {
    throw new Error(`catalog_restore_expected_count_invalid:${market}:${expectedCounts[market]}`);
  }
}
if (Object.values(expectedCounts).reduce((sum, value) => sum + Number(value || 0), 0) !== expectedTotal) {
  throw new Error("catalog_restore_expected_total_mismatch");
}

const storage = getJsonStorage();
const restoredAt = new Date().toISOString();
const manifestMarkets = {};
const allRows = [];
const seenIds = new Set();

for (const market of PUBLIC_CATALOG_MARKETS) {
  const expectedCount = Number(expectedCounts[market]);
  const chunkCount = Math.ceil(expectedCount / CATALOG_CHUNK_SIZE);
  const chunks = Array.from({ length: chunkCount }, (_, index) => chunkName(index + 1));
  const rows = [];
  for (const chunk of chunks) {
    const meta = await storage.readJsonWithMeta(offerPath(sourceGeneration, market, chunk), null);
    if (!meta.found || !Array.isArray(meta.value)) throw new Error(`catalog_restore_chunk_missing:${market}:${chunk}`);
    rows.push(...meta.value);
  }
  if (rows.length !== expectedCount) throw new Error(`catalog_restore_count_mismatch:${market}:${rows.length}:${expectedCount}`);
  for (const row of rows) {
    if (!row?.id || String(row.market || "") !== market || !row.make || !row.model || !Array.isArray(row.images) || row.images.length === 0) {
      throw new Error(`catalog_restore_row_invalid:${market}:${String(row?.id || "missing")}`);
    }
    if (seenIds.has(row.id)) throw new Error(`catalog_restore_duplicate_id:${row.id}`);
    seenIds.add(row.id);
  }
  manifestMarkets[market] = { count: rows.length, chunks, updatedAt: restoredAt };
  allRows.push(...rows);
}

if (allRows.length !== expectedTotal) throw new Error(`catalog_restore_total_mismatch:${allRows.length}:${expectedTotal}`);

const canonical = await previewCanonicalPublicCatalogOffers(allRows);
const canonicalCounts = Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [
  market,
  canonical.offers.filter((offer) => String(offer?.market || "") === market).length,
]));
if (canonical.offers.length !== expectedTotal) {
  throw new Error(`catalog_restore_canonical_total_mismatch:${canonical.offers.length}:${expectedTotal}`);
}
for (const market of PUBLIC_CATALOG_MARKETS) {
  if (canonicalCounts[market] !== Number(expectedCounts[market])) {
    throw new Error(`catalog_restore_canonical_market_mismatch:${market}:${canonicalCounts[market]}:${expectedCounts[market]}`);
  }
}

const makes = new Set(canonical.offers.map((offer) => String(offer?.make || "").trim()).filter(Boolean));
const forbiddenFound = [...forbiddenMakes].filter((make) => makes.has(make));
const requiredMissing = [...requiredMakes].filter((make) => !makes.has(make));
if (forbiddenFound.length) throw new Error(`catalog_restore_forbidden_makes:${forbiddenFound.join(",")}`);
if (requiredMissing.length) throw new Error(`catalog_restore_required_makes_missing:${requiredMissing.join(",")}`);

const indexMeta = await storage.readJsonWithMeta(`catalog/generations/${sourceGeneration}/indexes/offers-by-id.json`, null);
if (!indexMeta.found || !indexMeta.value?.byId || Object.keys(indexMeta.value.byId).length !== expectedTotal) {
  throw new Error(`catalog_restore_index_invalid:${Object.keys(indexMeta.value?.byId || {}).length}:${expectedTotal}`);
}

// This is the only mutable operation. All chunks, counts, canonical identity,
// unique IDs and generation indexes have already been verified above.
const currentMeta = await storage.readJsonWithMeta("catalog/manifest.json", null);
if (!currentMeta.found || !currentMeta.etag || !currentMeta.value?.generationId) throw new Error("catalog_restore_current_manifest_missing");
const manifest = { version: 2, generationId: sourceGeneration, updatedAt: restoredAt, markets: manifestMarkets };
await storage.writeJson("catalog/manifest.json", manifest, { ifMatch: currentMeta.etag });

const readModels = await publishCurrentCatalogReadModels();
if (readModels.generationId !== sourceGeneration || readModels.total !== expectedTotal) {
  throw new Error(`catalog_restore_read_models_mismatch:${readModels.generationId}:${readModels.total}:${sourceGeneration}:${expectedTotal}`);
}
for (const market of PUBLIC_CATALOG_MARKETS) {
  if (Number(readModels.markets?.[market] || 0) !== Number(expectedCounts[market])) {
    throw new Error(`catalog_restore_read_model_market_mismatch:${market}:${readModels.markets?.[market] || 0}:${expectedCounts[market]}`);
  }
}

const report = {
  version: 1,
  mode: "restore_verified_public_generation",
  restored: true,
  restoredAt,
  previousGeneration: currentMeta.value.generationId,
  generationId: sourceGeneration,
  total: expectedTotal,
  markets: expectedCounts,
  canonicalCounts,
  makeCount: makes.size,
  requiredMakes: [...requiredMakes],
  forbiddenMakesFound: forbiddenFound,
  readModels,
};
await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

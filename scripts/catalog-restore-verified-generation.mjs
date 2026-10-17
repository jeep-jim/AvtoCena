import fs from "node:fs/promises";
import crypto from "node:crypto";

const { getJsonStorage } = await import("../apps/web/lib/data.ts");
const {
  chunkName,
  offerPath,
  persistCatalogOffers,
  previewCanonicalPublicCatalogOffers,
  readAllOffersForMaintenance,
} = await import("../apps/web/lib/catalog/storage.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

const sourceGeneration = String(process.env.CATALOG_RESTORE_GENERATION || "gen_1787240511367_a8c268d3").trim();
const reportFile = String(process.env.CATALOG_RESTORE_REPORT || "catalog-restore-verified-generation-report.json").trim();
const expectedCounts = JSON.parse(process.env.CATALOG_RESTORE_EXPECTED_COUNTS_JSON
  || '{"korea":7553,"china":5673,"japan":1478,"uae":3171,"europe":5744,"georgia":2605}');
const expectedTotal = Number(process.env.CATALOG_RESTORE_EXPECTED_TOTAL || 26_224);
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
const allRows = [];
const seenIds = new Set();

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJsonValue(value[key])]));
  }
  return value;
}

function hashRows(rows) {
  return crypto.createHash("sha256").update(JSON.stringify(
    [...rows].sort((left, right) => String(left?.id || "").localeCompare(String(right?.id || ""))).map(stableJsonValue),
  )).digest("hex");
}

for (const market of PUBLIC_CATALOG_MARKETS) {
  const rows = [];
  const chunks = [];
  for (let index = 1; index <= 100; index++) {
    const chunk = chunkName(index);
    const meta = await storage.readJsonWithMeta(offerPath(sourceGeneration, market, chunk), null);
    if (!meta.found) break;
    if (!Array.isArray(meta.value)) throw new Error(`catalog_restore_chunk_invalid:${market}:${chunk}`);
    chunks.push(chunk);
    rows.push(...meta.value);
  }
  if (!chunks.length || !rows.length) throw new Error(`catalog_restore_market_missing:${market}`);
  for (const row of rows) {
    if (!row?.id || String(row.market || "") !== market || !row.make || !row.model || !Array.isArray(row.images) || row.images.length === 0) {
      throw new Error(`catalog_restore_row_invalid:${market}:${String(row?.id || "missing")}`);
    }
    if (seenIds.has(row.id)) throw new Error(`catalog_restore_duplicate_id:${row.id}`);
    seenIds.add(row.id);
  }
  allRows.push(...rows);
}

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
if (!indexMeta.found || !indexMeta.value?.byId || Object.keys(indexMeta.value.byId).length < expectedTotal) throw new Error("catalog_restore_index_invalid");

// Retain the complete maintenance state and add any verified public row that is
// absent from it. The exact canonical rows below are the only public input.
const maintenance = await readAllOffersForMaintenance();
if (!Array.isArray(maintenance)) throw new Error("catalog_restore_maintenance_invalid");
const combinedById = new Map();
for (const row of maintenance) if (row?.id) combinedById.set(row.id, row);
for (const row of canonical.offers) if (row?.id && !combinedById.has(row.id)) combinedById.set(row.id, row);

const preservedPublicOffersByMarket = Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [
  market,
  canonical.offers.filter((offer) => String(offer?.market || "") === market),
]));
const expectedHashes = Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [market, hashRows(preservedPublicOffersByMarket[market])]));
process.env.CATALOG_GROW_ONLY_MARKETS = "";
const manifest = await persistCatalogOffers([...combinedById.values()], {
  preservePublicOffersByMarket: preservedPublicOffersByMarket,
  beforePersistValidate(publicOffers) {
    const failures = [];
    for (const market of PUBLIC_CATALOG_MARKETS) {
      const rows = publicOffers.filter((offer) => String(offer?.market || "") === market);
      if (rows.length !== Number(expectedCounts[market])) failures.push(`${market}:count:${rows.length}:${expectedCounts[market]}`);
      if (hashRows(rows) !== expectedHashes[market]) failures.push(`${market}:hash`);
    }
    if (failures.length) throw new Error(`catalog_restore_prewrite_mismatch:${failures.join("|")}`);
  },
  beforePublishValidate(publishedOffers) {
    const failures = [];
    for (const market of PUBLIC_CATALOG_MARKETS) {
      const rows = publishedOffers.filter((offer) => String(offer?.market || "") === market);
      if (rows.length !== Number(expectedCounts[market])) failures.push(`${market}:count:${rows.length}:${expectedCounts[market]}`);
      if (hashRows(rows) !== expectedHashes[market]) failures.push(`${market}:hash`);
    }
    if (failures.length) throw new Error(`catalog_restore_public_mismatch:${failures.join("|")}`);
  },
});
for (const market of PUBLIC_CATALOG_MARKETS) {
  if (Number(manifest.markets?.[market]?.count || 0) !== Number(expectedCounts[market])) {
    throw new Error(`catalog_restore_manifest_market_mismatch:${market}:${manifest.markets?.[market]?.count || 0}:${expectedCounts[market]}`);
  }
}

const report = {
  version: 1,
  mode: "restore_verified_public_generation",
  restored: true,
  restoredAt,
  sourceGeneration,
  generationId: manifest.generationId,
  sourceStoredTotal: allRows.length,
  total: expectedTotal,
  markets: expectedCounts,
  canonicalCounts,
  makeCount: makes.size,
  requiredMakes: [...requiredMakes],
  forbiddenMakesFound: forbiddenFound,
  manifestMarkets: Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [market, manifest.markets?.[market]?.count || 0])),
};
await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

import fs from "node:fs/promises";

const { readAllOffersForMaintenance } = await import("../apps/web/lib/catalog/storage.ts");
const { readEncyclopediaIdentityResolver, readEncyclopediaIdentityDataset } = await import("../apps/web/lib/catalog/encyclopedia-identity-data.ts");
const { buildEncyclopediaIdentityReviewQueue } = await import("../apps/web/lib/catalog/encyclopedia-identity-review-queue.ts");

const OUTPUT = process.env.CATALOG_ENCYCLOPEDIA_IDENTITY_AUDIT_OUTPUT || "catalog-encyclopedia-identity-audit.json";
const SAMPLE_LIMIT = Math.max(10, Math.min(500, Number(process.env.CATALOG_ENCYCLOPEDIA_IDENTITY_SAMPLE_LIMIT || 100)));

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function increment(map, key, amount = 1) {
  map.set(key, Number(map.get(key) || 0) + amount);
}

function sortedCounts(map, limit = SAMPLE_LIMIT) {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key, "ru"))
    .slice(0, limit);
}

const dataset = await readEncyclopediaIdentityDataset();
const resolver = await readEncyclopediaIdentityResolver();
if (!dataset || !resolver) throw new Error("encyclopedia_identity_dataset_unavailable");

const offers = await readAllOffersForMaintenance();
const reviewQueue = buildEncyclopediaIdentityReviewQueue(resolver, offers, SAMPLE_LIMIT);
const rawMakes = new Set();
const canonicalMakes = new Set();
const rawModels = new Set();
const canonicalModels = new Set();
const unresolvedMakes = new Map();
const unresolvedModels = new Map();
const ambiguous = new Map();
const makeTransitions = new Map();
const modelTransitions = new Map();
const marketResolution = new Map();
const sourceResolution = new Map();
let brandResolved = 0;
let modelResolved = 0;
let fullyResolved = 0;

for (const offer of offers) {
  const rawMake = clean(offer?.make);
  const rawModel = clean(offer?.model);
  if (!rawMake) continue;
  if (rawModel) rawModels.add(`${rawMake}\u0000${rawModel}`);
  rawMakes.add(rawMake);

  const result = resolver.resolve({ make: rawMake, model: rawModel });
  if (result.brandId) {
    brandResolved++;
    canonicalMakes.add(result.canonicalMake);
    increment(makeTransitions, `${rawMake} → ${result.canonicalMake}`);
  } else {
    increment(unresolvedMakes, rawMake);
  }

  if (rawModel && result.modelId) {
    modelResolved++;
    canonicalModels.add(`${result.canonicalMake}\u0000${result.canonicalModel}`);
    increment(modelTransitions, `${rawMake} ${rawModel} → ${result.canonicalMake} ${result.canonicalModel}`);
  } else if (rawModel) {
    increment(unresolvedModels, `${result.canonicalMake || rawMake} ${rawModel}`);
  }

  if (result.brandId && (!rawModel || result.modelId)) fullyResolved++;
  if (result.ambiguous) increment(ambiguous, `${rawMake} ${rawModel}`.trim());

  const market = clean(offer?.market) || "unknown";
  const source = clean(offer?.sourceId) || "unknown";
  const marketRow = marketResolution.get(market) || { total: 0, brandResolved: 0, modelResolved: 0, fullyResolved: 0 };
  marketRow.total++;
  if (result.brandId) marketRow.brandResolved++;
  if (!rawModel || result.modelId) marketRow.modelResolved++;
  if (result.brandId && (!rawModel || result.modelId)) marketRow.fullyResolved++;
  marketResolution.set(market, marketRow);

  const sourceRow = sourceResolution.get(source) || { total: 0, brandResolved: 0, modelResolved: 0, fullyResolved: 0 };
  sourceRow.total++;
  if (result.brandId) sourceRow.brandResolved++;
  if (!rawModel || result.modelId) sourceRow.modelResolved++;
  if (result.brandId && (!rawModel || result.modelId)) sourceRow.fullyResolved++;
  sourceResolution.set(source, sourceRow);
}

function withRatios(entries) {
  return [...entries.entries()]
    .map(([key, row]) => ({
      key,
      ...row,
      brandResolutionRatio: row.total ? Number((row.brandResolved / row.total).toFixed(4)) : 0,
      modelResolutionRatio: row.total ? Number((row.modelResolved / row.total).toFixed(4)) : 0,
      fullResolutionRatio: row.total ? Number((row.fullyResolved / row.total).toFixed(4)) : 0,
    }))
    .sort((left, right) => right.total - left.total || left.key.localeCompare(right.key, "ru"));
}

const duplicateMakeTransitions = [...makeTransitions.entries()]
  .reduce((map, [transition, count]) => {
    const canonical = transition.split(" → ").at(-1);
    const list = map.get(canonical) || [];
    list.push({ transition, count });
    map.set(canonical, list);
    return map;
  }, new Map());
const duplicateMakeClusters = [...duplicateMakeTransitions.entries()]
  .map(([canonicalMake, rows]) => ({
    canonicalMake,
    rawSpellings: rows.length,
    offers: rows.reduce((sum, row) => sum + row.count, 0),
    rows: rows.sort((left, right) => right.count - left.count || left.transition.localeCompare(right.transition, "ru")),
  }))
  .filter((cluster) => cluster.rawSpellings > 1)
  .sort((left, right) => right.offers - left.offers || left.canonicalMake.localeCompare(right.canonicalMake, "ru"));

const report = {
  version: 2,
  mode: "shadow_read_only",
  auditedAt: new Date().toISOString(),
  encyclopedia: {
    productionConnected: Boolean(dataset.manifest.productionConnected),
    brands: dataset.brands.length,
    models: dataset.models.length,
    searchEntries: dataset.searchEntries.length,
    resolverCollisions: resolver.collisions.length,
  },
  catalog: {
    offers: offers.length,
    rawMakes: rawMakes.size,
    canonicalMakes: canonicalMakes.size,
    rawMakeModelPairs: rawModels.size,
    canonicalMakeModelPairs: canonicalModels.size,
  },
  resolution: {
    brandResolved,
    modelResolved,
    fullyResolved,
    brandResolutionRatio: offers.length ? Number((brandResolved / offers.length).toFixed(4)) : 0,
    fullResolutionRatio: offers.length ? Number((fullyResolved / offers.length).toFixed(4)) : 0,
    ambiguousOffers: [...ambiguous.values()].reduce((sum, count) => sum + count, 0),
  },
  duplicateMakeClusters: duplicateMakeClusters.slice(0, SAMPLE_LIMIT),
  unresolvedMakes: sortedCounts(unresolvedMakes),
  unresolvedModels: sortedCounts(unresolvedModels),
  ambiguous: sortedCounts(ambiguous),
  reviewQueue,
  topMakeTransitions: sortedCounts(makeTransitions),
  topModelTransitions: sortedCounts(modelTransitions),
  byMarket: withRatios(marketResolution),
  bySource: withRatios(sourceResolution),
  resolverCollisions: resolver.collisions.slice(0, SAMPLE_LIMIT),
};

await fs.writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

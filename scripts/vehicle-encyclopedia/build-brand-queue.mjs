import { readFile } from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_ROOT, loadWorkspace, normalizeTerm, readJson, writeJson } from "./lib.mjs";

const REPO_ROOT = path.resolve(WORKSPACE_ROOT, "../../..");
const LEGACY_ROOT = path.resolve(WORKSPACE_ROOT, "../vehicle-knowledge");
const CHECKPOINTS = {
  "checkpoint-02": [
    "Mercedes-Benz", "Volkswagen", "Honda", "Nissan", "Hyundai",
    "Kia", "Mazda", "Lexus", "Volvo", "Porsche",
    "Ford", "Chevrolet", "Tesla", "Chery", "Haval",
  ],
  "checkpoint-03": [
    "Abarth", "Acura", "AITO", "Alfa Romeo", "Aston Martin",
    "Avatr", "BAIC", "Baojun", "BAW", "Belgee",
    "Bentley", "Bestune", "Buick", "Cadillac", "Changan",
  ],
  "checkpoint-05": [
    "Chrysler", "Citroen", "Cupra", "Dacia", "Daihatsu",
    "Datsun", "Deepal", "Denza", "Dodge", "Dongfeng",
    "EXEED", "FAW", "Ferrari", "Fiat", "Genesis",
  ],
};
const ACTIVE_CHECKPOINT = "checkpoint-05";
const PRIORITY_BATCHES = {
  "mass-market-01": [
    "Toyota", "Honda", "Nissan", "Suzuki", "Mazda",
    "Subaru", "Mitsubishi", "Daihatsu", "Hyundai", "Kia",
    "Volkswagen", "Audi", "BMW", "Mercedes-Benz", "BYD",
  ],
  "mass-market-02": [
    "Lexus", "Genesis", "Geely", "Chery", "Haval",
    "Changan", "GAC", "Great Wall", "MG", "Renault",
    "Peugeot", "Citroen", "Skoda", "Opel", "Ford",
  ],
};
const ACTIVE_PRIORITY_BATCH = "mass-market-01";

function checkpointFor(brand) {
  return Object.entries(CHECKPOINTS).find(([, brands]) => brands.includes(brand))?.[0] || null;
}

async function readLegacyCollection(collection) {
  const index = await readJson(path.join(LEGACY_ROOT, `${collection}-index.json`));
  const chunks = await Promise.all(index.chunks.map((chunk) => readJson(path.join(LEGACY_ROOT, chunk.file))));
  return { index, rows: chunks.flat() };
}

function catalogBrands(source) {
  const body = source.match(/const DROM_BRAND_NAMES = \[([\s\S]*?)\] as const;/)?.[1];
  if (!body) throw new Error("DROM_BRAND_NAMES was not found in apps/web/lib/catalog/brands.ts");
  return [...body.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((match) => JSON.parse(`"${match[1]}"`));
}

function countsBy(rows, field) {
  const counts = new Map();
  for (const row of rows) {
    const key = normalizeTerm(row[field]);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function uniqueKey(row, fields) {
  return fields.map((field) => normalizeTerm(row[field])).join("|");
}

function legacyWindow(rows, yearFrom, yearTo) {
  const scoped = rows.filter((row) => {
    const from = Number.isFinite(row.yearFrom) ? row.yearFrom : row.yearTo;
    const to = Number.isFinite(row.yearTo) ? row.yearTo : row.yearFrom;
    return Number.isFinite(from) && Number.isFinite(to) && to >= yearFrom && from <= yearTo;
  });
  const configurationFields = [
    "make", "model", "generation", "yearFrom", "yearTo", "engineCc",
    "fuel", "transmission", "drive", "bodyType", "powertrainKind", "powerHp", "engineCode",
  ];
  return {
    yearFrom,
    yearTo,
    candidateVariants: scoped.length,
    uniqueCandidateConfigurations: new Set(scoped.map((row) => uniqueKey(row, configurationFields))).size,
    candidateBrands: new Set(scoped.map((row) => normalizeTerm(row.make))).size,
    candidateModels: new Set(scoped.map((row) => uniqueKey(row, ["make", "model"]))).size,
    candidateGenerations: new Set(scoped.map((row) => uniqueKey(row, ["make", "model", "generation"]))).size,
  };
}

const [brandsSource, legacyModels, legacyVariants, v2, manifest] = await Promise.all([
  readFile(path.join(REPO_ROOT, "apps/web/lib/catalog/brands.ts"), "utf8"),
  readLegacyCollection("models"),
  readLegacyCollection("variants"),
  loadWorkspace(),
  readJson(path.join(WORKSPACE_ROOT, "manifest.json")),
]);
const productionBrands = catalogBrands(brandsSource);
const modelCounts = countsBy(legacyModels.rows, "make");
const variantCounts = countsBy(legacyVariants.rows, "make");
const safeNames = (brand) => [brand.canonicalName, ...(brand.aliases || []).filter((alias) => alias.safe).map((alias) => alias.value)];
const v2ByName = new Map(v2.records.brand.flatMap((brand) => safeNames(brand).map((name) => [normalizeTerm(name), brand])));
const productionKeys = new Set(productionBrands.map(normalizeTerm));
const officialExpansionBrands = v2.records.brand
  .filter((brand) => !safeNames(brand).some((name) => productionKeys.has(normalizeTerm(name))))
  .sort((left, right) => left.canonicalName.localeCompare(right.canonicalName, "en"));
const completedBrands = new Set(manifest.completedBrands || []);
const priorityRank = new Map(Object.values(PRIORITY_BATCHES).flat().map((brand, index) => [normalizeTerm(brand), index + 1]));
const priorityBatch = new Map(Object.entries(PRIORITY_BATCHES).flatMap(([batch, brands]) => brands.map((brand) => [normalizeTerm(brand), batch])));

const denominatorBrands = [
  ...productionBrands.map((brand, index) => ({ brand, catalogPosition: index + 1, denominatorSource: "production-static-baseline" })),
  ...officialExpansionBrands.map((brand) => ({ brand: brand.canonicalName, catalogPosition: null, denominatorSource: "official-portfolio-expansion" })),
];

const queue = denominatorBrands.map(({ brand, catalogPosition, denominatorSource }) => {
  const key = normalizeTerm(brand);
  const v2Brand = v2ByName.get(key);
  return {
    catalogPosition,
    brand,
    canonicalBrand: v2Brand?.canonicalName || brand,
    denominatorSource,
    priorityRank: priorityRank.get(key) || null,
    priorityBatch: priorityBatch.get(key) || "long-tail",
    status: completedBrands.has(brand) || completedBrands.has(v2Brand?.canonicalName) ? "complete" : v2Brand ? "in-progress" : "queued",
    recordStatus: v2Brand?.status || null,
    v2BrandId: v2Brand?.id || null,
    legacyCandidateModels: modelCounts.get(key) || 0,
    legacyCandidateVariants: variantCounts.get(key) || 0,
    checkpoint: checkpointFor(brand),
  };
}).sort((left, right) => {
  const leftRank = left.priorityRank ?? Number.MAX_SAFE_INTEGER;
  const rightRank = right.priorityRank ?? Number.MAX_SAFE_INTEGER;
  const leftCatalog = left.catalogPosition ?? Number.MAX_SAFE_INTEGER;
  const rightCatalog = right.catalogPosition ?? Number.MAX_SAFE_INTEGER;
  return leftRank - rightRank || leftCatalog - rightCatalog || left.brand.localeCompare(right.brand, "en");
}).map((row, index) => ({ position: index + 1, ...row }));

const legacyInventory = {
  totalCandidateModels: legacyModels.index.total,
  totalCandidateVariants: legacyVariants.index.total,
  variantsWithoutProductionYears: legacyVariants.rows.filter((row) => !Number.isFinite(row.yearFrom) && !Number.isFinite(row.yearTo)).length,
  datedWindows: {
    japanPriorityProxy: legacyWindow(legacyVariants.rows, 2015, 2026),
    otherMarketsPriorityProxy: legacyWindow(legacyVariants.rows, 2020, 2026),
  },
  caveat: "Legacy rows are global research candidates, not a market-complete denominator. Market-specific totals require normalized live-listing make/model data and official model inventories.",
};

const report = {
  schemaVersion: 1,
  generatedFrom: [
    "apps/web/lib/catalog/brands.ts",
    "data/catalog/vehicle-knowledge/models-index.json",
    "data/catalog/vehicle-knowledge/variants-index.json",
    "vehicle-encyclopedia-v2 canonical chunks",
  ],
  productionModified: false,
  totals: {
    productionBrands: productionBrands.length,
    officialPortfolioExpansionBrands: officialExpansionBrands.length,
    denominatorBrands: queue.length,
    complete: queue.filter((row) => row.status === "complete").length,
    verifiedRecords: queue.filter((row) => row.recordStatus === "verified").length,
    inProgress: queue.filter((row) => row.status === "in-progress").length,
    queued: queue.filter((row) => row.status === "queued").length,
    legacyCandidateModels: legacyModels.index.total,
    legacyCandidateVariants: legacyVariants.index.total,
    canonicalModels: v2.records.model.length,
    canonicalGenerations: v2.records.generation.length,
    canonicalFacelifts: v2.records.facelift.length,
    canonicalVariants: v2.records.variant.length,
  },
  activeCheckpoint: ACTIVE_CHECKPOINT,
  nextCheckpoint: CHECKPOINTS[ACTIVE_CHECKPOINT],
  checkpoints: CHECKPOINTS,
  activePriorityBatch: ACTIVE_PRIORITY_BATCH,
  nextPriorityBrands: PRIORITY_BATCHES[ACTIVE_PRIORITY_BATCH],
  priorityBatches: PRIORITY_BATCHES,
  priorityPolicy: {
    first: "Models present in current market listings or causing calculation/name-resolution failures.",
    second: "High-volume passenger-car brands in the approved year windows.",
    later: "Low-volume, exotic and heritage brands retained for long-tail matching and SEO.",
    liveFrequencyAvailableInRepository: false,
  },
  coverageWindows: manifest.coverageWindows,
  brandRegistryExpansion: officialExpansionBrands.map((brand) => ({ brandId: brand.id, brand: brand.canonicalName, source: "official-portfolio-expansion" })),
  legacyInventory,
  rule: "Legacy counts are research-queue candidates only and are never treated as proven V2 facts.",
  queue,
};

await writeJson(path.join(WORKSPACE_ROOT, "reports/brand-queue.json"), report);
console.log(JSON.stringify({ built: true, ...report.totals, activeCheckpoint: ACTIVE_CHECKPOINT, checkpointBrands: CHECKPOINTS[ACTIVE_CHECKPOINT].length }, null, 2));

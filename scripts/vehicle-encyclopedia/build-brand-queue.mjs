import { readFile } from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_ROOT, loadWorkspace, readJson, writeJson } from "./lib.mjs";

const REPO_ROOT = path.resolve(WORKSPACE_ROOT, "../../..");
const LEGACY_ROOT = path.resolve(WORKSPACE_ROOT, "../vehicle-knowledge");
const NEXT_CHECKPOINT = [
  "Mercedes-Benz", "Volkswagen", "Honda", "Nissan", "Hyundai",
  "Kia", "Mazda", "Lexus", "Volvo", "Porsche",
  "Ford", "Chevrolet", "Tesla", "Chery", "Haval",
];

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
    const key = String(row[field] || "").trim();
    if (key) counts.set(key.toLocaleLowerCase("en"), (counts.get(key.toLocaleLowerCase("en")) || 0) + 1);
  }
  return counts;
}

const [brandsSource, legacyModels, legacyVariants, v2] = await Promise.all([
  readFile(path.join(REPO_ROOT, "apps/web/lib/catalog/brands.ts"), "utf8"),
  readLegacyCollection("models"),
  readLegacyCollection("variants"),
  loadWorkspace(),
]);
const productionBrands = catalogBrands(brandsSource);
const modelCounts = countsBy(legacyModels.rows, "make");
const variantCounts = countsBy(legacyVariants.rows, "make");
const v2ByName = new Map(v2.records.brand.map((brand) => [brand.canonicalName.toLocaleLowerCase("en"), brand]));

const queue = productionBrands.map((brand, index) => {
  const key = brand.toLocaleLowerCase("en");
  const v2Brand = v2ByName.get(key);
  return {
    position: index + 1,
    brand,
    status: v2Brand?.status === "verified" ? "verified" : v2Brand ? "in-progress" : "queued",
    v2BrandId: v2Brand?.id || null,
    legacyCandidateModels: modelCounts.get(key) || 0,
    legacyCandidateVariants: variantCounts.get(key) || 0,
    checkpoint: NEXT_CHECKPOINT.includes(brand) ? "checkpoint-02" : null,
  };
});

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
    verified: queue.filter((row) => row.status === "verified").length,
    inProgress: queue.filter((row) => row.status === "in-progress").length,
    queued: queue.filter((row) => row.status === "queued").length,
    legacyCandidateModels: legacyModels.index.total,
    legacyCandidateVariants: legacyVariants.index.total,
  },
  nextCheckpoint: NEXT_CHECKPOINT,
  rule: "Legacy counts are research-queue candidates only and are never treated as proven V2 facts.",
  queue,
};

await writeJson(path.join(WORKSPACE_ROOT, "reports/brand-queue.json"), report);
console.log(JSON.stringify({ built: true, ...report.totals, checkpointBrands: NEXT_CHECKPOINT.length }, null, 2));

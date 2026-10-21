import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateJsonSchema } from "../../scripts/vehicle-encyclopedia/contract.mjs";
import { readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";
import { validateWorkspace } from "../../scripts/vehicle-encyclopedia/validate.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("canonical checkpoint satisfies JSON Schema and semantic validation", async () => {
  const result = await validateWorkspace({ root: DATA_ROOT });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.reports.coverage.totals, {
    source: 928,
    brand: 255,
    model: 1619,
    generation: 1293,
    facelift: 105,
    variant: 19240,
    media: 449,
  });
});

test("localized brand spellings cannot replace the public English canonical identity", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "avtocena-encyclopedia-canonical-brand-"));
  await cp(DATA_ROOT, temporaryRoot, { recursive: true });
  const brandsFile = path.join(temporaryRoot, "chunks/brands-0001.json");
  const brands = JSON.parse(await readFile(brandsFile, "utf8"));
  brands.records.find((brand) => brand.id === "changan").canonicalName = "长安";
  await writeFile(brandsFile, `${JSON.stringify(brands, null, 2)}\n`);
  const result = await validateWorkspace({ root: temporaryRoot });
  assert.ok(result.errors.some((error) => error.code === "brand.canonical_non_public_script" && error.entityId === "changan"));
});

test("review models may defer publication fields, while seed models may not", async () => {
  const schema = await readJson(path.join(DATA_ROOT, "schema/entity-chunk.schema.json"));
  const review = {
    schemaVersion: 2,
    entityType: "model",
    chunk: 1,
    maxRecords: 250,
    records: [{
      id: "test/review-model",
      brandId: "test",
      canonicalName: "Review Model",
      slug: "review-model",
      aliases: [],
      sourceNames: [],
      productionFrom: null,
      productionTo: null,
      bodyTypes: [],
      powertrainKinds: [],
      mediaIds: [],
      status: "review",
      evidence: [{ sourceId: "test/source", fields: ["canonicalName"], status: "verified", confidence: "high" }],
      updatedAt: "2026-08-17",
    }],
  };
  assert.deepEqual(validateJsonSchema(review, schema), []);
  review.records[0].status = "seed";
  const errors = validateJsonSchema(review, schema);
  assert.equal(errors.filter((error) => error.keyword === "minItems").length, 3);
});

test("strict chunk contract rejects unknown fields and chunks above 250 records", async () => {
  const schema = await readJson(path.join(DATA_ROOT, "schema/entity-chunk.schema.json"));
  const invalid = {
    schemaVersion: 2,
    entityType: "brand",
    chunk: 1,
    maxRecords: 250,
    records: Array.from({ length: 251 }, (_, index) => ({
      id: `brand-${index}`,
      canonicalName: `Brand ${index}`,
      slug: `brand-${index}`,
      aliases: [],
      countries: ["Test"],
      status: "seed",
      evidence: [],
      updatedAt: "2026-08-15",
      unexpected: true,
    })),
  };
  const errors = validateJsonSchema(invalid, schema);
  assert(errors.some((error) => error.keyword === "maxItems"));
  assert(errors.some((error) => error.keyword === "additionalProperties" && error.path.endsWith("/unexpected")));
});

test("30-minute power is rejected without an exact eligible source", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "avtocena-encyclopedia-"));
  await cp(DATA_ROOT, temporaryRoot, { recursive: true });
  const chunkFiles = await readdir(path.join(temporaryRoot, "chunks"));
  let variantsFile;
  let sourcesFile;
  for (const file of chunkFiles) {
    if (!file.startsWith("variants-") && !file.startsWith("sources-")) continue;
    const absolute = path.join(temporaryRoot, "chunks", file);
    const chunk = JSON.parse(await readFile(absolute, "utf8"));
    if (chunk.records.some((variant) => variant.id === "audi/q6-e-tron/2024/performance-eu")) variantsFile = absolute;
    if (chunk.records.some((source) => source.id === "src-audi-q6-technical-2024")) sourcesFile = absolute;
  }
  assert(variantsFile);
  assert(sourcesFile);
  const variants = JSON.parse(await readFile(variantsFile, "utf8"));
  const sources = JSON.parse(await readFile(sourcesFile, "utf8"));
  const q6 = variants.records.find((variant) => variant.id === "audi/q6-e-tron/2024/performance-eu");
  q6.power30MinKw = 100;
  q6.evidence[0].fields.push("power30MinKw");
  sources.records.find((source) => source.id === "src-audi-q6-technical-2024").supportedFields.push("power30MinKw");
  sources.records.find((source) => source.id === "src-audi-q6-technical-2024").type = "manufacturer";
  await writeFile(variantsFile, `${JSON.stringify(variants, null, 2)}\n`);
  await writeFile(sourcesFile, `${JSON.stringify(sources, null, 2)}\n`);
  const result = await validateWorkspace({ root: temporaryRoot });
  assert(result.errors.some((error) => error.code === "power30min.ineligible_source"));
});

test("identity seeds may defer country, but verified brands may not", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "avtocena-encyclopedia-country-"));
  await cp(DATA_ROOT, temporaryRoot, { recursive: true });
  const brandsFile = path.join(temporaryRoot, "chunks/brands-0001.json");
  const brands = JSON.parse(await readFile(brandsFile, "utf8"));
  const ac = brands.records.find((brand) => brand.id === "ac-cars");
  assert.deepEqual(ac.countries, []);
  ac.status = "verified";
  await writeFile(brandsFile, `${JSON.stringify(brands, null, 2)}\n`);
  const result = await validateWorkspace({ root: temporaryRoot });
  assert(result.errors.some((error) => error.code === "brand.country_missing" && error.entityId === "ac-cars"));
});

test("report generation is deterministic and remains staging-only", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "avtocena-encyclopedia-reports-"));
  await cp(DATA_ROOT, temporaryRoot, { recursive: true });
  const result = await validateWorkspace({ root: temporaryRoot, writeReports: true });
  assert.deepEqual(result.errors, []);
  const coverage = await readJson(path.join(temporaryRoot, "reports/coverage.json"));
  const manifest = await readJson(path.join(temporaryRoot, "manifest.json"));
  assert.equal(coverage.productionConnected, false);
  assert.equal(manifest.productionConnected, false);
  assert.equal(manifest.status, "checkpoint-seed");
  assert.equal(coverage.byBrand.length, 255);
  assert.deepEqual(manifest.verifiedBrands, ["Audi", "BMW", "BYD", "Daihatsu", "Geely", "Mitsubishi", "Subaru", "Suzuki", "Toyota"]);
  assert.deepEqual(manifest.completedBrands, []);
  assert.equal(manifest.inProgressBrands.length, 255);
  assert.equal(new Set(manifest.inProgressBrands).size, 255);
  assert.deepEqual(
    manifest.inProgressBrands.toSorted((left, right) => left.localeCompare(right, "en")),
    coverage.byBrand.map((row) => row.brand).toSorted((left, right) => left.localeCompare(right, "en")),
  );
});

import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
    source: 128,
    brand: 35,
    model: 35,
    generation: 35,
    facelift: 2,
    variant: 35,
    media: 35,
  });
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
  const variantsFile = path.join(temporaryRoot, "chunks/variants-0001.json");
  const sourcesFile = path.join(temporaryRoot, "chunks/sources-0001.json");
  const variants = JSON.parse(await readFile(variantsFile, "utf8"));
  const sources = JSON.parse(await readFile(sourcesFile, "utf8"));
  variants.records[0].power30MinKw = 100;
  variants.records[0].evidence[0].fields.push("power30MinKw");
  sources.records.find((source) => source.id === "src-audi-q6-technical-2024").supportedFields.push("power30MinKw");
  sources.records.find((source) => source.id === "src-audi-q6-technical-2024").type = "manufacturer";
  await writeFile(variantsFile, `${JSON.stringify(variants, null, 2)}\n`);
  await writeFile(sourcesFile, `${JSON.stringify(sources, null, 2)}\n`);
  const result = await validateWorkspace({ root: temporaryRoot });
  assert(result.errors.some((error) => error.code === "power30min.ineligible_source"));
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
  assert.equal(coverage.byBrand.length, 35);
  assert.deepEqual(manifest.completedBrands, ["Audi", "BMW", "Toyota", "BYD", "Geely"]);
  assert.deepEqual(manifest.inProgressBrands, ["Mercedes-Benz", "Volkswagen", "Honda", "Nissan", "Hyundai", "Kia", "Mazda", "Lexus", "Volvo", "Porsche", "Ford", "Chevrolet", "Tesla", "Chery", "Haval", "Abarth", "Acura", "Alfa Romeo", "Aston Martin", "Bentley", "AITO", "Avatr", "BAIC", "Baojun", "BAW", "Belgee", "Bestune", "Buick", "Cadillac", "Changan"]);
});

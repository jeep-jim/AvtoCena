import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { prepareIngestion } from "../../scripts/vehicle-encyclopedia/ingest.mjs";
import { readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

async function inputFile(value) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "avtocena-encyclopedia-input-"));
  const file = path.join(directory, "batch.json");
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

test("ingestion is a validated dry run and preserves totals for an empty batch", async () => {
  const prepared = await prepareIngestion({ inputFile: path.join(DATA_ROOT, "ingest/_template.json"), root: DATA_ROOT });
  assert.equal(prepared.valid, true);
  assert.deepEqual(prepared.changedTypes, ["source"]);
  assert.equal(prepared.totals.source, 91);
});

test("ingestion refuses a silent replacement of an existing ID", async () => {
  const sourceChunk = await readJson(path.join(DATA_ROOT, "chunks/sources-0001.json"));
  const file = await inputFile({ schemaVersion: 2, batches: [{ ...sourceChunk, records: [sourceChunk.records[0]] }] });
  const prepared = await prepareIngestion({ inputFile: file, root: DATA_ROOT });
  assert.equal(prepared.valid, false);
  assert(prepared.errors.some((error) => error.code === "ingest.existing_id"));
});

test("legacy preview is review-only and excludes seed and kW-only entities", async () => {
  const previewRoot = path.join(DATA_ROOT, "generated/legacy-bridge-preview");
  const report = await readJson(path.join(previewRoot, "report.json"));
  const variants = await readJson(path.join(previewRoot, "variants.json"));
  assert.equal(report.productionModified, false);
  assert.equal(report.legacyBaseline.models, 4899);
  assert.equal(report.legacyBaseline.variants, 15735);
  assert.equal(variants.length, 2);
  assert.equal(report.excludedModels.length, 20);
  assert.equal(report.excludedVariants.length, 23);
  assert.equal(report.excludedVariants.filter((row) => row.reason === "entity_status_not_verified").length, 20);
  assert.equal(report.excludedVariants.filter((row) => row.reason.includes("powerHp")).length, 3);
});

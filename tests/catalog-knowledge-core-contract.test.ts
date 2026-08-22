import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const core = fs.readFileSync("apps/web/lib/catalog/knowledge-core.ts", "utf8");
const storage = fs.readFileSync("apps/web/lib/catalog/storage.ts", "utf8");
const identityMaster = fs.readFileSync("scripts/catalog-apply-encyclopedia-identity-master.mjs", "utf8");
const workflow = fs.readFileSync(".github/workflows/catalog-v3-market-10k-reusable.yml", "utf8");
const manifest = fs.readFileSync("data/catalog/vehicle-encyclopedia-v2/manifest.json", "utf8");

test("Knowledge CORE is the catalog enrichment entrypoint", () => {
  assert.match(core, /export async function enrichOfferWithKnowledgeCore/);
  assert.match(core, /vehicle-encyclopedia-v2/);
  assert.match(core, /Legacy knowledge is now a compatibility fallback behind one CORE API/);
  assert.match(core, /fieldTrusted/);
  assert.match(core, /sourcePowerAuthoritative/);
  assert.match(core, /power30MinKw/);
  assert.match(storage, /enrichOfferWithKnowledgeCore/);
  assert.doesNotMatch(storage, /enrichOfferWithVehicleKnowledge\(/);
  assert.match(identityMaster, /enrichOfferWithKnowledgeCore/);
});

test("Knowledge CORE coverage follows market year contract", () => {
  const parsed = JSON.parse(manifest);
  const japan = parsed.coverageWindows.find((row: any) => row.marketId === "japan");
  const others = parsed.coverageWindows.find((row: any) => Array.isArray(row.marketIds));
  assert.equal(parsed.targetYearFrom, 2010);
  assert.equal(japan?.yearFrom, 2010);
  assert.equal(others?.yearFrom, 2020);
});

test("Every market publish emits a live knowledge-gap report", () => {
  assert.match(workflow, /Build Knowledge CORE gap report/);
  assert.match(workflow, /catalog-build-knowledge-gaps\.mjs/);
  assert.match(workflow, /catalog-v3-\$\{\{ inputs\.market \}\}-knowledge-gaps\.json/);
  assert.match(workflow, /Verify offer detail read models/);
});

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../../scripts/vehicle-encyclopedia/lib.mjs";
import { buildSearchIndex, resolveSearch } from "../../scripts/vehicle-encyclopedia/search.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");
const index = buildSearchIndex(await loadWorkspace(DATA_ROOT));

test("canonical make/model and official short name resolve to Audi Q6", () => {
  assert.equal(resolveSearch(index, "Audi Q6 SUV e-tron").resolved?.entry.entityId, "audi/q6-e-tron");
  assert.equal(resolveSearch(index, "Q6 e-tron", { make: "Audi" }).resolved?.entry.entityId, "audi/q6-e-tron");
});

test("localized names resolve only when backed by an explicit source", () => {
  assert.equal(resolveSearch(index, "宝马i4").resolved?.entry.entityId, "bmw/i4");
  assert.equal(resolveSearch(index, "BYD・シール").resolved?.entry.entityId, "byd/seal");
  assert.equal(resolveSearch(index, "비야디 씰").resolved?.entry.entityId, "byd/seal");
  assert.equal(resolveSearch(index, "아우디 Q6 e-트론").resolved?.entry.entityId, "audi/q6-e-tron");
});

test("platform codes preserve model context", () => {
  const result = resolveSearch(index, "G26", { make: "BMW" });
  assert.equal(result.resolved?.entry.entityType, "generation");
  assert.equal(result.resolved?.entry.modelId, "bmw/i4");
});

test("unknown and ambiguous exact terms are not auto-resolved", () => {
  assert.equal(resolveSearch(index, "not-a-real-model").resolved, null);
  const ambiguousIndex = {
    schemaVersion: 2,
    collisions: [],
    entries: [
      { entityType: "model", entityId: "brand/alpha", brandId: "brand", modelId: "brand/alpha", term: "Twin", key: "twin", kind: "canonical", safe: true, sourceIds: ["one"] },
      { entityType: "model", entityId: "brand/beta", brandId: "brand", modelId: "brand/beta", term: "Twin", key: "twin", kind: "canonical", safe: true, sourceIds: ["two"] },
    ],
  };
  const result = resolveSearch(ambiguousIndex, "Twin");
  assert.equal(result.ambiguous, true);
  assert.equal(result.resolved, null);
});

test("pilot aliases contain no safe collision", () => {
  assert.deepEqual(index.collisions, []);
});

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";
import { buildSearchIndex, resolveSearch } from "../../scripts/vehicle-encyclopedia/search.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("current Chinese Wuling edition titles point to one English canonical model", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/wuling-current-edition-aliases.json")),
  ]);
  const index = buildSearchIndex(workspace);
  assert.deepEqual(report.totals, { replacedModels: 3, newAliases: 4 });

  const cases = [
    ["五菱 宏光纯电版", "wuling/hongguang", "Hongguang"],
    ["五菱 宏光增程版", "wuling/hongguang", "Hongguang"],
    ["五菱 缤果SUV五座版", "wuling/bingo-plus", "Bingo Plus"],
    ["五菱 之光EV", "wuling/zhiguang", "Zhiguang"],
  ];
  for (const [query, entityId, canonicalModel] of cases) {
    const result = resolveSearch(index, query);
    assert.equal(result.resolved, null);
    assert.equal(result.ambiguous, false);
    assert.equal(result.matches[0]?.entry.entityId, entityId);
    assert.equal(result.matches[0]?.canonical.canonicalModel, canonicalModel);
    assert.equal(result.matches[0]?.entry.safe, false);
  }
});

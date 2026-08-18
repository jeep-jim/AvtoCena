import assert from "node:assert/strict";
import test from "node:test";
import { buildJapanPriorityModelIdentityDecisions } from "../../scripts/vehicle-encyclopedia/build-japan-priority-model-identity-decisions.mjs";

test("Japan priority registry residue is classified without inventing models", async () => {
  const report = await buildJapanPriorityModelIdentityDecisions();
  assert.equal(report.totals.priorityBrands, 8);
  assert.equal(report.totals.residualSourceNames, 22);
  assert.equal(report.totals.acceptedAsNewModels, 0);
  assert.deepEqual(report.brandsWithNoResidualSourceNames, ["nissan", "suzuki", "subaru", "daihatsu"]);
  assert.equal(report.totals.decisionsByDisposition.combined_models, 10);
  assert.equal(report.totals.decisionsByDisposition.grade_or_derivative, 8);
  assert.equal(report.decisions.some((row) => row.sourceName === "リューション" && row.disposition === "fragment_noise"), true);
});

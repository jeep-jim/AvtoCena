import assert from "node:assert/strict";
import test from "node:test";
import { buildMlitJapanIdentityCoverage } from "../../scripts/vehicle-encyclopedia/build-mlit-japan-identity-coverage.mjs";

test("every Japan 2015-2026 MLIT source name has one mapped model or an explicit rejection", async () => {
  const report = await buildMlitJapanIdentityCoverage();
  assert.equal(report.totals.candidateRows, 1341);
  assert.equal(report.totals.sourceNames, 1479);
  assert.equal(report.totals.mapped, 1446);
  assert.equal(report.totals.rejected, 33);
  assert.equal(report.totals.ambiguous, 0);
  assert.equal(report.totals.unresolved, 0);
  assert.equal(report.totals.decisionCoveragePercent, 100);
});

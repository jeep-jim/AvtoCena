import assert from "node:assert/strict";
import test from "node:test";
import { buildEeaReviewedModelAliasBatch01 } from "../../scripts/vehicle-encyclopedia/build-eea-reviewed-model-alias-batch-01.mjs";
import { buildEeaReviewedModelIdentityBatch02 } from "../../scripts/vehicle-encyclopedia/build-eea-reviewed-model-identity-batch-02.mjs";

test("reviewed EEA rules cover the registration mass without ambiguous model targets", async () => {
  const { report } = await buildEeaReviewedModelAliasBatch01();
  assert.deepEqual(report.totals, {
    sourceRows: 5604,
    accepted: 2793,
    rejected: 60,
    ambiguous: 0,
    unresolved: 2751,
    updatedModels: 222,
    sourceRegistrations: 1970630,
    acceptedRegistrations: 1606884,
    rejectedRegistrations: 334388,
    ambiguousRegistrations: 0,
    unresolvedRegistrations: 29358,
    decidedRegistrationPercent: 98.51,
  });
  assert.equal(report.ambiguous.length, 0);
  assert(report.accepted.every((row) => row.targetCanonicalName));
});

test("new EEA identities remain review-only and source-backed", async () => {
  const { report } = await buildEeaReviewedModelIdentityBatch02();
  assert.equal(report.totals.reviewedDefinitions, 50);
  assert.equal(report.totals.registrations, 52955);
  assert.equal(report.productionConnected, false);
  assert(report.reviewed.some((row) => row.modelId === "nissan/nv300" && row.registrations === 5216));
  assert(report.reviewed.some((row) => row.modelId === "mg-motor/rx6" && row.registrations === 6144));
});

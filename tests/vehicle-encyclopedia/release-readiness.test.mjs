import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildReleaseReadiness } from "../../scripts/vehicle-encyclopedia/build-release-readiness.mjs";
import { readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("release report remains exact, evidence-led and disconnected from production", async () => {
  const [built, stored] = await Promise.all([
    buildReleaseReadiness(),
    readJson(path.join(DATA_ROOT, "reports/release-readiness.json")),
  ]);
  assert.deepEqual(stored, built);
  assert.equal(stored.productionConnected, false);
  assert.equal(stored.releaseReady, false);
  assert.equal(stored.completionClaimAllowed, false);
  assert.deepEqual(stored.totals, {
    source: 928,
    brand: 255,
    model: 1619,
    generation: 1293,
    facelift: 105,
    variant: 19240,
    media: 449,
  });
  assert.equal(stored.quality.validationErrors, 0);
  assert.equal(stored.quality.safeAliasCollisions, 0);
  assert.equal(stored.quality.sourceConflicts, 0);
  assert.equal(stored.logos.technicalPairsReady, 195);
  assert.equal(stored.logos.missingTechnicalPairs, 60);
  assert.equal(stored.logos.publicationApprovedPairs, 0);
  assert.equal(stored.logos.publicationReadyBrands, 0);
  assert.equal(stored.media.modelsWithApprovedCanonicalCover, 59);
  assert.equal(stored.media.modelsMissingApprovedCanonicalCover, 1560);
  assert.equal(stored.status.model.review, 1560);
  assert.equal(stored.status.variant.review, 18941);
  assert.equal(stored.variantFieldCoverage.power30MinKw.count, 0);
  assert(stored.releaseBlockers.length >= 5);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const script = fs.readFileSync("scripts/catalog-live-recovery-direct-exact.mjs", "utf8");
const workflow = fs.readFileSync(".github/workflows/catalog-live-recovery-uae-georgia-direct.yml", "utf8");

test("direct UAE and Georgia recovery keeps only exact or explicit preliminary-power calculations", () => {
  assert.match(script, /calculateOfferWithPreliminaryPowerPricing/);
  assert.match(script, /isPreliminaryPowerPendingCalculation/);
  assert.match(script, /if \(!exactCalculation\(calculated\) && !preliminaryPowerPending\)/);
  assert.match(script, /recoveryPreliminaryPowerPending: preliminaryPowerPending/);
  assert.match(script, /preliminaryCount: offers\.filter\(isPreliminaryPowerPendingCalculation\)\.length/);
  assert.doesNotMatch(script, /calculateOfferWithRussiaCustoms\(offer\)/);
});

test("direct recovery has enough crawl budget to grow the two sparse markets", () => {
  assert.match(workflow, /RECOVERY_TARGET: "3000"/);
  assert.match(workflow, /RECOVERY_MAX_PAGES: "300"/);
  assert.match(workflow, /RECOVERY_TIME_LIMIT_MS: "5100000"/);
  assert.match(workflow, /timeout-minutes: 95/);
  assert.match(workflow, /CATALOG_MAX_IMAGES_PER_OFFER: "30"/);
  assert.match(workflow, /RECOVERY_PUBLISH_MAX: "5000"/);
  assert.match(workflow, /CATALOG_MAX_OFFERS_PER_MODEL: "20"/);
});

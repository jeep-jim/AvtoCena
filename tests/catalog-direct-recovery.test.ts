import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const script = fs.readFileSync("scripts/catalog-live-recovery-direct-exact.mjs", "utf8");
const workflow = fs.readFileSync(".github/workflows/catalog-live-recovery-uae-georgia-direct.yml", "utf8");
const requiredSources = fs.readFileSync("apps/web/lib/catalog/required-catalog-sources.ts", "utf8");

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

test("Georgia direct recovery tries company anchor sites before AUTO.GE fallback", () => {
  assert.match(requiredSources, /sourceId: "myauto_georgia_list"[\s\S]*canonicalUrl: "https:\/\/www\.myauto\.ge\/"[\s\S]*required: true[\s\S]*anchor: true/);
  assert.match(requiredSources, /sourceId: "autopapa_georgia_open"[\s\S]*canonicalUrl: "https:\/\/autopapa\.ge\/"[\s\S]*required: true[\s\S]*anchor: true/);
  assert.match(workflow, /RECOVERY_SOURCE_IDS="myauto_georgia_list,autopapa_georgia_open"/);
  assert.match(workflow, /canonical_unavailable=.*stopReason==='source_error'/);
  assert.match(workflow, /elif \[ "\$canonical_unavailable" = "1" \]/);
  assert.match(workflow, /fallbackSourceId: 'auto_georgia_open'/);
  assert.match(workflow, /fallbackReason: 'both_canonical_sources_unavailable'/);
  assert.match(workflow, /fallbackReason: 'canonical_source_available_but_zero_publishable_rows'/);
  assert.match(workflow, /usedFallback: false/);
  assert.match(workflow, /usedFallback: true/);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { catalogMinYearForMarket, isCatalogYearAllowed } from "../apps/web/lib/catalog/offer-quality";

test("production year gates keep Japan rolling and every other market at 2020+", () => {
  assert.equal(catalogMinYearForMarket("japan"), new Date().getFullYear() - 15);
  for (const market of ["korea", "china", "uae", "europe", "georgia", "kyrgyzstan"]) {
    assert.equal(catalogMinYearForMarket(market), 2020, market);
    assert.equal(isCatalogYearAllowed(2019, market), false, market);
    assert.equal(isCatalogYearAllowed(2020, market), true, market);
  }
});

test("daily market writer publishes Georgia and repairs only old K Car gallery order", () => {
  const workflow = fs.readFileSync(".github/workflows/catalog-live-daily-working-markets.yml", "utf8");
  assert.match(workflow, /for market in korea china europe georgia/);
  assert.match(workflow, /CATALOG_AUDIT_ASSERT_MARKETS: korea,china,europe,georgia/);
  assert.match(workflow, /CATALOG_GALLERY_SOURCE_IDS: kcar_korea_open/);
  assert.match(workflow, /CATALOG_GALLERY_MAX_OFFERS: "500"/);
  assert.match(workflow, /continue-on-error: true/);
  assert.match(workflow, /if: always\(\) && needs\.validate\.result == 'success'/);

  const refresh = fs.readFileSync("scripts/catalog-refresh-galleries.mjs", "utf8");
  assert.match(refresh, /needsSourceOrderedGalleryRefresh\(offer\)/);
  assert.doesNotMatch(refresh, /const reportedOfferIds/);
});

test("Japan scale collection goes deeper and publishes in the shared single-writer lane", () => {
  const workflow = fs.readFileSync(".github/workflows/catalog-v6-prestige-up-to-30k.yml", "utf8");
  assert.match(workflow, /PRESTIGE_PLAN_RAW_PER_MODEL: "200"/);
  assert.match(workflow, /max-parallel: 6/);
  assert.match(workflow, /group: catalog-live-daily-working-markets/);
  assert.match(workflow, /CATALOG_MAX_OFFERS_PER_MODEL: "100"/);
  assert.match(workflow, /RECOVERY_PUBLISH_MAX: "30000"/);

  const merge = fs.readFileSync("scripts/prestige-japan-strict-merge.mjs", "utf8");
  assert.match(merge, /warnings\.push\(`chunk_incomplete_/);
  assert.match(merge, /const passed = errors\.length === 0 && outputOffers\.length > 0/);

  const verifiedPublish = fs.readFileSync(".github/workflows/catalog-japan-publish-verified-aggregate.yml", "utf8");
  assert.match(verifiedPublish, /PRESTIGE_AGGREGATE_MIN_COUNT: "5000"/);
  assert.match(verifiedPublish, /prestige-japan-aggregate-salvage\.mjs/);
  assert.match(verifiedPublish, /group: catalog-live-daily-working-markets/);
  assert.match(verifiedPublish, /"japan":5000/);
});

test("certified 30-minute power is applied automatically without accepting peak power", () => {
  const workflow = fs.readFileSync(".github/workflows/catalog-certified-power-apply.yml", "utf8");
  assert.match(workflow, /CATALOG_CERTIFIED_POWER_APPLY: "1"/);
  assert.match(workflow, /group: catalog-live-daily-working-markets/);
  assert.match(workflow, /catalog-certified-power-reference\.test\.ts/);
  assert.match(workflow, /catalog-build-certified-power-queue\.mjs/);
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /Catalog live recovery · UAE \+ Kyrgyzstan/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);

  const strictMerge = fs.readFileSync("scripts/catalog-japan-strict-merge-publish.mjs", "utf8");
  assert.match(strictMerge, /isCatalogYearAllowed\(offer\.year, market\)/);
  assert.match(strictMerge, /hasCredibleOfferContent\(offer\)/);
  assert.match(strictMerge, /japan_strict_preflight_below_min/);

  const strictWorkflow = fs.readFileSync(".github/workflows/catalog-japan-strict-merge-publish.yml", "utf8");
  assert.match(strictWorkflow, /JAPAN_STRICT_MIN_PUBLISH_COUNT: "193"/);
  assert.doesNotMatch(strictWorkflow, /SOURCE_RUN_ID: "\d+"/);
});

test("emergency Japan recovery restores a verified generation before the remaining writers", () => {
  const recovery = fs.readFileSync(".github/workflows/catalog-emergency-restore-japan.yml", "utf8");
  assert.match(recovery, /CATALOG_RECOVERY_GENERATIONS: "gen_1786426826475_e390aa80"/);
  assert.match(recovery, /CATALOG_RECOVERY_MARKETS: "korea,china,japan,uae,europe,georgia,kyrgyzstan"/);
  assert.match(recovery, /group: catalog-live-daily-working-markets/);
  assert.match(recovery, /CATALOG_AUDIT_ASSERT_MARKETS: japan/);

  const markets = fs.readFileSync(".github/workflows/catalog-live-recovery-uae-kyrgyzstan.yml", "utf8");
  assert.match(markets, /Catalog emergency · restore Japan baseline/);
  assert.match(markets, /github\.event\.workflow_run\.conclusion == 'success'/);

  const script = fs.readFileSync("scripts/catalog-recover-generations.mjs", "utf8");
  assert.match(script, /catalog_recovery_preflight_below_min/);
});

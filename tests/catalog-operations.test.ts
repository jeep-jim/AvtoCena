import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { catalogMinYearForMarket, isCatalogYearAllowed } from "../apps/web/lib/catalog/offer-quality";

test("production year gates keep Japan at 2010+ and every other market at 2020+", () => {
  assert.equal(catalogMinYearForMarket("japan"), 2010);
  assert.equal(isCatalogYearAllowed(2009, "japan"), false);
  assert.equal(isCatalogYearAllowed(2010, "japan"), true);
  for (const market of ["korea", "china", "uae", "europe", "georgia"]) {
    assert.equal(catalogMinYearForMarket(market), 2020, market);
    assert.equal(isCatalogYearAllowed(2019, market), false, market);
    assert.equal(isCatalogYearAllowed(2020, market), true, market);
  }
});

test("legacy combined market writer is deleted and gallery repair remains manual", () => {
  assert.equal(fs.existsSync(".github/workflows/catalog-live-daily-working-markets.yml"), false);

  const refresh = fs.readFileSync("scripts/catalog-refresh-galleries.mjs", "utf8");
  assert.match(refresh, /needsSourceOrderedGalleryRefresh\(offer\)/);
  assert.match(refresh, /Promise\.all\(workers\)/);
  assert.match(refresh, /Math\.min\(20, Math\.max\(1, Number\(process\.env\.CATALOG_GALLERY_CONCURRENCY/);
  assert.doesNotMatch(refresh, /const reportedOfferIds/);

  const repairWorkflow = fs.readFileSync(".github/workflows/catalog-kcar-exterior-gallery-repair.yml", "utf8");
  assert.match(repairWorkflow, /group: catalog-live-daily-working-markets/);
  assert.match(repairWorkflow, /CATALOG_GALLERY_CONCURRENCY: "8"/);
  assert.match(repairWorkflow, /CATALOG_AUDIT_ASSERT_MARKETS: korea,china,japan,uae,europe,georgia/);
});

test("Japan scale collection goes deeper and publishes through the durable object lock", () => {
  const workflow = fs.readFileSync(".github/workflows/catalog-v6-prestige-up-to-30k.yml", "utf8");
  assert.match(workflow, /PRESTIGE_PLAN_RAW_PER_MODEL: "200"/);
  assert.match(workflow, /max-parallel: 6/);
  assert.match(workflow, /group: catalog-live-daily-working-markets/);
  assert.match(workflow, /CATALOG_MAX_OFFERS_PER_MODEL_YEAR: "100"/);
  assert.doesNotMatch(workflow, /^\s*schedule:/m);
  assert.match(workflow, /^\s*push:/m);
  assert.match(workflow, /\.github\/market-runs\/japan-prestige-30k/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /RECOVERY_PUBLISH_MAX: "30000"/);
  assert.match(workflow, /japan_scale_prewrite_gate_failed/);
  assert.match(workflow, /"japan":8700/);

  const prestigeSource = fs.readFileSync("apps/web/lib/catalog/prestige-japan-exact-source.ts", "utf8");
  assert.match(prestigeSource, /JAPAN_MIN_MODEL_YEAR = 2010/);
  assert.match(prestigeSource, /year_from", String\(JAPAN_MIN_MODEL_YEAR\)/);

  const merge = fs.readFileSync("scripts/prestige-japan-strict-merge.mjs", "utf8");
  assert.match(merge, /JAPAN_MIN_MODEL_YEAR = 2010/);
  assert.match(merge, /warnings\.push\(`chunk_incomplete_/);
  assert.match(merge, /const passed = errors\.length === 0 && outputOffers\.length > 0/);

  const verifiedPublish = fs.readFileSync(".github/workflows/catalog-japan-publish-verified-aggregate.yml", "utf8");
  assert.match(verifiedPublish, /PRESTIGE_AGGREGATE_MIN_COUNT: "5000"/);
  assert.match(verifiedPublish, /CATALOG_MAX_OFFERS_PER_MODEL_YEAR: "20"/);
  assert.match(verifiedPublish, /CATALOG_OFFER_RETENTION_MS: "2592000000"/);
  assert.match(verifiedPublish, /prestige-japan-aggregate-salvage\.mjs/);
  assert.match(verifiedPublish, /"japan":2200/);
  assert.match(verifiedPublish, /group: catalog-live-daily-working-markets/);
  assert.doesNotMatch(verifiedPublish, /^\s*push:/m);

  const japanRecovery = fs.readFileSync("scripts/catalog-live-recovery-japan-prestige.mjs", "utf8");
  assert.match(japanRecovery, /CATALOG_MAX_OFFERS_PER_MODEL_YEAR/);
  const livePublisher = fs.readFileSync("scripts/catalog-live-recovery-publish.mjs", "utf8");
  assert.match(livePublisher, /CATALOG_MAX_OFFERS_PER_MODEL_YEAR/);
  assert.match(livePublisher, /offer\?\.auctionDate/);

  const reindexWorkflow = fs.readFileSync(".github/workflows/catalog-reindex-vehicle-knowledge.yml", "utf8");
  const reindex = fs.readFileSync("scripts/catalog-reindex-vehicle-knowledge.mjs", "utf8");
  assert.match(reindexWorkflow, /group: catalog-live-daily-working-markets/);
  assert.match(reindex, /refreshLiveExchangeRates/);
  assert.match(reindex, /isPreliminaryPowerPendingCalculation\(source\)[\s\S]*calculateOfferWithPreliminaryPowerPricing\(source\)/);
  assert.match(reindex, /30 \* 24 \* 60 \* 60 \* 1_000/);
});

test("certified 30-minute power applies only on reviewed changes or manual dispatch", () => {
  const workflow = fs.readFileSync(".github/workflows/catalog-certified-power-apply.yml", "utf8");
  assert.match(workflow, /CATALOG_CERTIFIED_POWER_APPLY: "1"/);
  assert.match(workflow, /catalog-certified-power-reference\.test\.ts/);
  assert.match(workflow, /catalog-build-certified-power-queue\.mjs/);
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.doesNotMatch(workflow, /^\s+schedule:/m);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /group: catalog-live-daily-working-markets/);

  const publisher = fs.readFileSync("scripts/catalog-live-recovery-publish.mjs", "utf8");
  assert.match(publisher, /catalog\/import-lock\.json/);
  assert.match(publisher, /catalog_publish_lock_wait_failed/);
  assert.match(publisher, /finally \{\s*await releasePublishLock\(\)/);

  const applyPower = fs.readFileSync("scripts/catalog-apply-certified-power.mjs", "utf8");
  assert.match(applyPower, /CATALOG_IMPORT_LOCK_WAIT_MS/);
  assert.match(applyPower, /\[power-lock\] waiting/);

  const strictMerge = fs.readFileSync("scripts/catalog-japan-strict-merge-publish.mjs", "utf8");
  assert.match(strictMerge, /isCatalogYearAllowed\(offer\.year, market\)/);
  assert.match(strictMerge, /hasCredibleOfferContent\(\{ \.\.\.offer, status: "active" \}\)/);
  assert.match(strictMerge, /japan_strict_preflight_below_min/);

  const strictWorkflow = fs.readFileSync(".github/workflows/catalog-japan-strict-merge-publish.yml", "utf8");
  assert.match(strictWorkflow, /JAPAN_STRICT_MIN_PUBLISH_COUNT: "193"/);
  assert.doesNotMatch(strictWorkflow, /SOURCE_RUN_ID: "\d+"/);
});

test("emergency Japan recovery stays manual-only and the removed market writer is absent", () => {
  const recovery = fs.readFileSync(".github/workflows/catalog-emergency-restore-japan.yml", "utf8");
  assert.match(recovery, /CATALOG_RECOVERY_GENERATIONS: "gen_1786426826475_e390aa80"/);
  assert.match(recovery, /CATALOG_RECOVERY_MARKETS: "korea,china,japan,uae,europe,georgia"/);
  assert.match(recovery, /group: catalog-live-daily-working-markets/);
  assert.match(recovery, /CATALOG_AUDIT_ASSERT_MARKETS: japan/);

  assert.equal(fs.existsSync(".github/workflows/catalog-live-recovery-uae-kyrgyzstan.yml"), false);

  const script = fs.readFileSync("scripts/catalog-recover-generations.mjs", "utf8");
  assert.match(script, /catalog_recovery_preflight_below_min/);
});

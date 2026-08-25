import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const queue = fs.readFileSync(new URL("../.github/workflows/catalog-v3-sequential-queue.yml", import.meta.url), "utf8");
const removedDailyWorkingMarkets = new URL("../.github/workflows/catalog-live-daily-working-markets.yml", import.meta.url);
const uaeKyrgyzstan = fs.readFileSync(new URL("../.github/workflows/catalog-live-recovery-uae-kyrgyzstan.yml", import.meta.url), "utf8");

test("sequential queue uses only its schedule and explicit operator triggers", () => {
  assert.match(queue, /workflow_dispatch:/);
  assert.match(queue, /schedule:/);
  assert.match(queue, /cron: "17 21 \* \* \*"/);
  assert.match(queue, /push:[\s\S]*branches:[\s\S]*- main[\s\S]*paths:[\s\S]*\.github\/catalog-v3-run-all/);
  assert.match(queue, /github\.event_name \}\}" = "push"/);
  assert.doesNotMatch(queue, /workflow_run:/);
  assert.doesNotMatch(queue, /gh workflow run/);
});

test("superseded daily working markets writer remains deleted", () => {
  assert.equal(fs.existsSync(removedDailyWorkingMarkets), false);
});

test("daily UAE source failure cannot block Kyrgyzstan publication", () => {
  assert.match(uaeKyrgyzstan, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER: "5"/);
  assert.match(uaeKyrgyzstan, /CATALOG_MAX_OFFERS_PER_MODEL_YEAR: "20"/);
  assert.match(uaeKyrgyzstan, /\n  merge-uae:/);
  assert.match(uaeKyrgyzstan, /\n  merge-kyrgyzstan:/);
  assert.match(uaeKyrgyzstan, /\n  publish-uae:/);
  assert.match(uaeKyrgyzstan, /\n  publish-kyrgyzstan:/);
  assert.match(uaeKyrgyzstan, /publish-kyrgyzstan:[\s\S]*needs: \[validate, merge-kyrgyzstan\]/);
  assert.doesNotMatch(uaeKyrgyzstan, /publish-kyrgyzstan:[\s\S]*needs: \[[^\]]*merge-uae/);
  assert.match(uaeKyrgyzstan, /CATALOG_AUDIT_ASSERT_MARKETS: uae/);
  assert.match(uaeKyrgyzstan, /CATALOG_AUDIT_ASSERT_MARKETS: kyrgyzstan/);
  assert.match(uaeKyrgyzstan, /group: catalog-live-daily-working-markets/);
});

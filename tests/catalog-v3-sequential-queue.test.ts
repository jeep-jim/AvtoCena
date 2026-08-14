import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const queue = fs.readFileSync(new URL("../.github/workflows/catalog-v3-sequential-queue.yml", import.meta.url), "utf8");
const dailyWorkingMarkets = fs.readFileSync(new URL("../.github/workflows/catalog-live-daily-working-markets.yml", import.meta.url), "utf8");
const uaeKyrgyzstan = fs.readFileSync(new URL("../.github/workflows/catalog-live-recovery-uae-kyrgyzstan.yml", import.meta.url), "utf8");

const order = ["Korea", "Japan", "China", "UAE", "Europe", "Georgia", "Kyrgyzstan"];

test("Catalog V3 dispatches all markets strictly in sequence after success", () => {
  for (const market of order) assert.match(queue, new RegExp(`Catalog V3 · ${market} · 10k`));
  assert.match(queue, /conclusion == 'success'/);
  assert.match(queue, /head_branch == 'main'/);
  assert.match(queue, /actions: write/);
  assert.match(queue, /catalog-v2-japan\.yml/);
  assert.match(queue, /catalog-v2-china\.yml/);
  assert.match(queue, /catalog-v2-uae\.yml/);
  assert.match(queue, /catalog-v2-europe\.yml/);
  assert.match(queue, /catalog-v2-georgia\.yml/);
  assert.match(queue, /catalog-v2-kyrgyzstan\.yml/);
});

test("daily working markets cannot lose Europe behind one shared publish timeout", () => {
  assert.match(dailyWorkingMarkets, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER: "5"/);
  assert.match(dailyWorkingMarkets, /CATALOG_MAX_OFFERS_PER_MODEL_YEAR: "20"/);
  for (const market of ["korea", "china", "europe", "georgia"]) {
    assert.match(dailyWorkingMarkets, new RegExp(`\\n  publish-${market}:`));
    assert.match(dailyWorkingMarkets, new RegExp(`RECOVERY_PUBLISH_MARKET: ${market}`));
    assert.match(dailyWorkingMarkets, new RegExp(`CATALOG_AUDIT_ASSERT_MARKETS: ${market}`));
  }
  assert.match(dailyWorkingMarkets, /publish-china:[\s\S]*needs: \[validate, merge, publish-korea\]/);
  assert.match(dailyWorkingMarkets, /publish-europe:[\s\S]*needs: \[validate, merge, publish-china\]/);
  assert.match(dailyWorkingMarkets, /publish-georgia:[\s\S]*needs: \[validate, merge, publish-europe\]/);
  assert.match(dailyWorkingMarkets, /publish-korea:[\s\S]*timeout-minutes: 120/);
  assert.match(dailyWorkingMarkets, /publish-europe:[\s\S]*timeout-minutes: 120/);
  assert.match(dailyWorkingMarkets, /CATALOG_GALLERY_MIN_IMAGES: "5"/);
  assert.doesNotMatch(dailyWorkingMarkets, /Publish markets serially, preserving all seven/);
  assert.match(dailyWorkingMarkets, /\n  final-audit:/);
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

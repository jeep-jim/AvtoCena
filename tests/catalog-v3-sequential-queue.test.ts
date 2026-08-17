import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const queue = fs.readFileSync(new URL("../.github/workflows/catalog-v3-sequential-queue.yml", import.meta.url), "utf8");
const dailyWorkingMarkets = fs.readFileSync(new URL("../.github/workflows/catalog-live-daily-working-markets.yml", import.meta.url), "utf8");
const uaeKyrgyzstan = fs.readFileSync(new URL("../.github/workflows/catalog-live-recovery-uae-kyrgyzstan.yml", import.meta.url), "utf8");

test("obsolete Catalog V3 automatic chain remains disabled", () => {
  assert.match(queue, /Sequential queue \(manual only\)/);
  assert.match(queue, /Automatic catalog chaining is disabled/);
  assert.doesNotMatch(queue, /workflow_run:/);
  assert.doesNotMatch(queue, /gh workflow run/);
});

test("daily working markets own Korea, China and Europe while Georgia stays on Yandex v2", () => {
  assert.match(dailyWorkingMarkets, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER: "5"/);
  assert.match(dailyWorkingMarkets, /CATALOG_MAX_OFFERS_PER_MODEL_YEAR: "20"/);
  for (const market of ["korea", "china", "europe"]) {
    assert.match(dailyWorkingMarkets, new RegExp(`\\n  publish-${market}:`));
    assert.match(dailyWorkingMarkets, new RegExp(`RECOVERY_PUBLISH_MARKET: ${market}`));
    assert.match(dailyWorkingMarkets, new RegExp(`CATALOG_AUDIT_ASSERT_MARKETS: ${market}`));
  }
  assert.match(dailyWorkingMarkets, /publish-china:[\s\S]*needs: \[validate, merge, publish-korea\]/);
  assert.match(dailyWorkingMarkets, /publish-europe:[\s\S]*needs: \[validate, merge, publish-china\]/);
  assert.doesNotMatch(dailyWorkingMarkets, /\n  publish-georgia:/);
  assert.doesNotMatch(dailyWorkingMarkets, /myauto_georgia_list|autopapa_georgia_open/);
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

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const recovery = fs.readFileSync(new URL("../apps/web/lib/catalog/georgia-yandex-recovery.ts", import.meta.url), "utf8");
const egressRoute = new URL("../apps/web/app/api/internal/georgia-egress-8d4c2f/route.ts", import.meta.url);
const dryRunRoute = new URL("../apps/web/app/api/internal/georgia-adapters-dryrun-6a91d7/route.ts", import.meta.url);
const recoveryBridge = fs.readFileSync(new URL("../apps/web/app/api/internal/georgia-recovery-c4f812/route.ts", import.meta.url), "utf8");

test("Georgia Yandex recovery snapshot is read-only and canonical", () => {
  assert.match(recovery, /myAutoListSource/);
  assert.match(recovery, /autoPapaGeorgiaSource/);
  assert.match(recovery, /recoveryExactSourceUrl: true/);
  assert.match(recovery, /recoveryExactPhotoIdentity: true/);
  assert.match(recovery, /recoveryCalculatedRub: true/);
  assert.match(recovery, /recoveryBodySourceOnly: true/);
  assert.doesNotMatch(recovery, /persistCatalogOffers|putJson|writeFile/);
  assert.doesNotMatch(recovery, /auto_georgia_open|www\.auto\.ge|mymarket|ss\.ge/i);
});

test("Georgia recovery snapshot binds official full galleries", () => {
  assert.match(recovery, /parseMyAutoListingImageUrl/);
  assert.match(recovery, /myAutoProductSnapshotFromInfo/);
  assert.match(recovery, /String\(info\.car_id/);
  assert.match(recovery, /String\(info\.photo/);
  assert.match(recovery, /autoPapaDetailOriginalPhotoUrls/);
  assert.match(recovery, /myauto_(?:list_plus_product|exact_product)_large_formula/);
  assert.match(recovery, /autopapa_exact_detail_originals/);
});

test("temporary Georgia public-internal diagnostic routes are removed after recovery", () => {
  assert.equal(fs.existsSync(egressRoute), false);
  assert.equal(fs.existsSync(dryRunRoute), false);
});

test("temporary Georgia recovery bridge stays read-only and bounded", () => {
  assert.match(recoveryBridge, /collectGeorgiaYandexRecoverySnapshot/);
  assert.match(recoveryBridge, /searchParams\.get\("pages"\)/);
  assert.match(recoveryBridge, /searchParams\.get\("startPage"\)/);
  assert.match(recoveryBridge, /sourceValue === "myauto" \|\| sourceValue === "autopapa"/);
  assert.match(recoveryBridge, /"cache-control": "no-store"/);
  assert.doesNotMatch(recoveryBridge, /persistCatalogOffers|writeDataJson|putJson|POST|PUT|DELETE/);
});

test("Georgia recovery keeps bounded AutoPapa page ranges and honest preliminary pricing", () => {
  assert.match(recovery, /boundedInteger\(pagesPerSource, 2, 20\)/);
  assert.match(recovery, /boundedInteger\(startPage, 1, 10_000\)/);
  assert.match(recovery, /selectedSource === "myauto"/);
  assert.match(recovery, /selectedSource === "autopapa"/);
  assert.match(recovery, /collectPages\(autoPapaGeorgiaSource, pages, firstPage\)/);
  assert.match(recovery, /calculateOfferWithPreliminaryPowerPricing/);
  assert.match(recovery, /isPreliminaryPowerPendingCalculation/);
  assert.doesNotMatch(recovery, /isPreliminaryElectrifiedCalculation/);
});

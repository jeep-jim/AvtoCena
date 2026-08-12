import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const recovery = fs.readFileSync(new URL("../apps/web/lib/catalog/georgia-yandex-recovery.ts", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../apps/web/app/api/internal/georgia-egress-8d4c2f/route.ts", import.meta.url), "utf8");

test("Georgia Yandex recovery snapshot is read-only and canonical", () => {
  assert.match(recovery, /myAutoListSource/);
  assert.match(recovery, /autoPapaGeorgiaSource/);
  assert.match(recovery, /recoveryExactSourceUrl: true/);
  assert.match(recovery, /recoveryExactPhotoIdentity: true/);
  assert.match(recovery, /recoveryCalculatedRub: true/);
  assert.match(recovery, /recoveryBodySourceOnly: true/);
  assert.doesNotMatch(recovery, /persistCatalogOffers|putJson|writeFile/);
  assert.doesNotMatch(recovery, /auto_georgia_open|auto\.ge|mymarket|ss\.ge/i);
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

test("Yandex diagnostic route exposes recovery only as explicit no-store GET mode", () => {
  assert.match(route, /searchParams\.get\("mode"\) === "recovery"/);
  assert.match(route, /collectGeorgiaYandexRecoverySnapshot/);
  assert.match(route, /"cache-control": "no-store"/);
});


test("Georgia recovery supports bounded AutoPapa page ranges and honest preliminary pricing", () => {
  assert.match(recovery, /Math\.min\(20, Math\.floor\(pagesPerSource\)\)/);
  assert.match(recovery, /Math\.min\(10_000, Math\.floor\(startPage\)\)/);
  assert.match(recovery, /selectedSource === "myauto"/);
  assert.match(recovery, /selectedSource === "autopapa"/);
  assert.match(recovery, /collectPages\(autoPapaGeorgiaSource, pages, firstPage\)/);
  assert.match(recovery, /calculateOfferWithPreliminaryPowerPricing/);
  assert.match(recovery, /isPreliminaryPowerPendingCalculation/);
  assert.doesNotMatch(recovery, /isPreliminaryElectrifiedCalculation/);
  assert.match(route, /searchParams\.get\("startPage"\)/);
  assert.match(route, /searchParams\.get\("source"\)/);
});

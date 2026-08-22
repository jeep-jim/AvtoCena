import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const recovery = fs.readFileSync(new URL("../apps/web/lib/catalog/georgia-yandex-recovery.ts", import.meta.url), "utf8");
const egressRoute = new URL("../apps/web/app/api/internal/georgia-egress-8d4c2f/route.ts", import.meta.url);
const dryRunRoute = new URL("../apps/web/app/api/internal/georgia-adapters-dryrun-6a91d7/route.ts", import.meta.url);
const recoveryBridge = new URL("../apps/web/app/api/internal/georgia-recovery-c4f812/route.ts", import.meta.url);
const powerDiagnostic = new URL("../apps/web/app/api/internal/georgia-power-a91f72/route.ts", import.meta.url);
const replacementPublisher = fs.readFileSync(new URL("../scripts/catalog-replace-georgia-atomic.mjs", import.meta.url), "utf8");

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
  assert.equal(fs.existsSync(recoveryBridge), false);
  assert.equal(fs.existsSync(powerDiagnostic), false);
});

test("Georgia replacement publisher preserves the full non-Georgia maintenance array", () => {
  assert.match(replacementPublisher, /readAllOffersForMaintenance/);
  assert.match(replacementPublisher, /market === "georgia"/);
  assert.match(replacementPublisher, /enrichOfferWithKnowledgeCore/);
  assert.match(replacementPublisher, /const projectedFull = await Promise\.all/);
  assert.match(replacementPublisher, /projectedPublicCounts/);
  assert.match(replacementPublisher, /preservation_projection_mismatch/);
  assert.match(replacementPublisher, /persistCatalogOffers\(projectedFull\)/);
  assert.match(replacementPublisher, /CATALOG_GROW_ONLY_MARKETS = ""/);
  assert.match(replacementPublisher, /canonicalGeorgiaSources/);
  assert.match(replacementPublisher, /isCatalogYearAllowed/);
  assert.match(replacementPublisher, /gallery_below_five/);
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

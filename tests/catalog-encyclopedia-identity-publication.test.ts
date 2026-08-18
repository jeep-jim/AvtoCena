import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const publisher = fs.readFileSync("scripts/catalog-publish-encyclopedia-identity-read-models.mjs", "utf8");
const storage = fs.readFileSync("apps/web/lib/catalog/storage.ts", "utf8");

test("identity read-model migration is dry-run by default and requires explicit publication", () => {
  assert.match(publisher, /CATALOG_ENCYCLOPEDIA_IDENTITY_PUBLISH[^\n]*===\s*"1"/);
  assert.match(publisher, /if \(PUBLISH\) \{[\s\S]*assertEncyclopediaIdentityProductionConnected/);
});

test("identity read-model migration reuses current generation and does not switch catalog manifest", () => {
  assert.match(publisher, /rebuildIndexes\(manifest\.generationId, projectedOffers/);
  assert.doesNotMatch(publisher, /persistCatalogOffers\(/);
  assert.doesNotMatch(publisher, /writeJson\([^\n]*catalog\/manifest\.json/);
});

test("identity read-model migration proves offer and market counts before any write", () => {
  assert.match(publisher, /catalog_identity_publish_offer_count_read_mismatch/);
  assert.match(publisher, /catalog_identity_publish_offer_count_changed/);
  assert.match(publisher, /catalog_identity_publish_market_counts_changed/);
  assert.match(publisher, /catalog_identity_publish_brand_collisions/);
});

test("first identity release leaves the core catalog writer and recovery preservation contract untouched", () => {
  assert.doesNotMatch(storage, /applyConfiguredEncyclopediaIdentity/);
  assert.doesNotMatch(storage, /identityOnlyReprojection/);
  assert.match(storage, /exactPreserveMarkets\.has\(offer\.market\)[\s\S]*\? offer[\s\S]*enrichOfferWithVehicleKnowledge/);
});

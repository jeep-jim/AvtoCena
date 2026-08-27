import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const storage = fs.readFileSync(new URL("../apps/web/lib/catalog/storage.ts", import.meta.url), "utf8");
const deployAudit = fs.readFileSync(new URL("../scripts/catalog-audit-visible-calculation-coverage.mjs", import.meta.url), "utf8");

test("current offer shard is trusted only for the active manifest generation", () => {
  assert.match(storage, /Promise\.all\(\[readManifest\(\), readCurrentOfferShard\(id\)\]\)/);
  assert.match(storage, /current\.generationId === manifest\.generationId/);
  assert.match(storage, /currentOffer && publishedOfferCanRenderUnderCurrentPolicy\(currentOffer\)/);
  assert.match(storage, /offer && publishedOfferCanRenderUnderCurrentPolicy\(offer\) \? offer : null/);
});

test("public read models require a valid engine price and reject peer-median outliers", () => {
  assert.match(storage, /catalogPublicPriority\(o\)\.eligible/);
  assert.match(storage, /findCatalogPriceOutliers\(identityEligibleOffers\)/);
  assert.match(storage, /rejectedPriceIds/);
  assert.match(storage, /previousAllProjection/);
});

test("current search projection is trusted only for the active manifest generation", () => {
  assert.match(storage, /readCurrentSearchProjection\(currentProjectionScope\)/);
  assert.match(storage, /const \[manifest, current\] = await Promise\.all/);
  assert.ok((storage.match(/current\.generationId === manifest\.generationId/g) || []).length >= 2);
  assert.match(storage, /publicSpecificationVerified: visibleRub > 0/);
  assert.match(storage, /cardProjectionVersion:\s*3/);
});

test("deploy calculation audit reads the public projection and classifies current statuses", () => {
  assert.match(storage, /export async function readCurrentPublicCatalogProjection/);
  assert.match(deployAudit, /readCurrentPublicCatalogProjection/);
  assert.doesNotMatch(deployAudit, /readAllOffersForMaintenance/);
  assert.doesNotMatch(deployAudit, /findVehicleModel/);
  assert.match(deployAudit, /status === "ready" \|\| status === "estimated"/);
  assert.match(deployAudit, /status === "needs_data" \|\| status === "preliminary_power_pending"/);
  assert.match(deployAudit, /noPreliminaryPublicPrices/);
  assert.match(deployAudit, /noNeedsDataPublicCards/);
  assert.match(deployAudit, /noInvalidSpecifications/);
});

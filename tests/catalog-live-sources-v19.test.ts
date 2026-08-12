import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const current = fs.readFileSync("apps/web/lib/catalog/current-regional-market-sources.ts", "utf8");
const scale = fs.readFileSync("apps/web/lib/catalog/scale-market-sources.ts", "utf8");
const fastGallery = fs.readFileSync("apps/web/lib/catalog/priority-fast-gallery-wrapper.ts", "utf8");
const fullGallery = fs.readFileSync("apps/web/lib/catalog/full-gallery-wrapper.ts", "utf8");
const importer = fs.readFileSync("apps/web/lib/catalog/importer.ts", "utf8");
const workflow = fs.readFileSync(".github/workflows/catalog-live-daily.yml", "utf8");
const rebuild = fs.readFileSync("scripts/catalog-rebuild-market.mjs", "utf8");

test("live high-volume sources use current listing and detail routes", () => {
  assert.match(current, /encar_direct/);
  assert.match(current, /auto_georgia_open/);
  assert.match(current, /mashina_kyrgyzstan_open/);
  assert.match(current, /otomoto_europe_exact/);
  assert.match(scale, /autopapa_georgia_open/);
  assert.match(scale, /myauto_georgia_open/);
});

test("AUTO.GE prices keep decimal cents separate from thousands", async () => {
  const { parseAutoGeorgiaPrice } = await import("../apps/web/lib/catalog/auto-georgia-strict-source");
  assert.equal(parseAutoGeorgiaPrice("6,500.00 $"), 6500);
  assert.equal(parseAutoGeorgiaPrice("14 200 $"), 14200);
  assert.equal(parseAutoGeorgiaPrice("22,500 $"), 22500);
});

test("DubiCars exact specs own make, model and trim instead of marketing h1 text", async () => {
  const { __testDubicarsCurrent } = await import("../apps/web/lib/catalog/dubicars-current-source");
  const exact = __testDubicarsCurrent.parseDubicarsExactSpecs(`
    <html><head><title>2024 GMC Hummer EV for sale in UAE | AED 6,899 P.M</title></head><body>
      <h1>GMC Hummer EV EDITION 1 AED 6,899 P.M • 0% Downpayment</h1>
      <div>Make <span>GMC</span></div>
      <div>Model <span>Hummer EV</span></div>
      <div>Trim <span>Edition 1</span></div>
      <div>Year <span>2024</span></div>
    </body></html>
  `);
  assert.equal(exact.make, "GMC");
  assert.equal(exact.model, "Hummer EV");
  assert.equal(exact.trim, "Edition 1");
  assert.equal(exact.year, 2024);
});

test("DubiCars ignores an implausible source horsepower typo instead of pricing it as certified power", async () => {
  const { __testDubicarsCurrent } = await import("../apps/web/lib/catalog/dubicars-current-source");
  assert.equal(__testDubicarsCurrent.parseDubicarsHorsepower("6,899 HP"), undefined);
  assert.equal(__testDubicarsCurrent.parseDubicarsHorsepower("650 HP"), 650);
});

test("commercial vehicles are excluded from priority passenger-car sources", async () => {
  const { __testScaleMarketSources } = await import("../apps/web/lib/catalog/scale-market-sources");
  assert.equal(__testScaleMarketSources.isCommercialVehicleTitle("2024 Isuzu NPR Truck"), true);
  assert.equal(__testScaleMarketSources.isCommercialVehicleTitle("2024 Toyota RAV4"), false);
});

test("Catalog V2 probes every configured source slot, crawls live sites and retains inactive sites", () => {
  const registry = fs.readFileSync("apps/web/lib/catalog/catalog-v2-source-registry.ts", "utf8");
  const probe = fs.readFileSync("scripts/catalog-v2-probe.mjs", "utf8");
  assert.match(registry, /CATALOG_V2_SOURCE_SLOTS/);
  assert.match(probe, /catalogV2SourceIds/);
  assert.match(rebuild, /retentionSourceIds/);
  assert.match(rebuild, /liveSourceIds/);
  assert.match(rebuild, /catalog\/source-cursors/);
  assert.doesNotMatch(workflow, /CATALOG_REBUILD_TARGET: "250"/);
  assert.doesNotMatch(workflow, /catalog-rebuild-market-retry/);
});

test("priority galleries preserve listing photos and enrich detail progressively", () => {
  const listingCache = fastGallery.indexOf("cacheImageFromUrl");
  const detailedFetch = fastGallery.indexOf("source.fetchImages(offer)");
  assert.ok(listingCache >= 0 && detailedFetch > listingCache);
  assert.match(fastGallery, /CATALOG_GALLERY_FAST_PATH/);
  assert.match(fastGallery, /listingImages\.length >= minimum/);
  assert.match(fullGallery, /sourceGalleryUrls\(offer\)/);
  assert.match(fullGallery, /\[\.\.\.listingUrls, \.\.\.detailed\]/);
  assert.match(fullGallery, /gallerySafetyMode: "source_urls_only"/);
  assert.match(fullGallery, /return verified \? result : \[\]/);
  assert.match(importer, /priorityFastGallery/);
  assert.match(importer, /myAutoListSource/);
  assert.doesNotMatch(importer, /import \{ autoGeorgiaStrictSource \}/);
  assert.match(importer, /bannedGeorgiaSourceIds/);
  assert.match(importer, /mashinaKyrgyzstanListSource/);
  assert.match(importer, /reliableBootstrapSources/);
  assert.match(workflow, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER: "1"/);
  assert.match(workflow, /CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER: "30"/);
  assert.match(workflow, /CATALOG_COLLECTION_IMAGE_LIMIT: "30"/);
  assert.match(workflow, /CATALOG_MAX_IMAGES_PER_OFFER: "30"/);
  assert.match(workflow, /CATALOG_GALLERY_FAST_PATH: "false"/);
  assert.match(workflow, /CATALOG_REBUILD_DETAIL_LIMIT_PER_SOURCE: "100000"/);
  assert.match(rebuild, /const detailNeeded = mandatoryPhotoMissing \|\| criticalSpecsMissing \|\| priorityGalleryMissing/);
  assert.match(rebuild, /reserveDetail/);
  assert.match(rebuild, /detailDeferredBySource/);
  assert.match(rebuild, /source\.fetchImages\(offer\)/);
});

// Keep this suite synchronized with the current main pricing safety baseline.

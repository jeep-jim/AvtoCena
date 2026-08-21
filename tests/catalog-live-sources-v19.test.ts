import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parseAutoGeorgiaMoney } from "../apps/web/lib/catalog/auto-georgia-enriched-source";
import { DubicarsCurrentAdapter, parseDubicarsCurrentListing } from "../apps/web/lib/catalog/dubicars-current-source";

const priority = fs.readFileSync(new URL("../apps/web/lib/catalog/priority-market-sources.ts", import.meta.url), "utf8");
const fastGallery = fs.readFileSync(new URL("../apps/web/lib/catalog/priority-fast-gallery-wrapper.ts", import.meta.url), "utf8");
const fullGallery = fs.readFileSync(new URL("../apps/web/lib/catalog/full-gallery-wrapper.ts", import.meta.url), "utf8");
const importer = fs.readFileSync(new URL("../apps/web/lib/catalog/importer.ts", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-v2-production.yml", import.meta.url), "utf8");
const probe = fs.readFileSync(new URL("../scripts/catalog-probe-source-shard.mjs", import.meta.url), "utf8");
const rebuild = fs.readFileSync(new URL("../scripts/catalog-rebuild-source-shard.mjs", import.meta.url), "utf8");

test("live high-volume sources use current listing and detail routes", () => {
  assert.ok(priority.includes('sourceId: "guazi_china_open"'));
  assert.ok(priority.includes("car-detail"));
  assert.ok(priority.includes('sourceId: "carused_japan_open"'));
  assert.ok(priority.includes("https://carused.jp/car-list?page=${page}"));
  assert.ok(priority.includes("car-list\\/detail"));
  assert.ok(priority.includes('sourceId: "tcv_japan_open"'));
  assert.ok(priority.includes("https://www.tc-v.com/used_car/all/all/"));
  assert.ok(priority.includes("?pn=${page - 1}"));
});

test("AUTO.GE prices keep decimal cents separate from thousands", () => {
  assert.equal(parseAutoGeorgiaMoney("6,400.00"), 6_400);
  assert.equal(parseAutoGeorgiaMoney("17,500.00"), 17_500);
  assert.equal(parseAutoGeorgiaMoney("28 700"), 28_700);
  assert.equal(parseAutoGeorgiaMoney("9.200,00"), 9_200);
});

test("DubiCars exact specs own make, model and trim instead of marketing h1 text", () => {
  const markup = `
    <h1>Used 2024 Nissan Patrol AED 3,449 P.M • 0% Downpayment • Agency Warranty</h1>
    <div>AED 215,000</div>
    <section>Model year 2024 Kilometers 12,300 Km Engine capacity 5.6 L Horsepower 400 HP
      Transmission Automatic Export status Can be exported Interior color Tan Steering side Left hand Updated on 11 Aug, 2026
      Make Nissan Model Patrol Trim LE T1 5.6L Color White Cylinders 8 Cylinders Drive type Four Wheel Drive
      Vehicle type SUV/Crossover Number of doors 5 Doors Seating capacity 8 seater Wheel size 22 Fuel Type Petrol Service history No
    </section>
    <img src="https://cdn.dubicars.com/images/abcdef/w_1200x800/vehicle/12345678-abcd-1234-abcd-123456789abc.jpg" />
    <img src="https://cdn.dubicars.com/images/abcdef/w_1200x800/vehicle/22345678-abcd-1234-abcd-123456789abc.jpg" />
  `;
  const row = parseDubicarsCurrentListing(markup, "https://www.dubicars.com/2024-nissan-patrol-marketing-copy-1000265.html");
  assert.ok(row);
  assert.equal(row.make, "Nissan");
  assert.equal(row.model, "Patrol");
  assert.equal(row.trim, "LE T1 5.6L");
  assert.equal(row.engineCc, 5600);
  assert.equal(row.powerHp, 400);
  assert.equal(row.price, 215_000);
  assert.equal(row.images.length, 2);
});

test("DubiCars marketing model-year text cannot promote an old UAE car into the 2020+ catalog", () => {
  const markup = `
    <h1>Toyota Land Cruiser 4.0L Completely Modified Exteriorly & Interiorly to 2025 Model Year V6 1GR Petrol Engine Automatic</h1>
    <div>USD 32,300</div>
    <section>Model year 2016 Kilometers 68,000 Km Engine capacity 4 L Horsepower 271 HP
      Transmission Automatic Export status Can be exported Interior color Red Steering side Left hand Updated on 12 Aug, 2026
      Make Toyota Model Land Cruiser Trim GXR 4.0L Color Black Cylinders 6 Cylinders Drive type Four Wheel Drive
      Vehicle type SUV/Crossover Number of doors 5 Doors Seating capacity 8 seater Wheel size 20 Fuel Type Petrol Service history No
    </section>
    <img src="https://cdn.dubicars.com/images/abcdef/w_1200x800/vehicle/52345678-abcd-1234-abcd-123456789abc.jpg" />
    <img src="https://cdn.dubicars.com/images/abcdef/w_1200x800/vehicle/62345678-abcd-1234-abcd-123456789abc.jpg" />
  `;
  const row = parseDubicarsCurrentListing(markup, "https://www.dubicars.com/2016-toyota-land-cruiser-40l-completely-modified-to-2025-model-year-973822.html");
  assert.equal(row, null);

  const adapter = new DubicarsCurrentAdapter();
  assert.equal(adapter.normalizeOffer({
    id: "973822",
    url: "https://www.dubicars.com/2016-toyota-land-cruiser-40l-completely-modified-to-2025-model-year-973822.html",
    title: "Toyota Land Cruiser modified to 2025 model year",
    make: "Toyota",
    model: "Land Cruiser",
    year: 2016,
    images: ["https://cdn.dubicars.com/images/abcdef/w_1200x800/vehicle/52345678-abcd-1234-abcd-123456789abc.jpg"],
  } as any), null);
});

test("DubiCars ignores an implausible source horsepower typo instead of pricing it as certified power", () => {
  const markup = `
    <h1>New Toyota Land Cruiser VX 4.0L 2023</h1><div>AED 200,000</div>
    <section>Model year 2023 Engine capacity 4 L Horsepower 4,000 HP Make Toyota Model Land Cruiser Trim VX 4.0L
      Transmission Automatic Drive type Four Wheel Drive Vehicle type SUV/Crossover Fuel Type Petrol</section>
    <img src="https://cdn.dubicars.com/images/abcdef/w_1200x800/vehicle/32345678-abcd-1234-abcd-123456789abc.jpg" />
    <img src="https://cdn.dubicars.com/images/abcdef/w_1200x800/vehicle/42345678-abcd-1234-abcd-123456789abc.jpg" />
  `;
  const row = parseDubicarsCurrentListing(markup, "https://www.dubicars.com/2023-toyota-land-cruiser-vx-666205.html");
  assert.ok(row);
  assert.equal(row.model, "Land Cruiser");
  assert.equal(row.powerHp, undefined);
});

test("DubiCars price-on-request listing cannot borrow a recommendation price", () => {
  const markup = `
    <h1>Ford Everest Right Hand Drive</h1>
    <section>Model year 2024 Kilometers 29,811 Km Engine capacity 3 L Horsepower 247 HP
      Make Ford Model Everest Transmission Automatic Vehicle type Station Wagon Fuel Type Diesel</section>
    <a href="https://api.whatsapp.com/send?text=Reference%3A+dc-989293%0AMake%3A+Ford%0AModel%3A+Everest%0APrice%3A+0%0AYear%3A+2024">WhatsApp</a>
    <section>Similar cars Rolls Royce AED 2,680,000</section>
    <img src="https://cdn.dubicars.com/images/abcdef/w_1200x800/vehicle/72345678-abcd-1234-abcd-123456789abc.jpg" />
    <img src="https://cdn.dubicars.com/images/abcdef/w_1200x800/vehicle/82345678-abcd-1234-abcd-123456789abc.jpg" />
  `;
  const row = parseDubicarsCurrentListing(markup, "https://www.dubicars.com/2024-ford-everest-right-hand-drive-989293.html");
  assert.ok(row);
  assert.equal(row.price, undefined);
  assert.equal(row.currency, undefined);
  const offer = new DubicarsCurrentAdapter().normalizeOffer(row);
  assert.ok(offer);
  assert.equal(offer.sourcePrice, null);
  assert.equal(offer.calculationStatus, "needs_data");
});

test("commercial vehicles are excluded from priority passenger-car sources", () => {
  assert.match(priority, /COMMERCIAL_RE/);
  assert.match(priority, /Hino\|Mitsubishi Fuso/);
  assert.match(priority, /truck\|dump\|tipper\|bus/);
});

test("Catalog V2 probes every configured source slot, crawls live sites and retains inactive sites", () => {
  assert.match(workflow, /Catalog V2 production/);
  assert.match(workflow, /max-parallel: 20/);
  assert.match(workflow, /market: \[korea, china, japan, uae, europe, georgia, kyrgyzstan\]/);
  assert.match(workflow, /npx tsx scripts\/catalog-probe-source-shard\.mjs/);
  assert.match(workflow, /npx tsx scripts\/catalog-rebuild-source-shard\.mjs/);
  assert.match(workflow, /CATALOG_REBUILD_TARGET_PER_SOURCE: "100000"/);
  assert.match(workflow, /CATALOG_REBUILD_TARGET_PER_MARKET: "100000"/);
  assert.match(workflow, /CATALOG_REBUILD_SHARD_COUNT: "5"/);
  assert.match(workflow, /shard: \[0, 1, 2, 3, 4\]/);
  assert.match(workflow, /CATALOG_OFFER_RETENTION_MS: "259200000"/);
  assert.match(probe, /sourceIdsForRebuild = activeSourceIds\.join/);
  assert.match(probe, /sourceIdsForRebuild/);
  assert.match(rebuild, /targetPerSource/);
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
  // Minimum image count is an admission floor; fast-path collection only stops
  // once the preferred gallery depth is reached, normally 30 source photos.
  assert.match(fastGallery, /listingImages\.length >= preferred/);
  assert.match(fastGallery, /CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER \|\| 30/);
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

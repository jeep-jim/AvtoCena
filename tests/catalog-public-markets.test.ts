import assert from "node:assert/strict";
import test from "node:test";
import { catalogImportSources } from "../apps/web/lib/catalog/importer";
import {
  BeForwardMarketAdapter,
  PUBLIC_CATALOG_SOURCE_IDS,
  parseBeForwardMarketStocklist,
  publicMarketSources,
} from "../apps/web/lib/catalog/public-market-sources";

const fixture = `
<article class="vehicle-card">
  <a href="/stocklist/toyota/land-cruiser/cd123456/id/991">
    <img data-src="https://cdn.beforward.jp/vehicle_images/cd123456/main.jpg" />
    <span>Ref No. CD123456</span>
    <h2>2023 TOYOTA LAND CRUISER ZX</h2>
  </a>
  <div>Mileage <strong>12,500 km</strong></div>
  <div>Year <strong>2023/4</strong></div>
  <div>Engine <strong>3,440cc</strong></div>
  <div>Trans. <strong>AT</strong></div>
  <div>Location <strong>Dubai</strong></div>
  <div>Model code VJA300W Steering Left Fuel Petrol Seats 7</div>
  <div>Engine code V35A Color Black Drive 4WD Doors 5</div>
  <div>Auction grade 4.5</div>
  <div>Price $62,300 Total Price $65,000</div>
</article>`;

test("BE FORWARD public parser accepts current letter-prefixed references and card fields", () => {
  const rows = parseBeForwardMarketStocklist(fixture);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].refNo, "CD123456");
  assert.equal(rows[0].title, "2023 TOYOTA LAND CRUISER ZX");
  assert.equal(rows[0].make, "TOYOTA");
  assert.equal(rows[0].model, "LAND CRUISER");
  assert.equal(rows[0].year, "2023");
  assert.equal(rows[0].location, "Dubai");
  assert.equal(rows[0].price, "62,300");
  assert.equal(rows[0].images.length, 1);
});

test("market-specific BE FORWARD adapter keeps the configured source market", () => {
  const row = parseBeForwardMarketStocklist(fixture)[0];
  const adapter = new BeForwardMarketAdapter({ sourceId: "test_uae", market: "uae", stockCountryId: 44, label: "UAE" });
  const offer = adapter.normalizeOffer(row);
  assert.ok(offer);
  assert.equal(offer?.market, "uae");
  assert.equal(offer?.sourcePrice, 62_300);
  assert.equal(offer?.sourceCurrency, "USD");
  assert.equal(offer?.engineCc, 3_440);
  assert.equal(offer?.mileageKm, 12_500);
});

test("public source set covers every AvtoCena market without credentials", () => {
  const byMarket = new Set(publicMarketSources.map((source) => source.market));
  assert.ok(byMarket.has("japan"));
  assert.ok(byMarket.has("uae"));
  assert.ok(byMarket.has("europe"));
  assert.ok(PUBLIC_CATALOG_SOURCE_IDS.includes("encar_direct"));
  assert.ok(PUBLIC_CATALOG_SOURCE_IDS.includes("che168_global"));

  const importIds = new Set(catalogImportSources.map((source) => source.sourceId));
  for (const sourceId of PUBLIC_CATALOG_SOURCE_IDS) assert.ok(importIds.has(sourceId), sourceId);
  assert.equal(importIds.has("beforward_public"), false);
});

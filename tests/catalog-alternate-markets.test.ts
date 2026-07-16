import assert from "node:assert/strict";
import test from "node:test";
import {
  ALTERNATE_CATALOG_SOURCE_IDS,
  PRODUCTION_CATALOG_SOURCE_IDS,
  SbtMarketAdapter,
  alternateMarketSources,
  parseSbtMarketStocklist,
} from "../apps/web/lib/catalog/alternate-market-sources";
import {
  PUBLIC_FALLBACK_SOURCE_IDS,
  PublicFallbackAdapter,
  parsePublicFallbackPage,
  publicFallbackSources,
} from "../apps/web/lib/catalog/public-fallback-sources";

const fixture = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "itemListElement": [
          {
            "@type": "Vehicle",
            "sku": "SBT-JP-12345",
            "name": "2022 TOYOTA LAND CRUISER PRADO",
            "brand": { "name": "TOYOTA" },
            "model": "LAND CRUISER",
            "modelYear": "2022",
            "mileage": "18,400 km",
            "vehicleEngine": "2690 cc",
            "fuelType": "Petrol",
            "vehicleTransmission": "Automatic",
            "vehicleConfiguration": "SUV",
            "url": "/used-cars/toyota/land-cruiser/sbt-jp-12345",
            "image": [
              "https://cdn.example.com/sbt-jp-12345/1.jpg",
              "https://cdn.example.com/sbt-jp-12345/2.jpg"
            ],
            "offers": { "price": "24500", "priceCurrency": "USD" }
          }
        ]
      }
    </script>
  </head>
</html>`;

const publicFixture = `
<!doctype html>
<html>
  <head>
    <script id="__NEXT_DATA__" type="application/json">
      {
        "props": {
          "pageProps": {
            "vehicles": [
              {
                "id": "JT-7788",
                "title": "2021 Honda Vezel e:HEV Z",
                "make": "Honda",
                "model": "Vezel",
                "year": 2021,
                "mileageKm": 34100,
                "engineCc": 1496,
                "price": 2380000,
                "priceCurrency": "JPY",
                "url": "/japan/stat/JT-7788",
                "images": [
                  "https://img.example.com/JT-7788/1.webp",
                  "https://img.example.com/JT-7788/2.webp"
                ]
              }
            ]
          }
        }
      }
    </script>
  </head>
</html>`;

const dubicarsHtmlFixture = `
<!doctype html>
<html>
  <body>
    <article class="listing-card">
      <a href="/2025-mercedes-benz-cla250-premium-20l-965722.html">
        <img data-src="https://cdn.example.com/965722/cover.webp" alt="Mercedes Benz CLA250 Premium + 2.0L" />
        Mercedes Benz CLA250 Premium + 2.0L
      </a>
      <div>USD 26,600</div>
      <div>Dubai GCC 2025 22,000 Km Petrol Automatic Sedan</div>
    </article>
  </body>
</html>`;

const autoscoutHtmlFixture = `
<!doctype html>
<html>
  <body>
    <section>
      <a href="/offers/bmw-320-diesel-black-12345678-abcd">
        <img src="https://cdn.example.com/autoscout/1.jpg" alt="BMW 320d xDrive" />
        BMW 320d xDrive
      </a>
      <span>€ 29,900</span>
      <span>2022 · 48,300 km · Diesel · Automatic · Sedan</span>
    </section>
  </body>
</html>`;

test("SBT JSON-LD fallback parser returns a usable vehicle", () => {
  const rows = parseSbtMarketStocklist(fixture);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].refNo, "SBT-JP-12345");
  assert.equal(rows[0].make, "TOYOTA");
  assert.equal(rows[0].model, "LAND CRUISER");
  assert.equal(rows[0].year, "2022");
  assert.equal(rows[0].price, "24500");
  assert.equal(rows[0].images.length, 2);
});

test("SBT adapter keeps its configured market and USD price", () => {
  const row = parseSbtMarketStocklist(fixture)[0];
  const adapter = new SbtMarketAdapter({
    sourceId: "test_sbt_uae",
    market: "uae",
    inventoryLocationId: 2,
    label: "SBT UAE",
  });
  const offer = adapter.normalizeOffer(row);
  assert.ok(offer);
  assert.equal(offer?.market, "uae");
  assert.equal(offer?.sourcePrice, 24_500);
  assert.equal(offer?.sourceCurrency, "USD");
  assert.equal(offer?.mileageKm, 18_400);
});

test("embedded public catalog parser reads Next.js vehicle data", () => {
  const rows = parsePublicFallbackPage(publicFixture, "https://japantransit.ru", "JPY");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "JT-7788");
  assert.equal(rows[0].make, "Honda");
  assert.equal(rows[0].model, "Vezel");
  assert.equal(rows[0].year, 2021);
  assert.equal(rows[0].price, 2_380_000);
  assert.equal(rows[0].images.length, 2);
});

test("server-rendered DubiCars listing cards are parsed", () => {
  const rows = parsePublicFallbackPage(dubicarsHtmlFixture, "https://www.dubicars.com", "AED");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "965722");
  assert.equal(rows[0].make, "Mercedes-Benz");
  assert.match(rows[0].model, /^CLA250/);
  assert.equal(rows[0].year, 2025);
  assert.equal(rows[0].price, 26_600);
  assert.equal(rows[0].currency, "USD");
  assert.equal(rows[0].mileageKm, 22_000);
  assert.equal(rows[0].images.length, 1);
});

test("server-rendered AutoScout listing cards are parsed", () => {
  const rows = parsePublicFallbackPage(autoscoutHtmlFixture, "https://www.autoscout24.com", "EUR");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].make, "BMW");
  assert.match(rows[0].model, /^320d/);
  assert.equal(rows[0].year, 2022);
  assert.equal(rows[0].price, 29_900);
  assert.equal(rows[0].currency, "EUR");
  assert.equal(rows[0].mileageKm, 48_300);
});

test("public fallback adapter preserves configured market and currency", () => {
  const row = parsePublicFallbackPage(publicFixture, "https://japantransit.ru", "JPY")[0];
  const adapter = new PublicFallbackAdapter({
    sourceId: "test_japantransit",
    market: "japan",
    label: "JapanTransit",
    baseUrl: "https://japantransit.ru",
    currency: "JPY",
    urls: () => ["https://japantransit.ru/japan/stat"],
  });
  const offer = adapter.normalizeOffer(row);
  assert.ok(offer);
  assert.equal(offer?.market, "japan");
  assert.equal(offer?.sourceCurrency, "JPY");
  assert.equal(offer?.sourcePrice, 2_380_000);
});

test("daily production fallbacks cover all previously empty markets", () => {
  const markets = new Set([...alternateMarketSources, ...publicFallbackSources].map((source) => source.market));
  assert.ok(markets.has("japan"));
  assert.ok(markets.has("china"));
  assert.ok(markets.has("uae"));
  assert.ok(markets.has("europe"));
  assert.equal(ALTERNATE_CATALOG_SOURCE_IDS.length, 4);
  assert.equal(PUBLIC_FALLBACK_SOURCE_IDS.length, 4);
  assert.ok(PRODUCTION_CATALOG_SOURCE_IDS.includes("encar_direct"));
  assert.ok(PRODUCTION_CATALOG_SOURCE_IDS.includes("che168_global"));
  for (const sourceId of ALTERNATE_CATALOG_SOURCE_IDS) assert.ok(PRODUCTION_CATALOG_SOURCE_IDS.includes(sourceId));
  for (const sourceId of ["japantransit_japan", "che168_html", "dubicars_uae", "autoscout_europe"]) {
    assert.ok(PUBLIC_FALLBACK_SOURCE_IDS.includes(sourceId));
  }
});

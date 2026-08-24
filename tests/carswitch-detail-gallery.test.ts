import assert from "node:assert/strict";
import test from "node:test";
import {
  CarSwitchUaeExactAdapter,
  parseCarSwitchExactDetail,
  parseCarSwitchExactListing,
} from "../apps/web/lib/catalog/carswitch-exact-source";

const listingMarkup = `
  <a href="/uae/used-cars/8-seater-cars-for-sale">8-seater cars Price 300 AED</a>
  <script type="application/ld+json">{
    "@context":"https://schema.org",
    "@type":"ItemList",
    "itemListElement":[
      {
        "@type":"ItemPage",
        "url":"https://carswitch.com/abudhabi/used-car/nissan/patrol/2024/858598",
        "position":"1",
        "mainEntity":{
          "@type":["Product","Car"],
          "name":"2024 Nissan Patrol SE Platinum",
          "vehicleIdentificationNumber":"BUYFROMCS00858598",
          "image":["https://d1esl34bhh6pms.cloudfront.net/cars/used/images/original/listing-one"],
          "mileageFromOdometer":{"@type":"QuantitativeValue","value":1500,"unitCode":"KMT"},
          "offers":{"@type":"Offer","price":"208000","priceCurrency":"AED"}
        }
      },
      {
        "@type":"ItemPage",
        "url":"https://carswitch.com/dubai/used-car/dodge/charger/2013/862241",
        "mainEntity":{
          "@type":["Product","Car"],
          "name":"2013 Dodge Charger",
          "image":["https://d1esl34bhh6pms.cloudfront.net/cars/used/images/original/old"],
          "offers":{"@type":"Offer","price":"18500","priceCurrency":"AED"}
        }
      }
    ]
  }</script>
  <div>Installments 1,980 AED / month</div>
`;

const detailMarkup = `
  <script type="application/ld+json">{
    "@context":"https://schema.org",
    "@type":["Car","Product"],
    "url":"https://carswitch.com/abudhabi/used-car/nissan/patrol/2024/858598",
    "name":"Nissan Patrol SE Platinum 2024 4.0",
    "vehicleIdentificationNumber":"BUYFROMCS00858598",
    "image":[
      "https://d1esl34bhh6pms.cloudfront.net/cars/used/images/original/a",
      "https://d1esl34bhh6pms.cloudfront.net/cars/used/images/original/b",
      "https://d1esl34bhh6pms.cloudfront.net/cars/used/images/original/c",
      "https://d1esl34bhh6pms.cloudfront.net/cars/used/images/original/d",
      "https://d1esl34bhh6pms.cloudfront.net/cars/used/images/original/e",
      "https://d1esl34bhh6pms.cloudfront.net/cars/used/images/original/f",
      "https://d1esl34bhh6pms.cloudfront.net/cars/used/images/original/g",
      "https://d1esl34bhh6pms.cloudfront.net/cars/used/images/original/h",
      "https://d1esl34bhh6pms.cloudfront.net/cars/used/images/original/i",
      "https://d1esl34bhh6pms.cloudfront.net/cars/used/images/original/j"
    ],
    "mileageFromOdometer":{"@type":"QuantitativeValue","value":1500,"unitCode":"KMT"},
    "offers":{"@type":"Offer","price":"209000","priceCurrency":"AED"}
  }</script>
  <script type="application/ld+json">{
    "@context":"https://schema.org",
    "@type":["Car","Product"],
    "url":"https://carswitch.com/dubai/used-car/rolls-royce/cullinan/2024/999999",
    "name":"Related car",
    "image":[
      "https://d1esl34bhh6pms.cloudfront.net/cars/used/images/original/related-a",
      "https://d1esl34bhh6pms.cloudfront.net/cars/used/images/original/related-b"
    ],
    "offers":{"@type":"Offer","price":"999999","priceCurrency":"AED"}
  }</script>
`;

test("CarSwitch keeps a one-image exact listing as discovery input", () => {
  const rows = parseCarSwitchExactListing(listingMarkup);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "858598");
  assert.equal(rows[0].make, "Nissan");
  assert.equal(rows[0].model, "Patrol");
  assert.equal(rows[0].year, 2024);
  assert.equal(rows[0].price, 208_000);
  assert.equal(rows[0].images.length, 1);

  const offer = new CarSwitchUaeExactAdapter().normalizeOffer(rows[0]);
  assert.ok(offer);
  assert.equal(offer.operational?.galleryVerified, false);
  assert.equal(offer.operational?.photoIdentityVerified, false);
});

test("CarSwitch exact detail parser binds the gallery to the same vehicle URL", () => {
  const row = parseCarSwitchExactDetail(
    detailMarkup,
    "https://carswitch.com/abudhabi/used-car/nissan/patrol/2024/858598",
  );
  assert.ok(row);
  assert.equal(row.id, "858598");
  assert.equal(row.price, 209_000);
  assert.equal(row.images.length, 10);
  assert.equal(row.vin, "BUYFROMCS00858598");
  assert.ok(row.images.every((url) => !url.includes("related")));
});

test("CarSwitch fetchImages upgrades one-image discovery to exact detail gallery and price", async () => {
  const adapter = new CarSwitchUaeExactAdapter();
  const row = parseCarSwitchExactListing(listingMarkup)[0];
  const offer = adapter.normalizeOffer(row);
  assert.ok(offer);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(detailMarkup, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  try {
    const images = await adapter.fetchImages(offer);
    assert.equal(images.length, 10);
    assert.equal(offer.sourcePrice, 209_000);
    assert.equal(offer.sourceCurrency, "AED");
    assert.equal(offer.operational?.galleryVerified, true);
    assert.equal(offer.operational?.photoIdentityVerified, true);
    assert.equal((offer.operational?.raw as any)?.cashPriceAuthority, "schema_org_offer_price_exact_detail");
    assert.equal((offer.operational?.raw as any)?.vehicleIdentificationNumber, "BUYFROMCS00858598");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

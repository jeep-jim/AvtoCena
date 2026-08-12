import assert from "node:assert/strict";
import test from "node:test";
import { buildMyAutoListUrls, MyAutoListAdapter, parseMyAutoListingMarkup } from "../apps/web/lib/catalog/myauto-list-source";

const markup = `
<section>
  <a href="/en/pr/122724917/bmw-x5"><img src="https://static.myauto.ge/photos/x5-main.webp" alt="BMW X5"></a>
  <a href="/en/pr/122724917/bmw-x5">BMW X5</a>
  <div>2019 year · Jeep · Petrol · Tbilisi · 88 000 km · 65 000</div>
  <a href="/en/pr/122433509/toyota-camry"><img data-src="https://static.myauto.ge/photos/camry-main.jpg" alt="Toyota Camry"></a>
  <a href="/en/pr/122433509/toyota-camry">Toyota Camry</a>
  <div>2021 year · Sedan · Hybrid · Rustavi Car Market · 42 000 km · 72 500</div>
  <a href="/en/pr/122000001/ford-transit"><img src="https://static.myauto.ge/photos/transit.jpg"></a>
  <a href="/en/pr/122000001/ford-transit">Ford Transit Commercial Minibus</a>
  <div>2020 year · Diesel · 110 000</div>
  <a href="/en/pr/122999999/for-rent-sedan-bmw-330-2024-petrol-geo"><img src="https://static.myauto.ge/photos/rental.jpg"></a>
  <a href="/en/pr/122999999/for-rent-sedan-bmw-330-2024-petrol-geo">BMW 330</a>
  <div>2024 year · Sedan · Petrol · Tbilisi · 500 km · 9 000</div>
</section>`;

test("MyAuto listing parser hard-rejects pre-2020, commercial and rental listings", () => {
  const rows = parseMyAutoListingMarkup(markup, "https://www.myauto.ge/en/main?page=1");
  assert.equal(rows.length, 1, "pre-2020, commercial and rental listings must be excluded at collection");
  assert.deepEqual(rows.map((row) => `${row.make} ${row.model}`), ["Toyota Camry"]);
  assert.equal(rows[0].year, 2021);
  assert.equal(rows[0].price, 72_500);
  assert.equal(rows[0].images[0], "https://static.myauto.ge/photos/camry-main.jpg");
  assert.equal(rows[0].location, "Rustavi Car Market");
});

test("MyAuto canonical list routes try current no-query and both host variants before giving up", () => {
  assert.deepEqual(buildMyAutoListUrls(1), [
    "https://www.myauto.ge/en/main",
    "https://myauto.ge/en/main",
    "https://www.myauto.ge/en/main?page=1",
    "https://myauto.ge/en/main?page=1",
  ]);
  assert.deepEqual(buildMyAutoListUrls(2), [
    "https://www.myauto.ge/en/main?page=2",
    "https://myauto.ge/en/main?page=2",
  ]);
});

test("MyAuto normalized offer is 2020+ and ready for knowledge enrichment and exact calculation", () => {
  const adapter = new MyAutoListAdapter();
  const row = parseMyAutoListingMarkup(markup, "https://www.myauto.ge/en/main?page=1")[0];
  const offer = adapter.normalizeOffer(row);
  assert.ok(offer);
  assert.equal(offer?.sourceId, "myauto_georgia_list");
  assert.equal(offer?.market, "georgia");
  assert.equal(offer?.sourceCurrency, "GEL");
  assert.equal(offer?.sourcePrice, 72_500);
  assert.equal(offer?.make, "Toyota");
  assert.equal(offer?.model, "Camry");
  assert.equal(offer?.year, 2021);
  assert.equal(offer?.operational?.sourceUrl, "https://www.myauto.ge/en/pr/122433509/toyota-camry");
});

test("MyAuto normalization rejects a pre-2020 row even if it bypasses the list parser", () => {
  const adapter = new MyAutoListAdapter();
  const offer = adapter.normalizeOffer({
    id: "legacy-2019",
    detailUrl: "https://www.myauto.ge/en/pr/legacy-2019/test",
    title: "Toyota Camry",
    make: "Toyota",
    model: "Camry",
    year: 2019,
    price: 50_000,
    currency: "GEL",
    images: [],
  });
  assert.equal(offer, null);
});

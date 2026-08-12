import assert from "node:assert/strict";
import test from "node:test";
import { buildMyAutoListUrls, MyAutoListAdapter, parseMyAutoListingMarkup } from "../apps/web/lib/catalog/myauto-list-source";
import { AutoPapaGeorgiaAdapter, parseAutoPapaGeorgiaListingMarkup } from "../apps/web/lib/catalog/autopapa-georgia-source";

const markup = `
<section>
  <a href="/en/pr/122724917/bmw-x5"><img src="https://static.myauto.ge/photos/x5-main.webp" alt="BMW X5"></a>
  <a href="/en/pr/122724917/bmw-x5">BMW X5</a>
  <div>2019 year · Jeep · Petrol · Tbilisi · 88 000 km · 65 000</div>
  <a href="/en/pr/122433509/toyota-camry"><img data-src="https://static.myauto.ge/photos/camry-main.jpg" alt="Toyota Camry"></a>
  <a href="/en/pr/122433509/toyota-camry">Toyota Camry</a>
  <div>2021 year · Sedan · Hybrid · Rustavi Car Market · 42 000 km · 72 500</div>
  <a href="/en/pr/122555555/mercedes-gle"><img src="https://static.myauto.ge/photos/gle-main.jpg" alt="Mercedes-Benz GLE 350"></a>
  <a href="/en/pr/122555555/mercedes-gle">Mercedes-Benz GLE 350</a>
  <div>2020 year · Jeep · Petrol · Tbilisi · 70 000 km · 99 500</div>
  <a href="/en/pr/122000001/ford-transit"><img src="https://static.myauto.ge/photos/transit.jpg"></a>
  <a href="/en/pr/122000001/ford-transit">Ford Transit Commercial Minibus</a>
  <div>2020 year · Diesel · 110 000</div>
  <a href="/en/pr/122999999/for-rent-sedan-bmw-330-2024-petrol-geo"><img src="https://static.myauto.ge/photos/rental.jpg"></a>
  <a href="/en/pr/122999999/for-rent-sedan-bmw-330-2024-petrol-geo">BMW 330</a>
  <div>2024 year · Sedan · Petrol · Tbilisi · 500 km · 9 000</div>
</section>`;

test("MyAuto collection hard-filters pre-2020, commercial and rental listings", () => {
  const rows = parseMyAutoListingMarkup(markup, "https://www.myauto.ge/en/main?page=1");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => `${row.make} ${row.model}`), ["Toyota Camry", "Mercedes-Benz GLE 350"]);
  assert.deepEqual(rows.map((row) => row.year), [2021, 2020]);
  assert.equal(rows[0].price, 72_500);
  assert.equal(rows[1].price, 99_500);
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

test("MyAuto normalized offer is ready for knowledge enrichment and exact calculation", () => {
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

const autoPapaMarkup = `
<section>
  <a href="/en/usd/chevrolet/captiva/932906"><img src="/system/car/photos/009/066/595/medium.jpg?1770802543"></a>
  <a href="/en/usd/chevrolet/captiva/932906">Chevrolet Captiva</a>
  <div>minivan $13 000 2023 year, Rustavi, customs not cleared 22 K. km / 14 Miles automatic 1.5 l, petrol</div>
  <a href="/en/usd/maserati/mLevante/956987"><img src="/system/car/photos/009/414/327/medium.jpg?1786349130"></a>
  <a href="/en/usd/maserati/mLevante/956987">Maserati Levante</a>
  <div>suv $29 500 2022 year, Tbilisi, customs not cleared 48 000 K. km / 30 000 Miles automatic 3.0 l, petrol</div>
  <a href="/en/usd/bmw/X6M/954330"><img src="/system/car/photos/009/378/143/medium.jpg?1784737205"></a>
  <a href="/en/usd/bmw/X6M/954330">BMW X6 M</a>
  <div>suv $25 384 2018 year, Batumi, customs cleared 122 000 K. km automatic 3.0 l, petrol</div>
  <a href="/en/usd/bmw/X7/949905"><img src="/system/car/photos/009/333/882/medium.jpg?1782810742"></a>
  <a href="/en/usd/bmw/X7/949905">BMW X7</a>
  <div>suv Price negotiable 2026 year, Tbilisi, customs not cleared 4 800 K. km 3.0 l, petrol</div>
</section>`;

test("AutoPapa dedicated parser binds exact id, price and source image to each 2020+ card", () => {
  const rows = parseAutoPapaGeorgiaListingMarkup(autoPapaMarkup, "https://autopapa.ge/en/usd/search?page=1");
  assert.equal(rows.length, 2, "pre-2020 and negotiable-price rows must not enter collection");
  assert.deepEqual(rows.map((row) => row.id), ["932906", "956987"]);
  assert.deepEqual(rows.map((row) => row.price), [13_000, 29_500]);
  assert.deepEqual(rows.map((row) => row.year), [2023, 2022]);
  assert.equal(rows[0].mileageKm, 22_000);
  assert.equal(rows[1].mileageKm, 48_000);
  assert.equal(rows[0].engineCc, 1_500);
  assert.equal(rows[0].transmission?.toLowerCase(), "automatic");
  assert.equal(rows[0].images[0], "https://autopapa.ge/system/car/photos/009/066/595/medium.jpg?1770802543");
});

test("AutoPapa normalized offer keeps the canonical numeric source offer id", () => {
  const adapter = new AutoPapaGeorgiaAdapter();
  const row = parseAutoPapaGeorgiaListingMarkup(autoPapaMarkup, "https://autopapa.ge/en/usd/search?page=1")[0];
  const offer = adapter.normalizeOffer(row);
  assert.ok(offer);
  assert.equal(offer?.sourceId, "autopapa_georgia_open");
  assert.equal(offer?.sourceOfferId, "932906");
  assert.equal(offer?.sourcePrice, 13_000);
  assert.equal(offer?.sourceCurrency, "USD");
  assert.equal(offer?.operational?.sourceUrl, "https://autopapa.ge/en/usd/chevrolet/captiva/932906");
});

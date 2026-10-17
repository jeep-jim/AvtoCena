import assert from "node:assert/strict";
import test from "node:test";
import { buildMyAutoLargePhotoUrls, buildMyAutoListUrls, MyAutoListAdapter, myAutoListingSpecificationEvidence, parseMyAutoListingImageUrl, parseMyAutoListingMarkup } from "../apps/web/lib/catalog/myauto-list-source";
import { classifySpecificationEvidence } from "../apps/web/lib/catalog/specification-evidence-audit";

const markup = `
<section>
  <a href="/en/pr/122724917/bmw-x5"><img src="https://static.tnet.ge/myauto/photos/1/2/3/4/5/thumbs/122724917_1.jpg?v=4" alt="BMW X5"></a>
  <a href="/en/pr/122724917/bmw-x5">BMW X5</a>
  <div>2019 year · Jeep · Petrol · Tbilisi · 88 000 km · 65 000</div>
  <a href="/en/pr/122433509/toyota-camry"><img data-src="https://static.tnet.ge/myauto/photos/9/8/7/6/5/thumbs/122433509_1.jpg?v=7" alt="Toyota Camry"></a>
  <a href="/en/pr/122433509/toyota-camry">Toyota Camry</a>
  <div>2021 year · Sedan · Hybrid · Rustavi Car Market · 42 000 km · 72 500</div>
  <a href="/en/pr/122000001/ford-transit"><img src="https://static.tnet.ge/myauto/photos/2/2/2/2/2/thumbs/122000001_1.jpg?v=1"></a>
  <a href="/en/pr/122000001/ford-transit">Ford Transit Commercial Minibus</a>
  <div>2020 year · Diesel · 110 000</div>
  <a href="/en/pr/122999999/for-rent-sedan-bmw-330-2024-petrol-geo"><img src="https://static.tnet.ge/myauto/photos/3/3/3/3/3/thumbs/122999999_1.jpg?v=1"></a>
  <a href="/en/pr/122999999/for-rent-sedan-bmw-330-2024-petrol-geo">BMW 330</a>
  <div>2024 year · Sedan · Petrol · Tbilisi · 500 km · 9 000</div>
</section>`;

test("MyAuto listing parser hard-rejects pre-2020, commercial and rental listings", () => {
  const rows = parseMyAutoListingMarkup(markup, "https://www.myauto.ge/en/main?page=1");
  assert.equal(rows.length, 1, "pre-2020, commercial and rental listings must be excluded at collection");
  assert.deepEqual(rows.map((row) => `${row.make} ${row.model}`), ["Toyota Camry"]);
  assert.equal(rows[0].year, 2021);
  assert.equal(rows[0].price, 72_500);
  assert.equal(rows[0].images[0], "https://static.tnet.ge/myauto/photos/9/8/7/6/5/thumbs/122433509_1.jpg?v=7");
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
  assert.equal(offer?.fuel, "hybrid");
  assert.equal(offer?.powertrainKind, "other_hybrid");
  assert.equal(classifySpecificationEvidence(offer!, "fuelPowertrain").state, "exact");
  assert.equal(classifySpecificationEvidence(offer!, "engineCc").state, "missing");
  assert.equal(classifySpecificationEvidence(offer!, "powerHp").state, "missing");
});

test("MyAuto listing evidence rejects unknown fuel and never treats model numbers as engine size", () => {
  const adapter = new MyAutoListAdapter();
  const offer = adapter.normalizeOffer({
    id: "122999998",
    detailUrl: "https://www.myauto.ge/en/pr/122999998/bmw-330",
    title: "BMW 330",
    make: "BMW",
    model: "330",
    year: 2024,
    price: 50_000,
    currency: "GEL",
    fuel: "Other",
    images: [],
  });
  assert.ok(offer);
  assert.equal(offer!.fuel, undefined);
  assert.equal(offer!.engineCc, undefined);
  assert.equal(offer!.powerHp, undefined);
  assert.equal((offer!.operational as any).semanticEvidence.fuel.status, "ambiguous");
  assert.equal(classifySpecificationEvidence(offer!, "fuelPowertrain").state, "ambiguous");
  assert.equal(myAutoListingSpecificationEvidence({ year: 2024, fuel: "Petrol" }).fuel.value, "petrol");
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

test("MyAuto image URLs remain bound to the exact listing id", () => {
  const exact = "https://static.tnet.ge/myauto/photos/9/8/7/6/5/thumbs/122433509_1.jpg?v=7";
  assert.deepEqual(parseMyAutoListingImageUrl(exact, "122433509"), {
    id: "122433509",
    photo: "9/8/7/6/5",
    size: "thumbs",
    index: 1,
    version: 7,
  });
  assert.equal(parseMyAutoListingImageUrl(exact, "122433500"), null);
  assert.equal(parseMyAutoListingImageUrl("https://static.tnet.ge/myauto/photos/9/8/7/6/5/thumbs/122433500_1.jpg?v=7", "122433509"), null);
  assert.equal(parseMyAutoListingImageUrl("https://other.example/myauto/photos/9/8/7/6/5/thumbs/122433509_1.jpg?v=7", "122433509"), null);
});

test("MyAuto full gallery uses the official id/photo/count/version large-image formula", () => {
  assert.deepEqual(buildMyAutoLargePhotoUrls({
    id: "122928158",
    photo: "5/1/8/2/9",
    count: 3,
    version: 1,
  }), [
    "https://static.tnet.ge/myauto/photos/5/1/8/2/9/large/122928158_1.jpg?v=1",
    "https://static.tnet.ge/myauto/photos/5/1/8/2/9/large/122928158_2.jpg?v=1",
    "https://static.tnet.ge/myauto/photos/5/1/8/2/9/large/122928158_3.jpg?v=1",
  ]);
  assert.equal(buildMyAutoLargePhotoUrls({ id: "122928158", photo: "../foreign", count: 3, version: 1 }).length, 0);
  assert.equal(buildMyAutoLargePhotoUrls({ id: "other", photo: "5/1/8/2/9", count: 3, version: 1 }).length, 0);
  assert.equal(buildMyAutoLargePhotoUrls({ id: "122928158", photo: "5/1/8/2/9", count: 99, version: 1 }).length, 30);
});

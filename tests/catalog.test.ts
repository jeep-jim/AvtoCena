import assert from "node:assert/strict";
import test from "node:test";
import { BeForwardPublicAdapter, Che168GlobalPublicAdapter, EncarDirectAdapter, JsonPartnerFeedAdapter, normalizeEncarPrice, parseBeForwardStocklist, parseCsv } from "../apps/web/lib/catalog/adapters";
import { persistCatalogOffers, searchOffers, publicOffer, CATALOG_CHUNK_SIZE, getOffer, cacheImageFromUrl, assertSafeImageUrl } from "../apps/web/lib/catalog/storage";
import { convertToRub } from "../apps/web/lib/catalog/rates";
import { getJsonStorage, resetJsonStorageForTests, readDataJson } from "../apps/web/lib/data";

process.env.JSON_STORAGE_DRIVER = "local";
delete process.env.CATALOG_IMAGE_CDN_URL;
const image = { id: "img1", url: "/api/catalog/images/img1", objectKey: "catalog/images/japan/a.jpg", size: 10, checksum: "abc", mimeType: "image/jpeg" };

test("Encar direct normalizes price from 만원 and full KRW without double multiplication", () => {
  assert.equal(normalizeEncarPrice(3190), 31_900_000);
  assert.equal(normalizeEncarPrice(31_900_000), 31_900_000);
});

test("Encar direct normalizes list fixture and hides source URLs from public DTO", () => {
  const adapter = new EncarDirectAdapter();
  const offer = adapter.normalizeOffer({ Id: "37123456", Manufacturer: "Hyundai", Model: "Sonata", Badge: "2.0", BadgeDetail: "Premium", FormYear: "2021", Mileage: "42000", Price: 3190, FuelType: "Gasoline", Transmission: "Automatic", Category: "Sedan", ModifiedDate: "2026-07-14T10:00:00Z", RegistrationDate: "2021-04", Photo: "/carphoto/foo.jpg", OfficeCityState: "Seoul", displacement: 1999, power: 160, color: "White", VIN: "PRIVATEVIN" });
  assert.ok(offer);
  assert.equal(offer!.sourcePrice, 31_900_000);
  assert.equal(offer!.operational.vin, "PRIVATEVIN");
  assert.equal((publicOffer({ ...offer!, images: [image] } as any) as any).operational, undefined);
});

test("BE FORWARD stocklist fixture parses Ref No, price, location and market", () => {
  const html = `<article><a href="/stocklist/toyota/harrier/bf123/id/900"><img src="/img/a.jpg"></a><h2>Toyota Harrier Premium</h2><span>Ref No. BF123</span><dl><dt>Make</dt><dd>Toyota</dd><dt>Model</dt><dd>Harrier</dd><dt>Year</dt><dd>2020/7</dd><dt>Mileage</dt><dd>45,000 km</dd><dt>Engine</dt><dd>2,000 cc</dd><dt>Transmission</dt><dd>AT</dd><dt>Fuel</dt><dd>Petrol</dd><dt>Drive</dt><dd>2WD</dd><dt>Body Type</dt><dd>SUV</dd><dt>Location</dt><dd>Yokohama, Japan</dd><dt>Vehicle Price</dt><dd>US$ 12,300</dd></dl></article>`;
  const rows = parseBeForwardStocklist(html);
  assert.equal(rows.length, 1);
  const offer = new BeForwardPublicAdapter().normalizeOffer(rows[0]);
  assert.equal(offer?.sourceOfferId, "BF123");
  assert.equal(offer?.market, "japan");
  assert.equal(offer?.sourcePrice, 12300);
});

test("BE FORWARD parser gracefully returns empty list when HTML structure changes", () => {
  assert.deepEqual(parseBeForwardStocklist("<html><body>No cards</body></html>"), []);
});

test("Che168 Global fixture publishes needs_data and never uses MSRP as used-car price", () => {
  const offer = new Che168GlobalPublicAdapter().normalizeOffer({ infoid: "CN1", dealerid: "D1", brandname: "BYD", seriesname: "Seal", specname: "Long Range", carname: "BYD Seal", mileage: "12000", regdate: "2024-01", fuelname: "EV", city: "Shanghai", imageurl: "https://img.example/car.jpg", msrp: 200000 });
  assert.equal(offer?.sourcePrice, null);
  assert.equal(offer?.totalRub, null);
  assert.equal(offer?.calculationStatus, "needs_data");
  assert.equal(offer?.priceMode, "estimated");
});

test("CSV parser detects delimiter, quoted fields and BOM", () => {
  const rows = parseCsv('\uFEFFid;make;model;price\n"1";"Toyota";"Prius, Hybrid";"1000"');
  assert.equal(rows[0].model, "Prius, Hybrid");
});

test("catalog generation chunks stay under 500 and search loads indexed chunks only", async () => {
  resetJsonStorageForTests();
  const now = new Date().toISOString();
  const offers: any[] = Array.from({ length: CATALOG_CHUNK_SIZE + 1 }, (_, i) => ({ id: `o${i}`, sourceId: "test", sourceOfferId: `${i}`, market: "japan", offerType: "fixed", status: "active", make: "Toyota", model: i % 2 ? "Prius" : "Aqua", year: 2020 + (i % 4), sourcePrice: 1000000, sourceCurrency: "JPY", priceMode: "fixed", images: [image], totalRub: 1500000 + i, calculationStatus: "ready", firstSeenAt: now, updatedAt: now, operational: {} }));
  offers.push({ ...offers[0], id: "needs-data", sourceOfferId: "ND", sourcePrice: null, sourceCurrency: null, totalRub: null, calculationStatus: "needs_data" });
  await persistCatalogOffers(offers);
  const manifest = await readDataJson<any>("catalog/manifest.json", {});
  assert.ok(manifest.generationId.startsWith("gen_"));
  const firstChunk = await readDataJson<any[]>(`catalog/generations/${manifest.generationId}/offers/japan/${manifest.markets.japan.chunks[0]}.json`, []);
  assert.ok(firstChunk.length <= 500);
  const result = await searchOffers({ market: "japan", make: "Toyota", model: "Prius", sort: "totalRub", pageSize: 10 });
  assert.equal(result.items.length, 10);
  assert.ok(result.usedIndexShards.some((p: string) => p.includes("/indexes/market/")));
  assert.equal(await getOffer("missing"), null);
});

test("lead generation cards without price are public when they have local photo and real source id", async () => {
  const result = await searchOffers({ hasPrice: "no", pageSize: 5 });
  assert.ok(result.items.some((o: any) => o.id === "needs-data" && o.calculationStatus === "needs_data"));
});

test("image cache rejects HTML instead of image", async () => {
  const original = global.fetch;
  (global as any).fetch = async () => new Response("<html>challenge</html>", { status: 200, headers: { "content-type": "text/html" } });
  try { assert.equal(await cacheImageFromUrl("https://example.test/not-image", "japan"), null); }
  finally { (global as any).fetch = original; }
});


test("legacy JPY rate is not divided by 100 and structured CBR nominal is supported", async () => {
  const legacy = await convertToRub(1_000_000, "JPY");
  assert.equal(legacy?.sourcePriceRub, 570_000);
  assert.equal(legacy?.nominal, 1);
  const usd = await convertToRub(1000, "USD");
  assert.equal(usd?.sourcePriceRub, 92_000);
});

test("public DTO strips source and private image storage fields", () => {
  const dto: any = publicOffer({ id: "o", sourceId: "private", sourceOfferId: "s", market: "japan", offerType: "fixed", status: "active", make: "Toyota", model: "Aqua", year: 2021, sourcePrice: 1, sourceCurrency: "JPY", priceMode: "fixed", images: [image], totalRub: 1, calculationStatus: "ready", firstSeenAt: "now", updatedAt: "now", operational: { sourceUrl: "https://source" } } as any);
  assert.equal(dto.sourceId, undefined);
  assert.equal(dto.images[0].objectKey, undefined);
  assert.equal(dto.images[0].checksum, undefined);
});

test("SSRF guard rejects private hosts and allows known image hosts", () => {
  assert.throws(() => assertSafeImageUrl("http://127.0.0.1/a.jpg"));
  assert.throws(() => assertSafeImageUrl("http://169.254.169.254/latest/meta-data"));
  assert.equal(assertSafeImageUrl("https://ci.encar.com/photo/a.jpg"), "https://ci.encar.com/photo/a.jpg");
});

test("Che168 fetchPage reads result.carlist and uses brand endpoint", async () => {
  const original = global.fetch;
  (global as any).fetch = async (url: string) => {
    if (String(url).includes('/brand')) return new Response(JSON.stringify({ result: { brandlist: [{ brandid: 99 }] } }), { headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ result: { carlist: [{ infoid: 'I1', brandname: 'BYD', seriesname: 'Seal', regdate: '2024-01', mileage: '1' }] } }), { headers: { 'content-type': 'application/json' } });
  };
  try { const page = await new Che168GlobalPublicAdapter().fetchPage(null); assert.equal(page.items.length, 1); }
  finally { (global as any).fetch = original; }
});

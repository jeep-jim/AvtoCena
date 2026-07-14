import assert from "node:assert/strict";
import test from "node:test";
import { BeForwardPublicAdapter, Che168GlobalPublicAdapter, EncarDirectAdapter, JsonPartnerFeedAdapter, buildEncarImageUrl, buildEncarListUrl, normalizeEncarPrice, parseBeForwardStocklist, parseCsv } from "../apps/web/lib/catalog/adapters";
import { persistCatalogOffers, searchOffers, publicOffer, CATALOG_CHUNK_SIZE, getOffer, cacheImageFromUrl, assertSafeImageUrl } from "../apps/web/lib/catalog/storage";
import { convertToRub } from "../apps/web/lib/catalog/rates";
import { getJsonStorage, resetJsonStorageForTests, readDataJson } from "../apps/web/lib/data";

process.env.JSON_STORAGE_DRIVER = "local";
delete process.env.CATALOG_IMAGE_CDN_URL;
const image = { id: "img1", url: "/api/catalog/images/img1", objectKey: "catalog/images/japan/a.jpg", size: 10, checksum: "abc", mimeType: "image/jpeg" };



test("Encar image URL builder resolves base, absolute and ready carpicture paths", () => {
  assert.equal(buildEncarImageUrl("/2024/01/01/123/", 1), "https://ci.encar.com/carpicture/2024/01/01/123/001.jpg");
  assert.equal(buildEncarImageUrl("https://ci.encar.com/carpicture/ready/001.jpg"), "https://ci.encar.com/carpicture/ready/001.jpg");
  assert.equal(buildEncarImageUrl("/carpicture/ready/001.jpg", 1), "https://ci.encar.com/carpicture/ready/001.jpg");
  assert.equal(buildEncarImageUrl("//2024//01//01//123//", 2), "https://ci.encar.com/carpicture/2024/01/01/123/002.jpg");
});

test("Encar image extractor keeps list cover first and deduplicates gallery", async () => {
  const adapter = new EncarDirectAdapter();
  const offer = adapter.normalizeOffer({ Id: "ENC3", Manufacturer: "Kia", Model: "K5", FormYear: "2023", Price: 2100, Photo: "/2024/01/01/123/" });
  assert.ok(offer);
  const urls = (await import("../apps/web/lib/catalog/adapters")).extractEncarImageUrls(offer!, { photos: [{ path: "/2024/01/01/123/" }, { path: "/carpicture/2024/01/01/123/002.jpg" }] });
  assert.equal(urls[0], "https://ci.encar.com/carpicture/2024/01/01/123/001.jpg");
  assert.deepEqual(urls, ["https://ci.encar.com/carpicture/2024/01/01/123/001.jpg", "https://ci.encar.com/carpicture/2024/01/01/123/002.jpg"]);
});

test("Encar mobile list URL uses real query, sr, inav and paging cursor", () => {
  const first = buildEncarListUrl(null, 20).url;
  assert.equal(first.searchParams.get("count"), "true");
  assert.equal(first.searchParams.get("q"), "(And.Hidden.N._.CarType.A.)");
  assert.equal(first.searchParams.get("sr"), "|MobileModifiedDate|0|20");
  assert.equal(first.searchParams.get("inav"), "|Metadata|Sort");
  const next = buildEncarListUrl(JSON.stringify({ offset: 20, cursor: "next-page-token" }), 20).url;
  assert.equal(next.searchParams.get("sr"), "|MobileModifiedDate|20|20");
  assert.equal(next.searchParams.get("cursor"), "next-page-token");
});

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

test("public GET leads is closed without CRM session", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile("apps/web/app/(public)/api/leads/route.ts", "utf-8"));
  assert.match(source, /isCrmRole\(user\?\.role\)/);
  assert.match(source, /status: 401/);
});

test("similar malicious image domains are rejected while autoimg.cn is allowed", () => {
  assert.equal(assertSafeImageUrl("https://erscglobal2.autoimg.cn/a.jpg"), "https://erscglobal2.autoimg.cn/a.jpg");
  assert.throws(() => assertSafeImageUrl("https://evilencar.com/a.jpg"));
  assert.throws(() => assertSafeImageUrl("https://evilbeforward.jp/a.jpg"));
});

test("Encar list cover is preserved when detail gallery is absent", async () => {
  resetJsonStorageForTests();
  const original = global.fetch;
  const seenUrls: string[] = [];
  (global as any).fetch = async (url: string) => {
    seenUrls.push(String(url));
    if (String(url).includes("/v1/readside/vehicle/ENC1")) {
      return new Response(JSON.stringify({ vehicle: { displacement: 1999, fuelType: "Gasoline" } }), { headers: { "content-type": "application/json" } });
    }
    return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-type": "image/jpeg", "content-length": "4" } });
  };
  try {
    const adapter = new EncarDirectAdapter();
    const offer = adapter.normalizeOffer({ Id: "ENC1", Manufacturer: "Hyundai", Model: "Avante", FormYear: "2022", Mileage: 1000, Price: 2000, ModifiedDate: "2026-07-14T00:00:00Z", Photo: "/carphoto/list-cover.jpg" });
    assert.ok(offer);
    const images = await adapter.fetchImages(offer!);
    assert.equal(images.length, 1);
    assert.ok(seenUrls.some((url) => url.includes("/carphoto/list-cover.jpg")));
    assert.equal(offer!.engineCc, 1999);
  } finally {
    (global as any).fetch = original;
  }
});

test("Che168 skips an empty brand and continues the next brand from page 1", async () => {
  const original = global.fetch;
  const searchUrls: string[] = [];
  (global as any).fetch = async (url: string) => {
    const href = String(url);
    if (href.includes("/brand")) {
      return new Response(JSON.stringify({ result: { brands: [{ letter: "A", brands: [{ bid: 1, name: "Empty" }, { bid: 2, name: "BYD" }] }] } }), { headers: { "content-type": "application/json" } });
    }
    searchUrls.push(href);
    const brandid = new URL(href).searchParams.get("brandid");
    const carlist = brandid === "2" ? [{ infoid: "C2", brandname: "BYD", seriesname: "Seal", regdate: "2024-01", mileage: "1" }] : [];
    return new Response(JSON.stringify({ result: { carlist } }), { headers: { "content-type": "application/json" } });
  };
  try {
    const page = await new Che168GlobalPublicAdapter().fetchPage(null);
    assert.equal(page.items.length, 1);
    assert.ok(searchUrls.some((url) => url.includes("brandid=1") && url.includes("pageindex=1")));
    assert.ok(searchUrls.some((url) => url.includes("brandid=2") && url.includes("pageindex=1")));
  } finally {
    (global as any).fetch = original;
  }
});

test("admin import endpoint accepts token only through x-admin-token header", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile("apps/web/app/(public)/api/catalog/import/route.ts", "utf-8"));
  assert.match(source, /headers\.get\("x-admin-token"\)/);
  assert.doesNotMatch(source, /searchParams\.get\(["']token["']\)/);
});

test("Encar shared image extractor keeps list cover and gallery", async () => {
  const adapter = new EncarDirectAdapter();
  const offer = adapter.normalizeOffer({ Id: "ENC2", Manufacturer: "Kia", Model: "K5", FormYear: "2023", Price: 2100, Photo: "/carphoto/cover.jpg" });
  assert.ok(offer);
  const urls = (await import("../apps/web/lib/catalog/adapters")).extractEncarImageUrls(offer!, { photos: [{ path: "/carphoto/gallery.jpg" }] });
  assert.deepEqual(urls, ["https://ci.encar.com/carphoto/cover.jpg", "https://ci.encar.com/carphoto/gallery.jpg"]);
});

test("importer refreshes lock during page, vehicle, image and generation processing", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile("apps/web/lib/catalog/importer.ts", "utf-8"));
  assert.match(source, /const refreshLock = \(\) => mutateDataJson/);
  assert.match(source, /fetchPage\(cursor\);[\s\S]*await refreshLock\(\)/);
  assert.match(source, /let images: any\[\] = \[\]; await refreshLock\(\)/);
  assert.match(source, /process\.env\.CATALOG_MAX_IMAGES_PER_OFFER = String\(maxImagesPerOffer\)/);
  assert.match(source, /source\.fetchImages\(base\)/);
  assert.match(source, /await refreshLock\(\); await persistCatalogOffers/);
  assert.match(source, /lock\.operationId === operationId/);
});

test("lead route restores missing client and retries failed CPA without resending sent CPA", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile("apps/web/app/(public)/api/leads/route.ts", "utf-8"));
  assert.match(source, /existingClients/);
  assert.match(source, /existingClient \|\| await appendChunkedDataJson\("clients\/clients\.json"/);
  assert.match(source, /new Set\(\["pending", "failed", "waiting_config"\]\)/);
  assert.match(source, /cpaRetryStatuses\.has\(cpaEvent\.deliveryStatus\) && retryDue/);
  assert.doesNotMatch(source, /deliveryStatus === "sent"[\s\S]*deliverCpaEvent/);
});

test("temporary scan error preserves running scan cycle and cursor", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile("apps/web/lib/catalog/importer.ts", "utf-8"));
  assert.match(source, /status === "completed"\) scan =/);
  assert.doesNotMatch(source, /status === "completed" \|\| scan\.status === "failed"/);
  assert.match(source, /status: "running", cursor, lastError: lastHealth\.message, retryAt/);
  assert.match(source, /scan\.offersSeen \+= seen\.size/);
});

test("source and smoke requests use CATALOG_SOURCE_TIMEOUT_MS", async () => {
  const adapters = await import("node:fs/promises").then((fs) => fs.readFile("apps/web/lib/catalog/adapters.ts", "utf-8"));
  const smoke = await import("node:fs/promises").then((fs) => fs.readFile("scripts/catalog-smoke.mjs", "utf-8"));
  assert.match(adapters, /CATALOG_SOURCE_TIMEOUT_MS \|\| 15000/);
  assert.match(adapters, /AbortController/);
  assert.match(smoke, /CATALOG_SOURCE_TIMEOUT_MS \|\| 15000/);
  assert.match(smoke, /withSourceTimeout/);
});


test("Encar sample image limit stops downloading after configured maximum", async () => {
  resetJsonStorageForTests();
  const originalFetch = global.fetch;
  const previousLimit = process.env.CATALOG_MAX_IMAGES_PER_OFFER;
  const imageUrls: string[] = [];
  process.env.CATALOG_MAX_IMAGES_PER_OFFER = "1";
  (global as any).fetch = async (url: string) => {
    const href = String(url);
    if (href.includes("/v1/readside/vehicle/ENC_LIMIT")) {
      return new Response(JSON.stringify({ photos: [{ path: "/carphoto/one.jpg" }, { path: "/carphoto/two.jpg" }, { path: "/carphoto/three.jpg" }] }), { headers: { "content-type": "application/json" } });
    }
    imageUrls.push(href);
    return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-type": "image/jpeg", "content-length": "4" } });
  };
  try {
    const adapter = new EncarDirectAdapter();
    const offer = adapter.normalizeOffer({ Id: "ENC_LIMIT", Manufacturer: "Hyundai", Model: "Avante", FormYear: "2022", Price: 2000, Photo: "/carphoto/cover.jpg" });
    assert.ok(offer);
    const images = await adapter.fetchImages(offer!);
    assert.equal(images.length, 1);
    assert.equal(imageUrls.length, 1);
  } finally {
    if (previousLimit === undefined) delete process.env.CATALOG_MAX_IMAGES_PER_OFFER; else process.env.CATALOG_MAX_IMAGES_PER_OFFER = previousLimit;
    (global as any).fetch = originalFetch;
  }
});

test("production catalog activation source checks", async () => {
  const importer = await import("node:fs/promises").then((fs) => fs.readFile("apps/web/lib/catalog/importer.ts", "utf-8"));
  const sample = await import("node:fs/promises").then((fs) => fs.readFile("scripts/catalog-import-sample.mjs", "utf-8"));
  const pkg = await import("node:fs/promises").then((fs) => fs.readFile("package.json", "utf-8"));
  assert.match(pkg, /catalog:import:sample/);
  assert.match(sample, /sourceIds: \["encar_direct"\]/);
  assert.match(sample, /maxOffers: 20/);
  assert.match(sample, /maxDetails: 20/);
  assert.match(sample, /maxImagesPerOffer: 3/);
  assert.match(sample, /maxPages: 1/);
  assert.match(sample, /failOnZeroSaved: true/);
  assert.match(sample, /CATALOG_IMPORT_REPORT_FILE/);
  assert.match(importer, /production_import_requires_object_storage/);
  assert.match(importer, /YC_OBJECT_STORAGE_BUCKET/);
});

test("public UI uses live catalog and labels estimates honestly", async () => {
  const home = await import("node:fs/promises").then((fs) => fs.readFile("apps/web/app/(public)/page.tsx", "utf-8"));
  const results = await import("node:fs/promises").then((fs) => fs.readFile("apps/web/app/(public)/results/page.tsx", "utf-8"));
  const cars = await import("node:fs/promises").then((fs) => fs.readFile("apps/web/app/(public)/cars/page.tsx", "utf-8"));
  assert.match(home, /api\/catalog\/search\?pageSize=12/);
  assert.match(home, /NODE_ENV !== "production"/);
  assert.match(home, /ENABLE_DEMO_CATALOG/);
  assert.match(home, /Каталог обновляется/);
  assert.match(home, /href="\/cars"[^>]*>Каталог/);
  assert.match(results, /await searchOffers/);
  assert.match(results, /Актуальные автомобили/);
  assert.match(results, /Расчётный пример, не конкретный автомобиль/);
  assert.match(results, /offerSnapshot/);
  assert.doesNotMatch(cars, /нужен подключенный feed/);
  assert.match(cars, /Свежие автомобили пока загружаются/);
});

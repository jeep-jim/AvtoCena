import assert from "node:assert/strict";
import test from "node:test";
import { JsonPartnerFeedAdapter } from "../apps/web/lib/catalog/adapters";
import { persistCatalogOffers, searchOffers, publicOffer, CATALOG_CHUNK_SIZE } from "../apps/web/lib/catalog/storage";
import { resetJsonStorageForTests, readDataJson } from "../apps/web/lib/data";

process.env.JSON_STORAGE_DRIVER = "local";
process.env.CATALOG_IMAGE_CDN_URL = "https://img.avtocena.com";

const image = { id: "img1", url: "https://img.avtocena.com/catalog/images/japan/a.jpg", objectKey: "catalog/images/japan/a.jpg", size: 10, checksum: "abc", mimeType: "image/jpeg" };

test("catalog normalizes, deduplicates via stable id and hides operational metadata", async () => {
  resetJsonStorageForTests();
  const adapter = new JsonPartnerFeedAdapter("generic_json", "japan");
  const offer = adapter.normalizeOffer({ id: "A1", make: "Toyota", model: "Prius", year: 2021, price: 1200000, currency: "JPY", images: ["https://example.test/a.jpg"], sourceUrl: "https://source.example/lot" });
  assert.ok(offer);
  assert.equal(publicOffer({ ...offer!, images: [image] } as any).hasOwnProperty("operational"), false);
  assert.equal((publicOffer({ ...offer!, images: [image] } as any) as any).sourceUrl, undefined);
});

test("catalog chunks stay under 500 and search returns only offers with local photos", async () => {
  resetJsonStorageForTests();
  const now = new Date().toISOString();
  const offers: any[] = Array.from({ length: CATALOG_CHUNK_SIZE + 1 }, (_, i) => ({ id: `o${i}`, sourceId: "test", sourceOfferId: `${i}`, market: "japan", offerType: "fixed", status: "active", make: "Toyota", model: i % 2 ? "Prius" : "Aqua", year: 2020 + (i % 4), sourcePrice: 1000000, sourceCurrency: "JPY", priceMode: "fixed", images: [image], totalRub: 1500000 + i, calculationStatus: "ready", firstSeenAt: now, updatedAt: now, operational: {} }));
  offers.push({ ...offers[0], id: "no-photo", images: [] });
  await persistCatalogOffers(offers);
  const manifest = await readDataJson<any>("catalog/manifest.json", {});
  assert.equal(manifest.markets.japan.chunks.length, 2);
  const firstChunk = await readDataJson<any[]>(`catalog/offers/japan/${manifest.markets.japan.chunks[0]}.json`, []);
  assert.ok(firstChunk.length <= 500);
  const result = await searchOffers({ market: "japan", make: "Toyota", model: "Prius", sort: "totalRub", pageSize: 10 });
  assert.equal(result.items.length, 10);
  assert.ok(result.usedIndexShards[0].includes("catalog/indexes"));
  assert.equal(result.items.some((o: any) => o.id === "no-photo"), false);
});

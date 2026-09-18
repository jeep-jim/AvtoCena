import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { buildAiProductFeed, readPublishedAiProductFeed, readAiSitemapProjection, AI_PRODUCT_FEED_METADATA_PATH, AI_PRODUCT_FEED_PATH } from "../apps/web/lib/ai-discovery";
import type { JsonStorage } from "../apps/web/lib/data";
import { ObjectJsonStorage } from "../apps/web/lib/data";

test('sitemap requests share one full read, keep only URL fields, and retry a generation cutover', async () => {
  let generationId = 'sitemap-test-one', projectionGeneration = generationId, fullReads = 0;
  const storage = {async readJson(key: string) {
    if (key === 'catalog/manifest.json') return {generationId};
    fullReads++;
    await new Promise(resolve => setTimeout(resolve, 1));
    return {generationId: projectionGeneration, items: [{id: 'one', make: 'Toyota', model: 'Camry', year: 2026,
      updatedAt: '2026-09-18', cardImageUrl: '/car.jpg', calculationSnapshot: {unusedLargeData: 'x'.repeat(1000)}}]};
  }} as unknown as JsonStorage;
  const results = await Promise.all([readAiSitemapProjection(storage), readAiSitemapProjection(storage)]);
  assert.equal(fullReads, 1);
  assert.deepEqual(results[0]?.items, [{id: 'one', updatedAt: '2026-09-18', cardImageUrl: '/car.jpg'}]);
  generationId = 'sitemap-test-two';
  assert.equal(await readAiSitemapProjection(storage), null);
  projectionGeneration = generationId;
  assert.equal((await readAiSitemapProjection(storage))?.generationId, generationId);
  assert.equal(fullReads, 3);
});

test('published feed lookup reads small metadata only and rejects stale or missing objects', async () => {
  let generationId = 'active', exists = true;
  const reads: string[] = [];
  const metadata = {version: 1, generationId: 'active', objectPath: AI_PRODUCT_FEED_PATH, format: 'google-compatible-csv-gzip'};
  const storage = {
    async readJson(key: string) {
      reads.push(key);
      if (key === 'catalog/manifest.json') return { generationId };
      assert.equal(key, AI_PRODUCT_FEED_METADATA_PATH, 'must not load the 168 MB projection');
      return metadata;
    },
    async binaryExists(key: string) { assert.equal(key, AI_PRODUCT_FEED_PATH); return exists; },
  } as unknown as JsonStorage;
  assert.equal(await readPublishedAiProductFeed(storage), metadata);
  assert.deepEqual(reads.sort(), ['catalog/manifest.json', AI_PRODUCT_FEED_METADATA_PATH].sort());
  generationId = 'new-generation';
  assert.equal(await readPublishedAiProductFeed(storage), null);
  generationId = 'active'; exists = false;
  assert.equal(await readPublishedAiProductFeed(storage), null);
});

test("product feed keeps the full eligible snapshot and a Google-compatible header", () => {
  const feed = buildAiProductFeed({
    generationId: "gen_test",
    items: [
      {
        id: "car-1",
        market: "korea",
        make: "Kia",
        model: 'Model "S"',
        year: 2026,
        totalRub: 4_200_000,
        cardImageUrl: "/images/car-1.webp",
      },
      {
        id: "car-without-price",
        market: "korea",
        make: "Kia",
        model: "No price",
        year: 2026,
        cardImageUrl: "/images/car-2.webp",
      },
    ],
  });

  const csv = gunzipSync(feed.data).toString("utf8");
  assert.equal(feed.productCount, 1);
  assert.ok(csv.startsWith("\uFEFFid,title,description,link,image_link,availability,price,brand,identifier_exists,product_type\n"));
  assert.match(csv, /"car-1"/);
  assert.match(csv, /Model ""S""/);
  assert.doesNotMatch(csv, /car-without-price/);
});

test("Object Storage download URL is a bounded SigV4 presigned GET", async () => {
  const keys = [
    "YC_OBJECT_STORAGE_ENDPOINT",
    "YC_OBJECT_STORAGE_REGION",
    "YC_OBJECT_STORAGE_BUCKET",
    "YC_OBJECT_STORAGE_ACCESS_KEY_ID",
    "YC_OBJECT_STORAGE_SECRET_ACCESS_KEY",
    "YC_OBJECT_STORAGE_PREFIX",
  ] as const;
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    YC_OBJECT_STORAGE_ENDPOINT: "https://storage.example.test",
    YC_OBJECT_STORAGE_REGION: "ru-central1",
    YC_OBJECT_STORAGE_BUCKET: "catalog-bucket",
    YC_OBJECT_STORAGE_ACCESS_KEY_ID: "test-access",
    YC_OBJECT_STORAGE_SECRET_ACCESS_KEY: "test-secret",
    YC_OBJECT_STORAGE_PREFIX: "prod",
  });

  try {
    const signed = await new ObjectJsonStorage().createBinaryDownloadUrl("catalog/public/feeds/openai-products.csv.gz", 900);
    const url = new URL(signed);
    assert.equal(url.origin, "https://storage.example.test");
    assert.equal(url.pathname, "/catalog-bucket/prod/catalog/public/feeds/openai-products.csv.gz");
    assert.equal(url.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
    assert.equal(url.searchParams.get("X-Amz-Expires"), "900");
    assert.match(url.searchParams.get("X-Amz-Credential") || "", /^test-access\/\d{8}\/ru-central1\/s3\/aws4_request$/);
    assert.match(url.searchParams.get("X-Amz-Signature") || "", /^[a-f0-9]{64}$/);
  } finally {
    for (const key of keys) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

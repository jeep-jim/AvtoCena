import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("apps/web/app/(public)/cars/offer/[id]/page.tsx", "utf8");
const layout = fs.readFileSync("apps/web/app/(public)/cars/offer/[id]/layout.tsx", "utf8");
const loading = fs.readFileSync("apps/web/app/(public)/cars/offer/[id]/loading.tsx", "utf8");
const data = fs.readFileSync("apps/web/lib/catalog/offer-page-data.ts", "utf8");
const storage = fs.readFileSync("apps/web/lib/catalog/storage.ts", "utf8");
const preloader = fs.readFileSync("apps/web/components/layout/RoutePreloader.tsx", "utf8");
const card = fs.readFileSync("apps/web/components/catalog/CatalogCard.tsx", "utf8");
const deploy = fs.readFileSync(".github/workflows/deploy-yandex.yml", "utf8");

test("offer navigation swaps the catalog for an immediate route skeleton", () => {
  assert.match(loading, /main className="ac-offer-page/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /Загружаем карточку автомобиля/);
});

test("similar offers stream after the primary offer instead of blocking it", () => {
  const offerPage = page.slice(page.indexOf("export default async function OfferPage"));
  const beforeReturn = offerPage.slice(0, offerPage.indexOf("return <main"));
  assert.doesNotMatch(beforeReturn, /await searchOffers/);
  assert.match(page, /<Suspense fallback=\{<SimilarOffersFallback \/>\}>/);
  assert.match(page, /async function SimilarOffers/);
});

test("metadata and page share one memoized offer lookup per request", () => {
  assert.match(data, /unstable_cache\(/);
  assert.match(data, /catalog-offer-page-v1/);
  assert.match(data, /revalidate: 60/);
  assert.match(data, /cache\(\(id: string\) => getOfferAcrossRequests\(id\)\)/);
  assert.match(page, /getOfferForPage\(id\)/);
  assert.match(layout, /getOfferForPage\(id\)/);
});

test("offer navigation stays visibly pending and warms immutable lookup data", () => {
  assert.match(preloader, /MAX_VISIBLE_MS = 15000/);
  assert.match(card, /<Link href=\{href\} prefetch/);
  assert.match(storage, /offerLocationIndexCache/);
  assert.match(storage, /offerChunkCache/);
  assert.match(storage, /offerLookupCacheGeneration !== manifest\.generationId/);
  assert.match(storage, /CATALOG_MANIFEST_CACHE_MS \|\| 60_000/);
});

test("production keeps one warm container and serves navigation bursts in-process", () => {
  assert.match(deploy, /revision-concurrency: 8/);
  assert.match(deploy, /revision-provisioned: 1/);
  assert.match(deploy, /Warm public catalog and first offer/);
  assert.match(deploy, /cars\/offer\/\$offer_id/);
});

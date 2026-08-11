import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("apps/web/app/(public)/cars/offer/[id]/page.tsx", "utf8");
const layout = fs.readFileSync("apps/web/app/(public)/cars/offer/[id]/layout.tsx", "utf8");
const loading = fs.readFileSync("apps/web/app/(public)/cars/offer/[id]/loading.tsx", "utf8");
const data = fs.readFileSync("apps/web/lib/catalog/offer-page-data.ts", "utf8");

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
  assert.match(data, /cache\(\(id: string\) => getOffer\(id\)\)/);
  assert.match(page, /getOfferForPage\(id\)/);
  assert.match(layout, /getOfferForPage\(id\)/);
});

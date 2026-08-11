import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("apps/web/app/(public)/page.tsx", "utf8");
const client = fs.readFileSync("apps/web/components/home/HomePageClient.tsx", "utf8");

test("home page server-renders six indexed offers for every public market", () => {
  assert.match(page, /readHomeCatalogSnapshot\(6\)/);
  assert.match(page, /initialOffers=\{initialCatalog\.items\}/);
  assert.match(page, /initialMarketCounts=\{initialCatalog\.marketCounts\}/);
  assert.match(page, /initialCount=\{initialCatalog\.total\}/);
});

test("home snapshot reads shared indexes once instead of seven complete searches", () => {
  const storage = fs.readFileSync("apps/web/lib/catalog/storage.ts", "utf8");
  const start = storage.indexOf("export async function readHomeCatalogSnapshot");
  const end = storage.indexOf("\nfunction isPrivateHost", start);
  const implementation = storage.slice(start, end);
  assert.match(implementation, /offers-by-id\.json/);
  assert.match(implementation, /order-updatedAt\.json/);
  assert.match(implementation, /market\/\$\{cleanShard\(market\)\}\.json/);
  assert.doesNotMatch(implementation, /searchOffers\(/);
});

test("home client keeps the server snapshot while background refresh runs", () => {
  assert.match(client, /useState<Item\[\]>\(\(\) => initialOffers\.flatMap/);
  assert.match(client, /useState<Record<string, number>>\(initialMarketCounts\)/);
  assert.match(client, /Keep the server-rendered snapshot on a transient refresh failure/);
  assert.doesNotMatch(client, /catch \{ if \(!cancelled\) setItems\(\[\]\); \}/);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("apps/web/app/(public)/page.tsx", "utf8");
const client = fs.readFileSync("apps/web/components/home/HomePageClient.tsx", "utf8");

test("home page server-renders six indexed offers for every public market", () => {
  assert.match(page, /PUBLIC_CATALOG_MARKETS\.map/);
  assert.match(page, /searchOffers\(\{ market, page: 1, pageSize: 6, sort: "updatedAt" \}\)/);
  assert.match(page, /initialOffers=\{initialCatalog\.offers\}/);
  assert.match(page, /initialMarketCounts=\{initialCatalog\.marketCounts\}/);
  assert.match(page, /initialCount=\{initialCatalog\.total\}/);
});

test("home client keeps the server snapshot while background refresh runs", () => {
  assert.match(client, /useState<Item\[\]>\(\(\) => initialOffers\.flatMap/);
  assert.match(client, /useState<Record<string, number>>\(initialMarketCounts\)/);
  assert.match(client, /Keep the server-rendered snapshot on a transient refresh failure/);
  assert.doesNotMatch(client, /catch \{ if \(!cancelled\) setItems\(\[\]\); \}/);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("apps/web/app/(public)/page.tsx", "utf8");
const client = fs.readFileSync("apps/web/components/home/HomePageClient.tsx", "utf8");
const homeRoute = fs.readFileSync("apps/web/app/api/catalog/home/route.ts", "utf8");

test("home page does not block its first render on catalog storage", () => {
  assert.doesNotMatch(page, /readHomeCatalogSnapshot/);
  assert.doesNotMatch(page, /loadInitialCatalog/);
  assert.match(page, /<HomePageClient initialCity=\{fromQuery \|\| fromCookie\} \/>/);
});

test("home API reads shared indexes once instead of seven complete searches", () => {
  const storage = fs.readFileSync("apps/web/lib/catalog/storage.ts", "utf8");
  const start = storage.indexOf("export async function readHomeCatalogSnapshot");
  const end = storage.indexOf("\nfunction isPrivateHost", start);
  const implementation = storage.slice(start, end);
  assert.match(homeRoute, /readHomeCatalogSnapshot\(6\)/);
  assert.match(implementation, /offers-by-id\.json/);
  assert.match(implementation, /order-updatedAt\.json/);
  assert.match(implementation, /market\/\$\{cleanShard\(market\)\}\.json/);
  assert.doesNotMatch(implementation, /searchOffers\(/);
});

test("home client renders a stable skeleton and loads one catalog snapshot in the background", () => {
  assert.match(client, /function CatalogLoadingSkeleton/);
  assert.match(client, /catalogStatus === "loading" \? <CatalogLoadingSkeleton \/>/);
  assert.match(client, /fetch\(`\/api\/catalog\/home\?_=/);
  assert.doesNotMatch(client, /marketIds\.map\(\(id\) => fetch\(`\/api\/catalog\/search\?market=/);
  assert.match(client, /setCatalogStatus\("ready"\)/);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dealerDemo = fs.readFileSync(new URL("../apps/web/components/dealers/DealerDemoDashboard.tsx", import.meta.url), "utf8");
const marketCountsRoute = fs.readFileSync(new URL("../apps/web/app/(public)/api/catalog/market-counts/route.ts", import.meta.url), "utf8");
const carsPage = fs.readFileSync(new URL("../apps/web/app/(public)/cars/page.tsx", import.meta.url), "utf8");

test("dealer demo reads the same published catalog generation as the public catalog", () => {
  assert.match(marketCountsRoute, /readPublicCatalogMarketCounts/);
  assert.match(dealerDemo, /\/api\/catalog\/market-counts/);
  assert.match(dealerDemo, /действующего опубликованного каталога/);
  assert.match(carsPage, /searchOffers\(\{ market: market\.id/);
  assert.doesNotMatch(carsPage, /readMarketOffers/);
  assert.doesNotMatch(dealerDemo, /5 240|4 680|2 175|1 486|6 663|1 142|1 019/);
});

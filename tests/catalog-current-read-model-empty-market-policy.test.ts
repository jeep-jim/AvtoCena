import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-current-read-models.yml", import.meta.url), "utf8");
const publisher = fs.readFileSync(new URL("../scripts/catalog-publish-current-read-models.mjs", import.meta.url), "utf8");

test("current read-model workflow exposes failures hidden by tee", () => {
  assert.match(workflow, /set -o pipefail/);
});

test("only an explicitly absent allowlisted market may be empty", () => {
  assert.match(workflow, /CATALOG_ALLOW_EMPTY_MARKETS:\s*["']georgia["']/);
  assert.match(publisher, /CATALOG_ALLOW_EMPTY_MARKETS/);
  assert.match(publisher, /Object\.prototype\.hasOwnProperty\.call\(marketCounts, market\)/);
  assert.match(publisher, /allowedAbsentMarkets/);
  assert.match(publisher, /if \(hasMarket\(market\)\) return Number\(marketCounts\[market\] \|\| 0\) <= 0/);
  assert.match(publisher, /expectedProjectionMarkets = requiredMarkets\.length - allowedAbsentMarkets\.length/);
  assert.match(publisher, /result\.projectionMarkets < expectedProjectionMarkets/);
  assert.match(publisher, /missingMarkets\.length/);
});

const homeClient = fs.readFileSync(new URL("../apps/web/components/home/HomePageClient.tsx", import.meta.url), "utf8");

test("homepage never erases an admitted market while a compact read-model shard catches up", () => {
  assert.doesNotMatch(homeClient, /isCrediblePublicOffer\(raw/);
  assert.match(homeClient, /nextMarketItems\.length \? nextMarketItems : previousMarketItems/);
  assert.match(homeClient, /incomingCount > 0 \? incomingCount : previousCount/);
  assert.match(homeClient, /incomingTotal > 0 \? incomingTotal : previousCount/);
});

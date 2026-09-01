import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { PUBLIC_CATALOG_MARKETS } from "../apps/web/lib/catalog/runtime-config";
import { MARKET_IDS } from "../apps/web/lib/settings-validation";

const activeMarkets = ["korea", "china", "japan", "uae", "europe", "georgia"];
const storageSource = fs.readFileSync(new URL("../apps/web/lib/catalog/storage.ts", import.meta.url), "utf8");
const catalogPageSource = fs.readFileSync(new URL("../apps/web/app/(public)/cars/page.tsx", import.meta.url), "utf8");
const engineTypes = fs.readFileSync(new URL("../packages/engine/src/types/index.ts", import.meta.url), "utf8");
const queueWorkflow = fs.readFileSync(new URL("../.github/workflows/catalog-v3-sequential-queue.yml", import.meta.url), "utf8");
const retirementWorkflow = fs.readFileSync(new URL("../.github/workflows/catalog-republish-active-markets.yml", import.meta.url), "utf8");
const retirementScript = fs.readFileSync(new URL("../scripts/catalog-republish-active-markets.mjs", import.meta.url), "utf8");

test("public runtime and business settings expose exactly six active markets", () => {
  assert.deepEqual(PUBLIC_CATALOG_MARKETS, activeMarkets);
  assert.deepEqual([...MARKET_IDS].sort(), [...activeMarkets].sort());
  assert.match(engineTypes, /export type Market = "japan" \| "china" \| "korea" \| "uae" \| "europe" \| "georgia";/);
});

test("retired markets cannot re-enter public reads from an older generation", () => {
  assert.match(storageSource, /function isActivePublicCatalogMarket/);
  assert.match(storageSource, /isActivePublicCatalogMarket\(o\.market\)/);
  assert.match(storageSource, /MARKETS\.filter\(\(market\) => Number\(manifest\.markets\?\.\[market\]\?\.count/);
  assert.match(storageSource, /!isActivePublicCatalogMarket\(params\.market\)/);
  assert.match(catalogPageSource, /PUBLIC_CATALOG_MARKET_SET\.has/);
  assert.match(catalogPageSource, /redirect\("\/cars"\)/);
});

test("the production queue has no seventh market job", () => {
  assert.doesNotMatch(queueWorkflow, /kyrgyzstan|Кыргызстан|mashina\.kg/i);
  assert.equal((queueWorkflow.match(/^  [a-z][a-z0-9_-]+:\s*$/gm) || []).filter((line) => /korea|china|japan|uae|europe|georgia/.test(line)).length, 6);
});

test("retired inventory is removed by one serialized byte-stable publication", () => {
  assert.match(retirementWorkflow, /group: catalog-live-daily-working-markets/);
  assert.match(retirementWorkflow, /cancel-in-progress: false/);
  assert.match(retirementWorkflow, /CATALOG_AUDIT_ASSERT_MARKETS: korea,china,japan,uae,europe,georgia/);
  assert.match(retirementScript, /retiredMarketIds = beforeMarketIds\.filter/);
  assert.match(retirementScript, /preservePublicOffersByMarket/);
  assert.match(retirementScript, /beforePersistValidate/);
  assert.match(retirementScript, /beforePublishValidate/);
  assert.match(retirementScript, /expectedHashes/);
  assert.match(retirementScript, /catalog_active_markets_postwrite_mismatch/);
});

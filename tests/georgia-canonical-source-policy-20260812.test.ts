import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { catalogImportSources } from "../apps/web/lib/catalog/importer";
import { catalogV2SourceIds, assertCatalogV2SourceRegistry } from "../apps/web/lib/catalog/catalog-v2-source-registry";
import { isCatalogMarketSourceAllowed } from "../apps/web/lib/catalog/offer-quality";
import { SCALE_MARKET_SOURCE_IDS } from "../apps/web/lib/catalog/scale-market-sources";

const bannedGeorgiaSources = ["auto_georgia_open", "mymarket_georgia_open", "ss_georgia_open"];
const dailyWorkflow = fs.readFileSync(".github/workflows/catalog-live-daily-working-markets.yml", "utf8");
const directWorkflow = fs.readFileSync(".github/workflows/catalog-live-recovery-uae-georgia-direct.yml", "utf8");

test("Georgia registry contains only MyAuto and AutoPapa", () => {
  assert.deepEqual(catalogV2SourceIds("georgia"), ["myauto_georgia_list", "autopapa_georgia_open"]);
  assert.equal(assertCatalogV2SourceRegistry(), true);
});

test("Georgia importer cannot expose banned fallback adapters", () => {
  const ids = new Set(catalogImportSources.map((source) => source.sourceId));
  assert.equal(ids.has("myauto_georgia_list"), true);
  assert.equal(ids.has("autopapa_georgia_open"), true);
  for (const sourceId of bannedGeorgiaSources) {
    assert.equal(ids.has(sourceId), false, `${sourceId} must never be available to the importer`);
  }
});

test("Georgia production importer uses the dedicated AutoPapa adapter", async () => {
  const source = catalogImportSources.find((candidate) => candidate.sourceId === "autopapa_georgia_open");
  assert.ok(source, "dedicated AutoPapa source must be registered");
  const health = await source.healthCheck();
  assert.match(String(health.message || ""), /AutoPapa canonical Yandex parser/i);
});

test("Georgia scale source definitions contain AutoPapa but no banned fallback sources", () => {
  const ids = new Set(SCALE_MARKET_SOURCE_IDS);
  assert.equal(ids.has("autopapa_georgia_open"), true);
  for (const sourceId of bannedGeorgiaSources) {
    assert.equal(ids.has(sourceId), false, `${sourceId} must not exist in scale source configs`);
  }
});

test("Georgia canonical quality permanently rejects non-company sources", () => {
  assert.equal(isCatalogMarketSourceAllowed({ market: "georgia", sourceId: "myauto_georgia_list" } as any), true);
  assert.equal(isCatalogMarketSourceAllowed({ market: "georgia", sourceId: "myauto_georgia_exact" } as any), true);
  assert.equal(isCatalogMarketSourceAllowed({ market: "georgia", sourceId: "autopapa_georgia_open" } as any), true);
  for (const sourceId of bannedGeorgiaSources) {
    assert.equal(isCatalogMarketSourceAllowed({ market: "georgia", sourceId } as any), false);
  }
});

test("scheduled daily Georgia collection is canonical-only", () => {
  assert.match(dailyWorkflow, /market: georgia, source: myauto_georgia_list/);
  assert.match(dailyWorkflow, /market: georgia, source: autopapa_georgia_open/);
  for (const sourceId of bannedGeorgiaSources) {
    assert.doesNotMatch(dailyWorkflow, new RegExp(`market: georgia, source: ${sourceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
});

test("current Georgia publishers use model-year quota semantics", () => {
  assert.match(dailyWorkflow, /CATALOG_MAX_OFFERS_PER_MODEL_YEAR:\s*"20"/);
  assert.doesNotMatch(dailyWorkflow, /CATALOG_MAX_OFFERS_PER_MODEL:(?!_YEAR)/);
  assert.match(directWorkflow, /CATALOG_MAX_OFFERS_PER_MODEL_YEAR:\s*"20"/);
  assert.match(directWorkflow, /CATALOG_AUDIT_MAX_PER_MODEL_YEAR:\s*"20"/);
  assert.match(directWorkflow, /maxPerExactModelYear/);
  assert.doesNotMatch(directWorkflow, /CATALOG_MAX_OFFERS_PER_MODEL:(?!_YEAR)/);
  assert.doesNotMatch(directWorkflow, /CATALOG_AUDIT_MAX_PER_MODEL:(?!_YEAR)/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { catalogImportSources } from "../apps/web/lib/catalog/importer";
import { catalogV2SourceIds, assertCatalogV2SourceRegistry } from "../apps/web/lib/catalog/catalog-v2-source-registry";
import { isCatalogMarketSourceAllowed } from "../apps/web/lib/catalog/offer-quality";
import { SCALE_MARKET_SOURCE_IDS } from "../apps/web/lib/catalog/scale-market-sources";

const bannedGeorgiaSources = ["auto_georgia_open", "mymarket_georgia_open", "ss_georgia_open"];

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

import assert from "node:assert/strict";
import test from "node:test";
import {
  CATALOG_V2_SOURCE_SLOTS,
  assertCatalogV2SourceRegistry,
  catalogV2AnchorSourceIds,
  catalogV2RequiredSourceIds,
  catalogV2SourceIds,
} from "../apps/web/lib/catalog/catalog-v2-source-registry";
import { REQUIRED_CATALOG_SOURCES } from "../apps/web/lib/catalog/required-catalog-sources";
import type { CatalogMarket } from "../apps/web/lib/catalog/types";

const APPROVED_SOURCE_URLS: Record<CatalogMarket, readonly string[]> = {
  uae: [
    "https://uae.dubizzle.com/",
    "https://www.dubicars.com/",
  ],
  korea: [
    "https://www.encar.com/",
    "https://www.kcar.com/",
  ],
  europe: [
    "https://www.mobile.de/",
    "https://www.autoscout24.com/",
  ],
  georgia: [
    "https://www.myauto.ge/",
    "https://autopapa.ge/",
  ],
  china: [
    "https://www.che168.com/",
    "https://www.dongchedi.com/",
    "https://www.guazi.com/",
    "https://www.autohome.com.cn/",
  ],
  japan: [
    "https://www.goo-net-exchange.com/usedcars/",
    "https://jpauc.com/auction/past",
    "https://carvector.com/stat",
    "https://prestigemotorsport.com.au/auctions/",
    "https://www.auctiondatasearch.jp/",
    "https://jp.center/",
  ],
  kyrgyzstan: [
    "https://www.mashina.kg/",
  ],
};

test("the 19 owner-approved catalog sources are permanently encoded", () => {
  const total = Object.values(REQUIRED_CATALOG_SOURCES).reduce((sum, sources) => sum + sources.length, 0);
  assert.equal(total, 19);

  for (const [marketName, expectedUrls] of Object.entries(APPROVED_SOURCE_URLS)) {
    const market = marketName as CatalogMarket;
    assert.deepEqual(
      REQUIRED_CATALOG_SOURCES[market].map((source) => source.canonicalUrl),
      expectedUrls,
      `${market} mandatory URLs changed`,
    );
  }
});

test("every approved source is required, anchored and included in collection", () => {
  assert.equal(assertCatalogV2SourceRegistry(), true);

  for (const marketName of Object.keys(APPROVED_SOURCE_URLS)) {
    const market = marketName as CatalogMarket;
    const requiredIds = catalogV2RequiredSourceIds(market);
    const collectibleIds = new Set(catalogV2SourceIds(market));

    assert.deepEqual(catalogV2AnchorSourceIds(market), requiredIds);

    for (const sourceId of requiredIds) {
      const registered = CATALOG_V2_SOURCE_SLOTS[market].find((source) => source.sourceId === sourceId);
      assert.ok(registered, `${market}:${sourceId} missing from registry`);
      assert.equal(registered.required, true, `${market}:${sourceId} is no longer required`);
      assert.equal(registered.anchor, true, `${market}:${sourceId} is no longer anchored`);
      assert.ok(collectibleIds.has(sourceId), `${market}:${sourceId} excluded from parser collection`);
    }
  }
});

test("Autohome new cars and JP Center are parser sources, not knowledge-only exclusions", () => {
  assert.ok(catalogV2SourceIds("china").includes("autohome_new_china_open"));
  assert.ok(catalogV2SourceIds("japan").includes("jpcenter_japan_catalog_open"));
  assert.notEqual(
    CATALOG_V2_SOURCE_SLOTS.china.find((source) => source.sourceId === "autohome_new_china_open")?.role,
    "knowledge",
  );
  assert.notEqual(
    CATALOG_V2_SOURCE_SLOTS.japan.find((source) => source.sourceId === "jpcenter_japan_catalog_open")?.role,
    "knowledge",
  );
});

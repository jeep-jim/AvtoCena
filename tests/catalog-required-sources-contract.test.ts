import assert from "node:assert/strict";
import test from "node:test";
import {
  CATALOG_V2_SOURCE_SLOTS,
  assertCatalogV2SourceRegistry,
  catalogV2AnchorSourceIds,
  catalogV2RequiredSourceIds,
  catalogV2SourceIds,
} from "../apps/web/lib/catalog/catalog-v2-source-registry";
import { REQUIRED_CATALOG_SOURCES, requiredCatalogSourceIds, requiredCatalogSourceUrls, isAllowedCatalogSourceId, isAllowedCatalogSourceUrl } from "../apps/web/lib/catalog/required-catalog-sources";
import type { CatalogMarket } from "../apps/web/lib/catalog/types";

const APPROVED_SOURCES: Record<CatalogMarket, readonly (readonly [string, string])[]> = {
  uae: [
    ["dubizzle_uae_open", "https://uae.dubizzle.com/"],
    ["dubicars_uae_exact", "https://www.dubicars.com/"],
  ],
  korea: [
    ["encar_direct", "https://www.encar.com/"],
    ["kcar_korea_open", "https://www.kcar.com/"],
  ],
  europe: [
    ["mobile_de_open", "https://www.mobile.de/"],
    ["autoscout_europe_open", "https://www.autoscout24.com/"],
  ],
  georgia: [
    ["myauto_georgia_list", "https://www.myauto.ge/"],
    ["autopapa_georgia_open", "https://autopapa.ge/"],
  ],
  china: [
    ["autohome_used_china_open", "https://www.che168.com/"],
    ["dongchedi_china_open", "https://www.dongchedi.com/"],
    ["guazi_china_open", "https://www.guazi.com/"],
    ["autohome_new_china_open", "https://www.autohome.com.cn/"],
  ],
  japan: [
    ["drom_japan_stat", "https://www.drom.ru/world/japan/"],
    ["jpauc_japan_past_open", "https://jpauc.com/auction/past"],
    ["carvector_japan_stat_open", "https://carvector.com/stat"],
    ["prestige_japan_auctions_open", "https://prestigemotorsport.com.au/auctions/"],
    ["auctiondatasearch_japan_open", "https://www.auctiondatasearch.jp/"],
    ["jpcenter_japan_catalog_open", "https://jp.center/"],
  ],
};

test("the 18 owner-approved catalog source ids and domains are permanently encoded for six markets", () => {
  const total = Object.values(REQUIRED_CATALOG_SOURCES).reduce((sum, sources) => sum + sources.length, 0);
  assert.equal(total, 18);
  assert.deepEqual(Object.keys(REQUIRED_CATALOG_SOURCES).sort(), ["china", "europe", "georgia", "japan", "korea", "uae"]);

  for (const [marketName, expectedSources] of Object.entries(APPROVED_SOURCES)) {
    const market = marketName as CatalogMarket;
    assert.deepEqual(
      REQUIRED_CATALOG_SOURCES[market].map((source) => [source.sourceId, source.canonicalUrl]),
      expectedSources,
      `${market} mandatory source ids or URLs changed`,
    );
  }
});

test("every approved source is required, anchored and included in collection", () => {
  assert.equal(assertCatalogV2SourceRegistry(), true);

  for (const marketName of Object.keys(APPROVED_SOURCES)) {
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


test("retired and malformed persisted markets fail closed without crashing publication", () => {
  for (const market of ["kyrgyzstan", "", undefined, null, "constructor", "toString", "__proto__"] as unknown as CatalogMarket[]) {
    assert.equal(isAllowedCatalogSourceId(market, "encar_direct"), false);
    assert.equal(isAllowedCatalogSourceUrl(market, "encar_direct", "https://www.encar.com/"), false);
    assert.deepEqual(requiredCatalogSourceIds(market), []);
    assert.deepEqual(requiredCatalogSourceUrls(market), []);
  }
  assert.equal(isAllowedCatalogSourceId("korea", "encar_direct"), true);
  assert.equal(isAllowedCatalogSourceId("china", "encar_direct"), false);
});


test("Che168 export and lookalike hosts cannot enter domestic collection or publication", () => {
 for (const host of ["global.che168.com","globalapi.che168.com","che168.com.evil.test","other.che168.com"]) {
  assert.equal(isAllowedCatalogSourceUrl("china","autohome_used_china_open",`https://${host}/en/detail/59848501`),false);
 }
 for (const host of ["www.che168.com","che168.com","m.che168.com","dealers.che168.com"]) {
  assert.equal(isAllowedCatalogSourceUrl("china","autohome_used_china_open",`https://${host}/dealer/1/59848501.html`),true);
 }
});

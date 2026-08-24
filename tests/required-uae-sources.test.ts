import assert from "node:assert/strict";
import test from "node:test";
import { REQUIRED_CATALOG_SOURCES, requiredCatalogSourceIds } from "../apps/web/lib/catalog/required-catalog-sources";

test("UAE required anchors are the two independently productive exact sources", () => {
  assert.deepEqual(requiredCatalogSourceIds("uae"), ["carswitch_uae_open", "dubicars_uae_exact"]);
  assert.deepEqual(REQUIRED_CATALOG_SOURCES.uae.map((source) => source.canonicalUrl), ["https://carswitch.com/", "https://www.dubicars.com/"]);
  assert.equal(requiredCatalogSourceIds("uae").includes("dubizzle_uae_open"), false);
});

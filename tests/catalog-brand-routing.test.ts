import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  catalogBrandMatches,
  resolveCatalogBrandBySlug,
} from "../apps/web/lib/catalog/catalog-brand-directory";

test("brand routes resolve both legacy and source-backed V2 identities", async () => {
  const [mercedes, aito] = await Promise.all([
    resolveCatalogBrandBySlug("mercedes"),
    resolveCatalogBrandBySlug("aito"),
  ]);
  assert.equal(mercedes?.name, "Mercedes-Benz");
  assert.equal(mercedes?.slug, "mercedes-benz");
  assert.equal(aito?.name, "AITO");
  assert.equal(catalogBrandMatches(mercedes!, "梅赛德斯-奔驰"), true);
});

test("brand directory is filtered by live catalog facets", () => {
  const source = fs.readFileSync(new URL("../apps/web/lib/catalog/catalog-brand-directory.ts", import.meta.url), "utf8");
  assert.match(source, /const activeBrandSlugs = new Set\(\(facets\.makes \|\| \[\]\)/);
  assert.match(source, /\.filter\(\(brand\) => activeBrandSlugs\.has/);
});

test("a brand alias cannot make unrelated catalog makes match", () => {
  const emc = { name: "EMC", slug: "emc", dromSlug: "emc", aliases: ["EMC Auto"] };
  assert.equal(catalogBrandMatches(emc, "EMC"), true);
  assert.equal(catalogBrandMatches(emc, "EMC Auto"), true);
  assert.equal(catalogBrandMatches(emc, "Audi"), false);
  assert.equal(catalogBrandMatches(emc, "Mercedes-Benz"), false);
});

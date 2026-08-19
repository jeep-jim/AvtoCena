import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogBrandMatches,
  readCatalogBrandDirectory,
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

test("encyclopedia brand directory is not limited to the legacy Drom list", async () => {
  const brands = await readCatalogBrandDirectory();
  assert.ok(brands.length >= 245);
  assert.equal(new Set(brands.map((brand) => brand.slug)).size, brands.length);
  assert.ok(brands.some((brand) => brand.name === "Mercedes-Benz"));
  assert.equal(brands.filter((brand) => brand.slug === "audi").length, 1);
  assert.equal(brands.some((brand) => brand.slug === "audi-china"), false);
  assert.equal(brands.filter((brand) => brand.slug === "changan").length, 1);
  assert.equal(brands.some((brand) => ["changan-nevo", "oshan"].includes(brand.slug)), false);
});

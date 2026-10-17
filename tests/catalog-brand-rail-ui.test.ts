import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const rail = fs.readFileSync(new URL("../apps/web/components/catalog/BrandLogoRail.tsx", import.meta.url), "utf8");
const filters = fs.readFileSync(new URL("../apps/web/components/catalog/CatalogFilters.tsx", import.meta.url), "utf8");
const modelDirectory = fs.readFileSync(new URL("../apps/web/lib/catalog/model-directory.ts", import.meta.url), "utf8");
const brandCounts = fs.readFileSync(new URL("../apps/web/app/api/catalog/brand-counts/route.ts", import.meta.url), "utf8");

test("catalog brand directory keeps homepage navigation but supports catalog multi-select", () => {
  assert.match(rail, /homeBrandDirectory[\s\S]*\/cars\/brand\/\$\{catalogBrandSlug\(brand\)\}/);
  assert.match(rail, /selectedBrands/);
  assert.match(rail, /selectedBrandKeys/);
  assert.match(rail, /ordered\.join\(","\)/);
  assert.match(rail, /Очистить/);
  assert.match(rail, /aria-label="Выбрано">✓/);
  assert.match(filters, /splitMakeValues/);
  assert.match(filters, /key: `make:\$\{make\}`/);
});

test("brand counts and brand landing use compact projection summaries", () => {
  assert.match(brandCounts, /readCatalogBrandCounts/);
  assert.doesNotMatch(brandCounts, /searchOffers/);
  assert.match(modelDirectory, /readCatalogBrandModelCounts/);
  assert.doesNotMatch(modelDirectory, /readMarketOffers/);
  assert.doesNotMatch(modelDirectory, /findVehicleModel\(offer\)/);
});

test("brand rail leads with popular makes and never repeats the AvtoCena favicon as a missing logo", () => {
  assert.match(rail, /const FEATURED_BRANDS = \[\s*"Toyota", "BMW", "Mercedes-Benz", "Audi", "Volkswagen"/);
  assert.match(rail, /\.sort\(compareBrands\)/);
  assert.doesNotMatch(rail, /`\/favicon-\$\{theme\}\.svg`/);
  assert.match(rail, /sourceIndex >= sources\.length/);
});

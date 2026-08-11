import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { catalogFilterOptions } from "../apps/web/lib/catalog/filter-options";

test("selected catalog filters stay visible even when the result facet is empty", () => {
  const options = [
    { value: "", label: "Любой кузов" },
    { value: "sedan", label: "Седан" },
    { value: "suv", label: "Кроссовер" },
  ];
  assert.deepEqual(catalogFilterOptions(options, [], "sedan"), [options[0], options[1]]);
  assert.equal(catalogFilterOptions(options, [], "custom-body")[1]?.value, "custom-body");
});

test("electric filter loads one facet response instead of every catalog page", () => {
  const source = fs.readFileSync("apps/web/components/catalog/CatalogFilters.tsx", "utf8");
  assert.match(source, /fuel=electric&pageSize=1&includeFacets=1/);
  assert.doesNotMatch(source, /Array\.from\(\{ length: pages - 1/);
});

test("catalog filter forms can be applied and show the active query", () => {
  const source = fs.readFileSync("apps/web/components/catalog/CatalogFilters.tsx", "utf8");
  assert.match(source, /type="submit"/);
  assert.match(source, /Показать автомобили/);
  assert.match(source, /aria-label="Выбранные параметры"/);
  assert.match(source, /key=\{`desktop-\$\{formKey\}`\}/);
  assert.match(source, /key=\{`mobile-\$\{formKey\}`\}/);
});

test("the single public catalog search route owns filtered facets and live rates", () => {
  assert.equal(fs.existsSync("apps/web/app/api/catalog/search/route.ts"), false);
  const route = fs.readFileSync("apps/web/app/(public)/api/catalog/search/route.ts", "utf8");
  assert.match(route, /readCatalogFacets\(query\)/);
  assert.match(route, /includeRates/);
  assert.match(route, /hasPrice/);
});

test("preliminary electrified cards show a compact 30-minute-power status", () => {
  const card = fs.readFileSync("apps/web/components/catalog/CatalogCard.tsx", "utf8");
  assert.match(card, /thirtyMinutePowerMissing = isElectrified && !powerDisplay/);
  assert.match(card, /30 мин: уточняется/);
  assert.match(card, /Максимальная 30-минутная мощность уточняется по официальному документу/);
});

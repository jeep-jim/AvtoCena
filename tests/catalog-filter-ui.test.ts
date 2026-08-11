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

test("catalog filters apply automatically and show the active query", () => {
  const source = fs.readFileSync("apps/web/components/catalog/CatalogFilters.tsx", "utf8");
  assert.match(source, /router\.replace/);
  assert.match(source, /catalogQuery/);
  assert.doesNotMatch(source, /Показать автомобили/);
  assert.doesNotMatch(source, /type="submit"/);
  assert.match(source, /aria-label="Выбранные параметры"/);
  assert.match(source, /key=\{`desktop-\$\{formKey\}`\}/);
  assert.match(source, /key=\{`mobile-\$\{formKey\}`\}/);
});

test("catalog filters use direct range inputs, quick presets and a real mobile bottom sheet", () => {
  const source = fs.readFileSync("apps/web/components/catalog/CatalogFilters.tsx", "utf8");
  const page = fs.readFileSync("apps/web/app/(public)/cars/page.tsx", "utf8");
  const storage = fs.readFileSync("apps/web/lib/catalog/storage.ts", "utf8");
  const template = fs.readFileSync("apps/web/app/(public)/template.tsx", "utf8");
  assert.match(source, /ac-range-input-box/);
  assert.match(source, /placeholder="Не важно"/);
  assert.match(source, /Быстрый выбор/);
  assert.match(source, /до 3 млн/);
  assert.match(source, /Введите «от» и\/или «до»/);
  assert.doesNotMatch(source, /type="range"/);
  assert.doesNotMatch(source, /ac-dual-range/);
  assert.match(source, /ac-mobile-filter-backdrop fixed inset-0[^\n]*flex items-end/);
  assert.match(source, /ac-mobile-filter-sheet/);
  assert.match(source, /rounded-t-\[30px\]/);
  assert.match(source, /ac-filter-chip/);
  assert.match(source, /Ещё фильтры/);
  assert.match(source, /aria-label="Расширенные фильтры"/);
  assert.match(source, /totalRubDesc/);
  assert.match(source, /yearAsc/);
  assert.doesNotMatch(source, /FilterActions/);
  assert.doesNotMatch(source, /Показать<\/button>/);
  assert.match(page, /totalRubDesc/);
  assert.match(page, /yearAsc/);
  assert.match(storage, /totalRubDesc/);
  assert.match(storage, /yearAsc/);
  assert.match(template, /ac-home-filter-drawer::before/);
  assert.match(template, /align-items: flex-end/);
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
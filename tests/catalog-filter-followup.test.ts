import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const filters=fs.readFileSync(new URL("../apps/web/components/catalog/CatalogFilters.tsx",import.meta.url),"utf8");
const rail=fs.readFileSync(new URL("../apps/web/components/catalog/BrandLogoRail.tsx",import.meta.url),"utf8");
const globals=fs.readFileSync(new URL("../apps/web/app/globals.css",import.meta.url),"utf8");
test("quick logo rail keeps multi-brand selection",()=>{assert.match(rail,/\[\.\.\.selectedBrands, brand\]/);assert.match(rail,/selectedBrandKeys/);});
test("range helper copy is removed",()=>{assert.doesNotMatch(filters,/>Диапазоны</);assert.doesNotMatch(filters,/Введите «от»/);});
test("red filled UI uses white text",()=>{assert.match(filters,/ac-filter-count-badge[\s\S]*text-white/);assert.match(globals,/Filled red UI is a site-wide semantic contract/);assert.match(globals,/-webkit-text-fill-color: #fff !important/);assert.match(rail,/mr-7[\s\S]*md:mr-14[\s\S]*>Очистить<\/button>/);});
// Multiple brand/model selection is exercised with clicks in tests/browser/catalog-multi-photo.mjs.

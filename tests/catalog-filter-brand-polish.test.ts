import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// Regression guards for the compact catalog filtering UI and its catalog-only brand multiselect.
const filters = fs.readFileSync(new URL("../apps/web/components/catalog/CatalogFilters.tsx", import.meta.url), "utf8");
const brandSelect = fs.readFileSync(new URL("../apps/web/components/catalog/CatalogBrandMultiSelect.tsx", import.meta.url), "utf8");
const rail = fs.readFileSync(new URL("../apps/web/components/catalog/BrandLogoRail.tsx", import.meta.url), "utf8");
const storage = fs.readFileSync(new URL("../apps/web/lib/catalog/storage.ts", import.meta.url), "utf8");

test("sort direction highlights only the active arrow", () => {
  assert.match(filters, /direction === "asc" \? "#ff353d"/);
  assert.match(filters, /direction === "desc" \? "#ff353d"/);
  assert.match(filters, /active=\{Boolean\(sortKey\)\}/);
});

test("catalog brand picker is a multiselect with logos and live compatible model counts", () => {
  assert.match(filters, /CatalogBrandMultiSelect/);
  assert.match(brandSelect, /BrandLogoVisual/);
  assert.match(brandSelect, /modelCounts/);
  assert.match(brandSelect, /Object\.keys\(stats\.counts\)/);
  assert.match(brandSelect, /aria-pressed=\{active\}/);
  assert.match(storage, /modelCounts/);
});

test("desktop advanced selects are outside the range input shell and count sits with chips", () => {
  assert.match(filters, /ac-advanced-select-row/);
  assert.match(filters, /ac-range-fields-shell/);
  assert.match(filters, /ac-advanced-fields\{background:transparent\}/);
  assert.doesNotMatch(filters, /advancedCount \?/);
  assert.match(filters, /whitespace-nowrap.*Ещё фильтры/);
  assert.match(filters, /Выбрано[\s\S]*\{chips\.length\}/);
});

test("brand rail captures the pointer only after real drag movement", () => {
  const begin = rail.indexOf("const beginMouseDrag");
  const move = rail.indexOf("const moveMouseDrag");
  const end = rail.indexOf("const endMouseDrag");
  assert.ok(begin >= 0 && move > begin && end > move);
  assert.doesNotMatch(rail.slice(begin, move), /setPointerCapture/);
  assert.match(rail.slice(move, end), /setPointerCapture/);
});
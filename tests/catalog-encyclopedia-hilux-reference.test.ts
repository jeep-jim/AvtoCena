import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const modelPage = fs.readFileSync(new URL("../apps/web/app/(public)/cars/brand/[slug]/model/[model]/page.tsx", import.meta.url), "utf8");
const modificationPage = fs.readFileSync(new URL("../apps/web/app/(public)/cars/brand/[slug]/model/[model]/modification/[variant]/page.tsx", import.meta.url), "utf8");
const reference = fs.readFileSync(new URL("../apps/web/components/catalog/EncyclopediaModelReference.tsx", import.meta.url), "utf8");
const specs = fs.readFileSync(new URL("../apps/web/components/catalog/VehicleSpecifications.tsx", import.meta.url), "utf8");
const publicData = fs.readFileSync(new URL("../apps/web/lib/catalog/encyclopedia-public.ts", import.meta.url), "utf8");

test("Toyota Hilux is the isolated encyclopedia reference model", () => {
  assert.match(modelPage, /brand\.slug === "toyota" && model\.slug === "hilux"/);
  assert.match(modelPage, /<EncyclopediaModelReference/);
  assert.match(reference, /Поколение \/ период/);
  assert.match(reference, /Открыть подробные характеристики/);
  assert.match(reference, /\/modification\/\$\{row\.slug\}/);
});

test("modifications have stable detail routes and a reusable specification view", () => {
  assert.match(publicData, /encyclopediaVariantSlug/);
  assert.match(publicData, /shortHash/);
  assert.match(modificationPage, /VehicleSpecifications/);
  assert.match(modificationPage, /Показываем только те характеристики/);
  assert.match(specs, /mode = "full"/);
  assert.match(specs, /mode === "compact"/);
  assert.match(specs, /30-минутная мощность/);
  assert.match(specs, /Мощность для утильсбора/);
});

test("reference specifications omit unknown dimensions instead of inventing them", () => {
  assert.doesNotMatch(specs, /Длина кузова|Ширина кузова|Высота кузова|Колёсная база|Объём топливного бака|Масса, кг/);
  assert.match(modificationPage, /Неизвестные размеры, массы и другие параметры не подставляются предположениями/);
});

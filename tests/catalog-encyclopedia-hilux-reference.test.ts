import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const modelPage = fs.readFileSync(new URL("../apps/web/app/(public)/cars/brand/[slug]/model/[model]/page.tsx", import.meta.url), "utf8");
const modificationPage = fs.readFileSync(new URL("../apps/web/app/(public)/cars/brand/[slug]/model/[model]/modification/[variant]/page.tsx", import.meta.url), "utf8");
const reference = fs.readFileSync(new URL("../apps/web/components/catalog/EncyclopediaModelReference.tsx", import.meta.url), "utf8");
const specs = fs.readFileSync(new URL("../apps/web/components/catalog/VehicleSpecifications.tsx", import.meta.url), "utf8");
const publicData = fs.readFileSync(new URL("../apps/web/lib/catalog/encyclopedia-public.ts", import.meta.url), "utf8");
const hiluxBridge = JSON.parse(fs.readFileSync(new URL("../data/catalog/vehicle-knowledge/v2-bridge-verified-variants.json", import.meta.url), "utf8"));

test("public model pages never special-case a research reference or expose aggregate pseudo-specs", () => {
  assert.doesNotMatch(modelPage, /brand\.slug === "toyota" && model\.slug === "hilux"/);
  assert.doesNotMatch(modelPage, /<EncyclopediaModelReference|Технические характеристики|readVehiclePowerKnowledge/);
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

test("Hilux reference has manufacturer-backed current eighth-generation variants", () => {
  assert.equal(hiluxBridge.length, 4);
  for (const row of hiluxBridge) {
    assert.equal(row.modelId, "toyota/hilux");
    assert.equal(row.make, "Toyota");
    assert.equal(row.model, "Hilux");
    assert.equal(row.generation, "8th generation");
    assert.equal(row.yearFrom, 2025);
    assert.equal(row.yearTo, 2025);
    assert.equal(row.drive, "4WD");
    assert.equal(row.sourceType, "manufacturer");
    assert.match(row.sourceUrl, /^https:\/\/www\.toyota\.co\.uk\//);
    assert.ok(Number(row.powerHp) > 0);
    assert.ok(Number(row.powerKw) > 0);
  }
  const hybrid = hiluxBridge.find((row: any) => row.powertrainKind === "other_hybrid");
  assert.ok(hybrid);
  assert.equal(hybrid.engineCc, 2755);
  assert.equal(hybrid.icePowerKw, 150);
  assert.equal(hybrid.power30MinKw, undefined);
  assert.equal(hybrid.utilizationPowerKw, undefined);
});

test("reference specifications omit unknown dimensions instead of inventing them", () => {
  assert.doesNotMatch(specs, /Длина кузова|Ширина кузова|Высота кузова|Колёсная база|Объём топливного бака|Масса, кг/);
  assert.match(modificationPage, /Неизвестные размеры, массы и другие параметры не подставляются предположениями/);
});

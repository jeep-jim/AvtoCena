import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../apps/web/app/(public)/cars/autocatalog/page.tsx", import.meta.url), "utf8");
const directory = fs.readFileSync(new URL("../apps/web/components/catalog/AutocatalogBrandDirectory.tsx", import.meta.url), "utf8");

test("autocatalog hero contains only the useful title instead of explanatory boxes", () => {
  assert.match(page, />Автокаталог<\/h1>/);
  assert.doesNotMatch(page, /Марка → модель → характеристики/);
  assert.doesNotMatch(page, /Нормальная база автомобилей/);
  assert.doesNotMatch(page, /Источник каждого факта сохраняется/);
  assert.doesNotMatch(page, /Неизвестные названия идут на проверку/);
  assert.doesNotMatch(page, /stats\.models|stats\.specifications/);
});

test("search and alphabet stay sticky while letter groups are no longer giant containers", () => {
  assert.match(directory, /sticky top-\[64px\]/);
  assert.match(directory, /grid-cols-\[repeat\(auto-fit,minmax\(32px,1fr\)\)\]/);
  assert.doesNotMatch(directory, /scroll-mt-44 rounded-\[1\.7rem\] bg-\[var\(--ac-surface\)\]/);
  assert.doesNotMatch(directory, /rounded-\[1\.6rem\].*backdrop-blur-xl/);
});


test("public encyclopedia hides raw source-master brands and counts only live models", () => {
  assert.match(page, /readCatalogBrandCounts/);
  assert.match(page, /readBrandModelDirectory/);
  assert.match(page, /canonicalModelCounts/);
  assert.doesNotMatch(page, /live\.modelCounts/);
  assert.match(page, /brand\.offerCount > 0 && brand\.modelCount > 0/);
  assert.doesNotMatch(page, /readSourceBackedEncyclopediaModels/);
  assert.doesNotMatch(page, /readEncyclopediaKnowledgeModels/);
  assert.match(page, /Сырые названия источников и пустые справочные карточки скрыты/);
});

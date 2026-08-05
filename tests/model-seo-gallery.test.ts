import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const layout = fs.readFileSync(new URL("../apps/web/app/(public)/cars/brand/[slug]/model/[model]/layout.tsx", import.meta.url), "utf8");

test("model page exposes sourced generation photos without replacing listing photos", () => {
  assert.match(layout, /findVehicleModelMedia/);
  assert.match(layout, /Фотографии показывают внешний вид модели и поколения/);
  assert.match(layout, /Состояние, цвет и комплектация конкретного автомобиля/);
  assert.match(layout, /Источник фотографий/);
  assert.match(layout, /rel="nofollow noopener noreferrer"/);
});

test("model page adds customer-facing SEO content and FAQ structured data", () => {
  assert.match(layout, /"@type": "FAQPage"/);
  assert.match(layout, /Описание и характеристики/);
  assert.match(layout, /характеристики и расчёт стоимости/);
  assert.match(layout, /Годы выпуска/);
  assert.match(layout, /Тип топлива/);
  assert.match(layout, /Рассчитать/);
  assert.doesNotMatch(layout, /Автосопоставление включено/);
  assert.doesNotMatch(layout, /стоит в очереди базы знаний/);
});

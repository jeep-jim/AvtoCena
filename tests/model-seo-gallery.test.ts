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

test("model gallery cannot invent family specifications or FAQ structured data", () => {
  assert.doesNotMatch(layout, /"@type": "FAQPage"/);
  assert.doesNotMatch(layout, /representativePowerHp/);
  assert.match(layout, /if \(!brand\) return children/);
  assert.match(layout, /if \(!model\) return children/);
  assert.match(layout, /media\?\.images\?\.length/);
  assert.match(layout, /media\.sourceUrl/);
  assert.doesNotMatch(layout, /Автосопоставление включено|стоит в очереди базы знаний/);
});

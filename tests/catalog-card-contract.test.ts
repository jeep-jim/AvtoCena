import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const card = fs.readFileSync(new URL("../apps/web/components/catalog/CatalogCard.tsx", import.meta.url), "utf8");
const contract = fs.readFileSync(new URL("../docs/catalog-card-contract.md", import.meta.url), "utf8");

test("catalog card never bypasses the validated public ruble price", () => {
  assert.match(card, /const visibleRub = catalogOfferVisibleRub\(normalizedOffer\)/);
  assert.doesNotMatch(card, /exactTotalRub\s*\|\|/);
  assert.doesNotMatch(card, /Number\(o\.totalRub\s*\|\|\s*0\)/);
  assert.match(card, /totalRub: visibleRub \|\| null/);
  assert.match(card, /· ориентир/);
  assert.doesNotMatch(card, /function sourceMoney/);
  assert.doesNotMatch(card, /Цена в объявлении/);
  assert.doesNotMatch(card, /Цена торгов/);
  assert.doesNotMatch(card, /Расчёт под ключ уточняется/);
  assert.doesNotMatch(card, /Расчёт таможни/);
  assert.doesNotMatch(card, /ориентир под ключ/);
});

test("card UI contract requires rubles and a separate UI task", () => {
  assert.match(contract, /не должна изменяться.*без отдельной UI-задачи/s);
  assert.match(contract, /публичную цену только в рублях/);
  assert.match(contract, /иностранную валюту источника не выводить/);
  assert.match(contract, /после цены сразу идут компактные характеристики/);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const card = fs.readFileSync(new URL("../apps/web/components/catalog/CatalogCard.tsx", import.meta.url), "utf8");
const contract = fs.readFileSync(new URL("../docs/catalog-card-contract.md", import.meta.url), "utf8");

test("catalog backend work does not expand the agreed public card copy", () => {
  assert.match(card, /Расчёт под ключ уточняется/);
  assert.match(card, /· ориентир/);
  assert.doesNotMatch(card, /ориентир под ключ/);
  assert.doesNotMatch(card, /цена автомобиля в рублях/);
  assert.doesNotMatch(card, /Цена в объявлении/);
  assert.doesNotMatch(card, /Расчёт таможни, утильсбора и цены под ключ уточняется/);
});

test("card UI contract explicitly requires a separate UI task", () => {
  assert.match(contract, /не должна изменяться.*без отдельной UI-задачи/s);
  assert.match(contract, /не добавлять длинные поясняющие строки/);
});

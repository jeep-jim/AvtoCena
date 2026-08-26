import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const card = fs.readFileSync(new URL("../apps/web/components/catalog/CatalogCard.tsx", import.meta.url), "utf8");
const price = fs.readFileSync(new URL("../apps/web/components/catalog/CatalogPrice.tsx", import.meta.url), "utf8");
const publicLayout = fs.readFileSync(new URL("../apps/web/app/(public)/layout.tsx", import.meta.url), "utf8");
const contract = fs.readFileSync(new URL("../docs/catalog-card-contract.md", import.meta.url), "utf8");
const offerPage = fs.readFileSync(new URL("../apps/web/app/(public)/cars/offer/[id]/page.tsx", import.meta.url), "utf8");

test("catalog card never bypasses the validated public ruble price", () => {
  assert.match(card, /const visibleRub = catalogOfferVisibleRub\(normalizedOffer\)/);
  assert.doesNotMatch(card, /exactTotalRub\s*\|\|/);
  assert.doesNotMatch(card, /Number\(o\.totalRub\s*\|\|\s*0\)/);
  assert.match(card, /totalRub: visibleRub \|\| null/);
  assert.match(card, /if \(!visibleRub\) return null/);
  assert.doesNotMatch(card, /function sourceMoney/);
  assert.doesNotMatch(card, /Цена в объявлении/);
  assert.doesNotMatch(card, /Цена торгов/);
  assert.doesNotMatch(card, /Расчёт под ключ уточняется/);
  assert.doesNotMatch(card, /Расчёт таможни/);
  assert.doesNotMatch(card, /ориентир под ключ/);
  assert.match(offerPage, /const visibleRub = customerScenarioRub \|\| catalogOfferVisibleRub\(raw\)/);
  assert.match(offerPage, /if \(!catalogPublicPriority\(raw\)\.eligible \|\| !visibleRub\) notFound\(\)/);
  assert.doesNotMatch(offerPage, /exactTotalRub\s*\|\|/);
});

test("invalid ruble calculation never falls back to foreign source currency", () => {
  assert.match(price, /Цена по запросу/);
  assert.doesNotMatch(price, /sourcePrice/);
  assert.doesNotMatch(price, /sourceCurrency/);
});

test("public theme hotfix uses one dark background and explicit footer CTA colors", () => {
  assert.match(publicLayout, /body main\.ac-page-copy[\s\S]*background:\s*#0f172a\s*!important/);
  assert.match(publicLayout, /\.ac-public-footer-cta[\s\S]*background:\s*#e31b23\s*!important[\s\S]*color:\s*#ffffff\s*!important/);
  assert.match(publicLayout, /data-theme="light"[^\n]*\.ac-public-footer-dealers[\s\S]*background:\s*#ffffff\s*!important/);
});

test("card UI contract requires rubles and a separate UI task", () => {
  assert.match(contract, /не должна изменяться.*без отдельной UI-задачи/s);
  assert.match(contract, /публичную цену только в рублях/);
  assert.match(contract, /иностранную валюту источника не выводить/);
  assert.match(contract, /Цена по запросу/);
  assert.match(contract, /после цены сразу идут компактные характеристики/);
});

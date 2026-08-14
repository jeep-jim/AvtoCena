import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const catalogPrice = fs.readFileSync(new URL("../apps/web/components/catalog/CatalogPrice.tsx", import.meta.url), "utf8");
const preliminaryPrice = fs.readFileSync(new URL("../apps/web/components/catalog/PreliminaryPrice.tsx", import.meta.url), "utf8");
const priceTrend = fs.readFileSync(new URL("../apps/web/components/catalog/PriceTrend.tsx", import.meta.url), "utf8");
const carsLoading = fs.readFileSync(new URL("../apps/web/app/(public)/cars/loading.tsx", import.meta.url), "utf8");

test("catalog price colors distinguish electrified, preliminary and regular calculations", () => {
  assert.match(catalogPrice, /highlightElectrified/);
  assert.match(catalogPrice, /electric.*series_hybrid.*other_hybrid/);
  assert.match(catalogPrice, /hybrid\|phev\|hev\|mhev/);
  assert.match(catalogPrice, /PreliminaryPrice[^;]+highlightElectrified=\{highlightElectrified\}/s);
  assert.match(catalogPrice, /PriceTrend[^;]+highlightElectrified=\{highlightElectrified\}/s);
  assert.match(preliminaryPrice, /highlightElectrified \? \(lightTheme \? "#c58a00" : "#ffd21f"\) : "var\(--ac-text\)"/);
  assert.match(priceTrend, /highlightElectrified \? \(lightTheme \? "#c58a00" : "#ffd21f"\) : undefined/);
  assert.match(priceTrend, /style=\{priceColor \? \{ color: priceColor \} : undefined\}/);
  assert.match(preliminaryPrice, /Почему цена предварительная/);
  assert.match(preliminaryPrice, /const panelBackground = "var\(--ac-surface-2\)"/);
});

test("catalog route loader follows active light or dark theme variables", () => {
  assert.match(carsLoading, /bg-\[var\(--ac-surface\)\]/);
  assert.match(carsLoading, /text-\[var\(--ac-text\)\]/);
  assert.match(carsLoading, /text-\[var\(--ac-muted\)\]/);
  assert.match(carsLoading, /bg-\[var\(--ac-surface-3\)\]/);
  assert.doesNotMatch(carsLoading, /bg-\[#0f172a\]|text-white|bg-white\/\[/);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const preliminaryPrice = fs.readFileSync(new URL("../apps/web/components/catalog/PreliminaryPrice.tsx", import.meta.url), "utf8");
const carsLoading = fs.readFileSync(new URL("../apps/web/app/(public)/cars/loading.tsx", import.meta.url), "utf8");

test("preliminary catalog pricing stays visually neutral", () => {
  assert.match(preliminaryPrice, /const priceColor = "var\(--ac-text\)"/);
  assert.match(preliminaryPrice, /const panelBackground = "var\(--ac-surface-2\)"/);
  assert.doesNotMatch(preliminaryPrice, /#ffd21f|#c58a00|#fff2cc|rgba\(251,191,36/);
  assert.match(preliminaryPrice, /Почему цена предварительная/);
  assert.match(preliminaryPrice, /PRELIMINARY_PRICE_INFO/);
});

test("catalog route loader follows active light or dark theme variables", () => {
  assert.match(carsLoading, /bg-\[var\(--ac-surface\)\]/);
  assert.match(carsLoading, /text-\[var\(--ac-text\)\]/);
  assert.match(carsLoading, /text-\[var\(--ac-muted\)\]/);
  assert.match(carsLoading, /bg-\[var\(--ac-surface-3\)\]/);
  assert.doesNotMatch(carsLoading, /bg-\[#0f172a\]|text-white|bg-white\/\[/);
});

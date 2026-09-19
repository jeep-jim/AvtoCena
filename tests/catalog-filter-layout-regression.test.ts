import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const marketPage = fs.readFileSync("apps/web/lib/catalog/market-page.ts", "utf8");
const filters = fs.readFileSync("apps/web/components/catalog/CatalogFilters.tsx", "utf8");
const page = fs.readFileSync("apps/web/app/(public)/cars/page.tsx", "utf8");

test("redesigned desktop filters keep their own nested layout", () => {
  assert.match(filters, /ac-range-input-box/);
  assert.match(filters, /aria-label=\{`\$\{title\}: от`\}/);
  assert.match(filters, /aria-label=\{`\$\{title\}: до`\}/);
  assert.doesNotMatch(filters, /type="range"/);
  assert.doesNotMatch(page, /ac-advanced-fields>div\{display:contents!important\}/);
  assert.doesNotMatch(page, /\.ac-advanced-fields\{display:grid!important/);
});

test("catalog page accepts both sort directions emitted by the filter UI", () => {
  assert.match(filters, /totalRubDesc/);
  assert.match(filters, /yearAsc/);
  assert.match(page, /SUPPORTED_SORTS = new Set\(\["updatedAt", "totalRub", "totalRubDesc", "year", "yearAsc", "mileage"\]\)/);
  assert.match(marketPage, /sort === "totalRubDesc"/);
  assert.match(marketPage, /sort === "yearAsc"/);
});

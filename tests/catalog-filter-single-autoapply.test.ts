import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("catalog layout does not mount the legacy DOM filter auto-apply", () => {
  const filters = fs.readFileSync("apps/web/components/catalog/CatalogFilters.tsx", "utf8");
  const layout = fs.readFileSync("apps/web/app/(public)/cars/layout.tsx", "utf8");
  assert.match(filters, /router\.replace/);
  assert.doesNotMatch(layout, /CatalogFilterAutoApply/);
});

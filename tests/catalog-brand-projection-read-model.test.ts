import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../apps/web/lib/catalog/storage.ts", import.meta.url), "utf8");

test("current read models publish and consume per-brand projections", () => {
  assert.match(source, /projection-brand\/\$\{label\}-\$\{digest\}\.json/);
  assert.match(source, /createHash\("sha256"\)\.update\(normalized\)/);
  assert.match(source, /projectionsByBrand/);
  assert.match(source, /brandProjectionCount: projectionsByBrand\.size/);
  assert.match(source, /readCurrentBrandProjection/);
  assert.match(source, /requestedMakes = catalogMakeFilterValues\(params\.make\)/);
  assert.match(source, /usedIndexShards: requestedMakes\.map\(currentBrandProjectionPath\)/);
});

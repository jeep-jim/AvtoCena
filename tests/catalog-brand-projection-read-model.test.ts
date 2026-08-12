import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../apps/web/lib/catalog/storage.ts", import.meta.url), "utf8");

test("current read models publish and consume per-brand projections", () => {
  assert.match(source, /catalog\/public\/projection-brand\/\$\{cleanShard\(make\)\}\.json/);
  assert.match(source, /projectionsByBrand/);
  assert.match(source, /brandProjectionCount: projectionsByBrand\.size/);
  assert.match(source, /readCurrentBrandProjection/);
  assert.match(source, /requestedMakes = catalogMakeFilterValues\(params\.make\)/);
  assert.match(source, /usedIndexShards: requestedMakes\.map\(currentBrandProjectionPath\)/);
});

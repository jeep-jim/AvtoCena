import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const importer = fs.readFileSync(new URL("../apps/web/lib/catalog/importer.ts", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-v3-market-10k-reusable.yml", import.meta.url), "utf8");

test("10k rebuild requires a buyer-usable five-photo gallery and caps galleries at 30", () => {
  assert.doesNotMatch(importer, /CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER\s*=\s*["']30["']/);
  assert.match(workflow, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER: "5"/);
  assert.match(workflow, /CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER: "5"/);
  assert.match(workflow, /CATALOG_COLLECTION_IMAGE_LIMIT: "5"/);
  assert.match(workflow, /CATALOG_MAX_IMAGES_PER_OFFER: "30"/);
  assert.match(workflow, /CATALOG_GALLERY_FAST_PATH: "true"/);
});

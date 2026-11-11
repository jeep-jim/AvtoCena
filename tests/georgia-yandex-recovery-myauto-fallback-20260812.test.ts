import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../apps/web/lib/catalog/georgia-yandex-recovery.ts", import.meta.url), "utf8");

test("Georgia Yandex recovery accepts an exact MyAuto product gallery when the list card has no image", () => {
  assert.match(source, /myAutoProductSnapshotFromInfo/);
  assert.match(source, /myAutoProductSnapshotFromInfo\(info as Record<string, unknown>, id, identity\?\.photo\)/);
  assert.match(source, /myAutoListPhotoIdentityPresent: Boolean\(identity\)/);
  assert.match(source, /myauto_exact_product_large_formula/);
  assert.doesNotMatch(source, /if \(!identity\) throw new Error\("myauto_list_image_identity"\)/);
});

test("Georgia Yandex recovery still binds MyAuto to exact car id and optional exact list photo identity", () => {
  assert.match(source, /MYAUTO_PRODUCT_API \+ "\/" \+ id/);
  assert.match(source, /const id = String\(offer\.sourceOfferId \|\| ""\)/);
  assert.match(source, /myAutoProductSnapshotFromInfo\(info as Record<string, unknown>, id, identity\?\.photo\)/);
});

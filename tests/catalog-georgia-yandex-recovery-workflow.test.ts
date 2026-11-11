import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(".github/workflows/catalog-live-recovery-georgia-yandex.yml", "utf8");
const merge = fs.readFileSync("scripts/catalog-georgia-yandex-merge.mjs", "utf8");

test("Georgia Yandex recovery stays manual, serialized and fail-closed before writes", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+schedule:/);
  assert.match(workflow, /group: catalog-live-daily-working-markets/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /GEORGIA_YANDEX_ROUTE: https:\/\/avtocena\.com\/api\/internal\/georgia-recovery-e2f913/);
  assert.match(workflow, /GEORGIA_YANDEX_PAGES_PER_SHARD: "20"/);
  assert.match(workflow, /startPage: \[1, 21, 41, 61, 81, 101, 121, 141, 161, 181, 201, 221, 241, 261, 281\]/);
  assert.match(workflow, /source: \[myauto, autopapa\]/);
  assert.match(workflow, /max-parallel: 4/);
  assert.match(workflow, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER: "5"/);
  assert.match(workflow, /CATALOG_MAX_OFFERS_PER_MODEL_YEAR: "20"/);
  assert.match(workflow, /GEORGIA_YANDEX_MIN_FRESH: "1000"/);
  assert.match(workflow, /CATALOG_AUDIT_ASSERT_MARKETS: korea,china,japan,uae,europe,georgia/);
  assert.match(workflow, /RECOVERY_BATCH_MARKETS: georgia/);
  assert.match(workflow, /RECOVERY_BATCH_DRY_RUN: "true"/);
  assert.match(workflow, /if: inputs\.apply == true/);
  assert.match(workflow, /Recheck strict all-seven baseline immediately before persistence/);
  assert.match(workflow, /Strict post-persist six-market audit/);
});

test("Georgia source collection through Yandex never receives catalog storage credentials", () => {
  const collectStart = workflow.indexOf("\n  collect:\n");
  const mergeStart = workflow.indexOf("\n  merge:\n");
  assert.ok(collectStart >= 0 && mergeStart > collectStart);
  const collect = workflow.slice(collectStart, mergeStart);
  assert.doesNotMatch(collect, /YC_OBJECT_STORAGE_|JSON_STORAGE_DRIVER|CATALOG_IMAGE_CDN_URL/);
  assert.match(collect, /\$\{GEORGIA_YANDEX_ROUTE\}\?source=\$\{\{ matrix\.source \}\}&pages=\$\{GEORGIA_YANDEX_PAGES_PER_SHARD\}&startPage=\$\{\{ matrix\.startPage \}\}/);
});

test("Georgia shard merge accepts only exact canonical identities and listing-bound galleries", () => {
  assert.match(merge, /new Set\(\["myauto_georgia_list", "autopapa_georgia_open"\]\)/);
  assert.match(merge, /Number\(offer\?\.year \|\| 0\) < 2020/);
  assert.match(merge, /images\.length < 5 \|\| images\.length > 30/);
  assert.match(merge, /op\.photoIdentityVerified !== true \|\| raw\.listingBoundImages !== true/);
  assert.match(merge, /raw\.recoveryExactSourceUrl !== true/);
  assert.match(merge, /raw\.recoveryExactPhotoIdentity !== true/);
  assert.match(merge, /String\(raw\.myAutoProductCarId \|\| ""\) !== id/);
  assert.match(merge, /system\\\/car\\\/photos/);
  assert.match(merge, /original\\\.jpg/);
  assert.match(merge, /georgia_yandex_cross_listing_images/);
  assert.match(merge, /georgia_yandex_missing_canonical_source/);
  assert.match(merge, /georgia_yandex_fresh_floor/);
  assert.doesNotMatch(merge, /(?:^|[^a-z])auto_georgia|ss\.ge|mymarket|my\.market/i);
});

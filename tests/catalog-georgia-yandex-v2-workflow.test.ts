import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(".github/workflows/catalog-live-recovery-georgia-yandex-v2.yml", "utf8");
const merge = fs.readFileSync("scripts/catalog-georgia-yandex-merge.mjs", "utf8");

test("Georgia Yandex v2 has an isolated recovery trigger, is serialized and uses source-specific bounded shards", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+schedule:/m);
  assert.match(workflow, /^\s+push:/m);
  assert.match(workflow, /\.github\/market-runs\/georgia-yandex/);
  assert.match(workflow, /group: catalog-live-daily-working-markets/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /GEORGIA_YANDEX_ROUTE: https:\/\/avtocena\.com\/api\/internal\/georgia-recovery-e2f913/);
  assert.match(workflow, /collect-myauto:/);
  assert.match(workflow, /pages=20&startPage=\$\{\{ matrix\.startPage \}\}/);
  assert.match(workflow, /startPage: \[1, 21, 41, 61, 81, 101, 121, 141, 161, 181, 201, 221, 241, 261, 281\]/);
  assert.match(workflow, /collect-autopapa:/);
  assert.match(workflow, /pages=5&startPage=\$\{\{ matrix\.startPage \}\}/);
  assert.match(workflow, /startPage: \[1, 6, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56, 61, 66, 71, 76, 81, 86, 91, 96, 101, 106, 111, 116, 121, 126, 131, 136, 141, 146, 151, 156, 161, 166, 171, 176, 181, 186, 191, 196, 201, 206, 211, 216, 221, 226, 231, 236, 241, 246, 251, 256, 261, 266, 271, 276, 281, 286, 291, 296\]/);
  assert.match(workflow, /max-parallel: 2/);
  assert.match(workflow, /needs: \[collect-myauto, collect-autopapa\]/);
});

test("Georgia Yandex v2 collection remains storage-readonly and filters sparse or noncanonical rows before artifacts", () => {
  const start = workflow.indexOf("\n  collect-myauto:\n");
  const end = workflow.indexOf("\n  merge:\n");
  assert.ok(start >= 0 && end > start);
  const collect = workflow.slice(start, end);
  assert.doesNotMatch(collect, /YC_OBJECT_STORAGE_|JSON_STORAGE_DRIVER|CATALOG_IMAGE_CDN_URL/);
  assert.match(collect, /offer\?\.sourceId === 'myauto_georgia_list'/);
  assert.match(collect, /offer\?\.sourceId === 'autopapa_georgia_open'/);
  assert.match(collect, /Number\(offer\?\.year \|\| 0\) >= 2020/);
  assert.match(collect, /images\.length >= 5 && images\.length <= 30/);
  assert.match(collect, /op\.photoIdentityVerified === true/);
  assert.match(collect, /raw\.listingBoundImages === true/);
  assert.match(collect, /raw\.recoveryExactSourceUrl === true/);
  assert.match(collect, /raw\.recoveryExactPhotoIdentity === true/);
  assert.match(collect, /georgia_yandex_sparse_gallery_in_snapshot/);
});

test("Georgia Yandex v2 audits six populated markets before recovery and all seven after persistence", () => {
  assert.match(workflow, /GEORGIA_YANDEX_MIN_FRESH: "1000"/);
  assert.match(workflow, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER: "5"/);
  assert.match(workflow, /CATALOG_MAX_OFFERS_PER_MODEL_YEAR: "20"/);
  assert.equal((workflow.match(/CATALOG_AUDIT_ASSERT_MARKETS: korea,china,japan,uae,europe,kyrgyzstan/g) || []).length, 3);
  assert.equal((workflow.match(/CATALOG_AUDIT_ASSERT_MARKETS: korea,china,japan,uae,europe,georgia,kyrgyzstan/g) || []).length, 1);
  assert.match(workflow, /RECOVERY_BATCH_MARKETS: georgia/);
  assert.match(workflow, /RECOVERY_BATCH_DRY_RUN: "true"/);
  assert.match(workflow, /if: github\.event_name == 'push' \|\| inputs\.apply == true/);
  assert.match(workflow, /Recheck strict six-market baseline immediately before persistence/);
  assert.match(workflow, /Strict post-persist seven-market audit/);
  assert.match(workflow, /preservedPublicHashByMarket/);
});

test("Georgia v2 still delegates exact identity, five-photo and cross-listing checks to the canonical merge gate", () => {
  assert.match(merge, /new Set\(\["myauto_georgia_list", "autopapa_georgia_open"\]\)/);
  assert.match(merge, /Number\(offer\?\.year \|\| 0\) < 2020/);
  assert.match(merge, /images\.length < 5 \|\| images\.length > 30/);
  assert.match(merge, /op\.photoIdentityVerified !== true \|\| raw\.listingBoundImages !== true/);
  assert.match(merge, /raw\.recoveryExactSourceUrl !== true/);
  assert.match(merge, /raw\.recoveryExactPhotoIdentity !== true/);
  assert.match(merge, /String\(raw\.myAutoProductCarId \|\| ""\) !== id/);
  assert.match(merge, /georgia_yandex_cross_listing_images/);
  assert.match(merge, /georgia_yandex_missing_canonical_source/);
  assert.match(merge, /georgia_yandex_fresh_floor/);
  assert.doesNotMatch(merge, /(?:^|[^a-z])auto_georgia|ss\.ge|mymarket|my\.market/i);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  catalogPartitionInitialCursor,
  catalogPartitionNextCursor,
  catalogPartitionStorageSuffix,
  catalogRetainedOfferBelongsToPartition,
  catalogSourcePagePartition,
} from "../apps/web/lib/catalog/source-page-partition";

test("numeric source pages are split across three independent workers", () => {
  const partitions = [0, 1, 2].map((index) => catalogSourcePagePartition("dubicars_uae_exact", index, 5, 3));
  assert.deepEqual(partitions.map(catalogPartitionInitialCursor), ["1", "2", "3"]);
  assert.deepEqual(partitions.map((partition, index) => catalogPartitionNextCursor(String(index + 1), String(index + 2), partition)), ["4", "5", "6"]);
  assert.deepEqual(partitions.map(catalogPartitionStorageSuffix), [
    "/page-shard-0-of-3",
    "/page-shard-1-of-3",
    "/page-shard-2-of-3",
  ]);
  assert.equal(catalogSourcePagePartition("dubicars_uae_exact", 3, 5, 3), null);
  assert.equal(catalogSourcePagePartition("dubicars_uae_exact", 4, 5, 3), null);
});

test("mobile.de workers advance through disjoint search shards", () => {
  const partition = catalogSourcePagePartition("mobile_de_open", 1, 5, 3);
  assert.equal(catalogPartitionInitialCursor(partition), JSON.stringify({ shard: 1, page: 1 }));
  assert.equal(
    catalogPartitionNextCursor(JSON.stringify({ shard: 1, page: 25 }), JSON.stringify({ shard: 2, page: 1 }), partition),
    JSON.stringify({ shard: 4, page: 1 }),
  );
  assert.equal(
    catalogPartitionNextCursor(JSON.stringify({ shard: 1, page: 1 }), JSON.stringify({ shard: 1, page: 2 }), partition),
    JSON.stringify({ shard: 1, page: 2 }),
  );
});

test("retained offers have exactly one page-partition owner", () => {
  const owners = [0, 1, 2].filter((index) => catalogRetainedOfferBelongsToPartition(
    "stable-offer-id",
    catalogSourcePagePartition("kcar_korea_open", index, 5),
  ));
  assert.equal(owners.length, 1);
});

test("forbidden Japanese sources cannot obtain page partitions", () => {
  assert.equal(catalogSourcePagePartition("goonet_japan_exact", 0, 5, 5), null);
});

test("Japan workflows keep five collectors without binding them to a forbidden source", () => {
  const reusable = readFileSync(new URL("../.github/workflows/catalog-v3-market-10k-reusable.yml", import.meta.url), "utf8");
  const japan = readFileSync(new URL("../.github/workflows/catalog-v2-japan.yml", import.meta.url), "utf8");
  const sequential = readFileSync(new URL("../.github/workflows/catalog-v3-sequential-queue.yml", import.meta.url), "utf8");
  assert.match(reusable, /CATALOG_REBUILD_PAGE_PARTITION_COUNT: \$\{\{ inputs\.page_partition_count \}\}/);
  assert.match(japan, /page_partition_count: "5"/);
  assert.match(sequential, /market: japan[\s\S]*page_partition_count: "5"/);
});

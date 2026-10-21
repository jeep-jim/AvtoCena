export type CatalogSourcePagePartition = {
  index: number;
  count: number;
  kind: "numeric_page" | "mobile_search_shard";
};

const NUMERIC_PAGE_SOURCES = new Set([
  "autohome_new_china_open",
  "autohome_used_china_open",
  "kcar_korea_open",
  "kbchachacha_korea_open",
  "dubicars_uae_exact",
  "otomoto_europe_exact",
]);

function isPartitionedSource(sourceId: string) {
  return sourceId === "mobile_de_open" || NUMERIC_PAGE_SOURCES.has(sourceId);
}

function stableShard(value: unknown, count: number) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % count;
}

export function catalogSourcePagePartition(
  sourceId: string,
  shardIndex: number,
  shardCount: number,
  partitionCount = Number(process.env.CATALOG_REBUILD_PAGE_PARTITION_COUNT || 3),
): CatalogSourcePagePartition | null {
  const count = Math.max(1, Math.min(shardCount, Math.floor(partitionCount) || 1));
  if (shardIndex < 0 || shardIndex >= count) return null;
  if (sourceId === "mobile_de_open") return { index: shardIndex, count, kind: "mobile_search_shard" };
  if (NUMERIC_PAGE_SOURCES.has(sourceId)) return { index: shardIndex, count, kind: "numeric_page" };
  return null;
}

export function catalogSourceAssignedToShard(sourceId: string, shardIndex: number, shardCount: number) {
  if (isPartitionedSource(sourceId)) return Boolean(catalogSourcePagePartition(sourceId, shardIndex, shardCount));
  return stableShard(sourceId, shardCount) === shardIndex;
}

export function catalogPartitionInitialCursor(partition: CatalogSourcePagePartition | null): string | null {
  if (!partition) return null;
  if (partition.kind === "mobile_search_shard") return JSON.stringify({ shard: partition.index, page: 1 });
  return String(partition.index + 1);
}

export function catalogPartitionNextCursor(
  cursor: string | null | undefined,
  nextCursor: string | null | undefined,
  partition: CatalogSourcePagePartition | null,
): string | null {
  if (!nextCursor || !partition) return nextCursor || null;
  if (partition.kind === "numeric_page") {
    const page = Number(nextCursor);
    return Number.isFinite(page) ? String(page + partition.count - 1) : nextCursor;
  }
  try {
    const current = JSON.parse(String(cursor || "{}"));
    const next = JSON.parse(nextCursor);
    if (Number(next?.shard) > Number(current?.shard)) next.shard = Number(current?.shard) + partition.count;
    return JSON.stringify(next);
  } catch {
    return nextCursor;
  }
}

export function catalogPartitionStorageSuffix(partition: CatalogSourcePagePartition | null) {
  return partition ? `/page-shard-${partition.index}-of-${partition.count}` : "";
}

export function catalogRetainedOfferBelongsToPartition(offerId: string, partition: CatalogSourcePagePartition | null) {
  return !partition || stableShard(offerId, partition.count) === partition.index;
}

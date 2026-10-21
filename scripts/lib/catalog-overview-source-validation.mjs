/** Validate the immutable generation shard, never an independently replaced current alias. */
export function validateOverviewSourceShard(projection, generationId, market, expectedCount) {
  if (projection?.generationId !== generationId || !Array.isArray(projection?.items))
    throw new Error(`catalog_overview_source_generation_mismatch:${market}`);
  if (projection.items.length !== expectedCount || projection.items.some(row => row.market !== market)
      || new Set(projection.items.map(row => row.id)).size !== expectedCount
      || projection.items.some(row => !row.id))
    throw new Error(`catalog_overview_source_count_mismatch:${market}`);
  return projection.items.length;
}

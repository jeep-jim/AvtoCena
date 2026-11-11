/** Validate the immutable generation shard, never an independently replaced current alias. */
export async function validateOverviewSourceBatches(batches, generationId, market, expectedCount) {
  const ids = new Set();
  let count = 0;
  for await (const projection of batches) {
    if (projection?.generationId !== generationId || !Array.isArray(projection?.items))
      throw new Error(`catalog_overview_source_generation_mismatch:${market}`);
    for (const row of projection.items) {
      if (!row?.id || row.market !== market || ids.has(row.id) || ++count > expectedCount)
        throw new Error(`catalog_overview_source_count_mismatch:${market}`);
      ids.add(row.id);
    }
  }
  if (count !== expectedCount) throw new Error(`catalog_overview_source_count_mismatch:${market}`);
  return count;
}

export function validateOverviewSourceShard(projection, generationId, market, expectedCount) {
  if (projection?.generationId !== generationId || !Array.isArray(projection?.items))
    throw new Error(`catalog_overview_source_generation_mismatch:${market}`);
  if (projection.items.length !== expectedCount || projection.items.some(row => row.market !== market)
      || new Set(projection.items.map(row => row.id)).size !== expectedCount
      || projection.items.some(row => !row.id))
    throw new Error(`catalog_overview_source_count_mismatch:${market}`);
  return projection.items.length;
}

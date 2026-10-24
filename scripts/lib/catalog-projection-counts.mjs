/** Audit metadata only; retain neither a complete projection nor JSON text. */
export async function countProjectionBatches(batches) {
  let generationId, count = 0;
  const markets = {};
  for await (const batch of batches) {
    if (!batch?.generationId || !Array.isArray(batch.items)) throw Error('catalog_projection_audit_invalid');
    if (generationId !== undefined && generationId !== batch.generationId) throw Error('catalog_projection_audit_generation_changed');
    generationId = batch.generationId;
    for (const row of batch.items) {
      const market = String(row?.market || '');
      if (!market) throw Error('catalog_projection_audit_market_missing');
      markets[market] = (markets[market] || 0) + 1;
      count++;
    }
  }
  if (!generationId) throw Error('catalog_projection_audit_generation_missing');
  return {generationId, count, markets};
}

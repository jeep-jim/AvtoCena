from pathlib import Path

p = Path('apps/web/lib/catalog/storage.ts')
s = p.read_text()
old = '''  const chunkLocations = new Map<string, OfferLocation>();
  for (const id of selectedIds) {
    const location = byId.byId[id];
    if (location) chunkLocations.set(`${location.market}/${location.chunk}`, location);
  }
  const readConcurrency = Math.max(1, Math.min(32, Number(process.env.CATALOG_SEARCH_CHUNK_CONCURRENCY || 12)));
  const loaded = (await mapWithConcurrency([...chunkLocations.values()], readConcurrency, (location) =>
    readDataJson<VehicleOffer[]>(offerPath(manifest.generationId, location.market, location.chunk), []))).flat();
  const offersById = new Map(loaded.filter(isPublicOffer).map((offer) => [offer.id, offer]));
  const items = selectedIds.flatMap((id) => {
    const offer = offersById.get(id);
    return offer ? [publicOffer(offer)] : [];
  });
'''
new = '''  // Homepage cards only need the compact card projection. Reading full offer chunks
  // for ~6 cards x 7 markets turned a simple initial render into dozens of object-store
  // reads. Prefer the per-market projection shards and fall back to full chunks only for
  // IDs from an older generation that cannot render a card from projection.
  const projected = (await mapWithConcurrency(MARKETS, MARKETS.length, async (market) =>
    (await readSearchProjection(manifest.generationId, market)).items || [])).flat();
  const projectedById = new Map(projected.filter(projectionCanRenderCard).map((row) => [row.id, row]));
  const missingIds = selectedIds.filter((id) => !projectedById.has(id));

  const fallbackById = new Map<string, VehicleOffer>();
  if (missingIds.length) {
    const chunkLocations = new Map<string, OfferLocation>();
    for (const id of missingIds) {
      const location = byId.byId[id];
      if (location) chunkLocations.set(`${location.market}/${location.chunk}`, location);
    }
    const readConcurrency = Math.max(1, Math.min(32, Number(process.env.CATALOG_SEARCH_CHUNK_CONCURRENCY || 12)));
    const loaded = (await mapWithConcurrency([...chunkLocations.values()], readConcurrency, (location) =>
      readDataJson<VehicleOffer[]>(offerPath(manifest.generationId, location.market, location.chunk), []))).flat();
    for (const offer of loaded.filter(isPublicOffer)) fallbackById.set(offer.id, offer);
  }

  const items = selectedIds.flatMap((id) => {
    const row = projectedById.get(id);
    if (row) return [publicOfferFromProjection(row)];
    const offer = fallbackById.get(id);
    return offer ? [publicOffer(offer)] : [];
  });
'''
if old not in s:
    raise SystemExit('home snapshot chunk block not found')
s = s.replace(old, new, 1)
p.write_text(s)
print('home_snapshot_projection_patch_ok')

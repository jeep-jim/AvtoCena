from pathlib import Path
p=Path('apps/web/lib/catalog/storage.ts')
s=p.read_text()
old='''async function readProjectionRows(manifest: CatalogManifest, params: CatalogSearchParams) {\n  const markets = params.market && params.market !== "any" ? [String(params.market)] : MARKETS;\n  return (await mapWithConcurrency(markets, Math.min(7, markets.length || 1), async (market) => (await readSearchProjection(manifest.generationId, market)).items || [])).flat();\n}\n'''
new='''async function readProjectionRows(manifest: CatalogManifest, params: CatalogSearchParams) {\n  const markets = params.market && params.market !== "any" ? [String(params.market)] : MARKETS;\n  return (await mapWithConcurrency(markets, Math.min(7, markets.length || 1), async (market) => {\n    const projection = await readSearchProjection(manifest.generationId, market);\n    if ((projection.items || []).length || Number(manifest.markets?.[market]?.count || 0) === 0) return projection.items || [];\n    // Backward-compatible bridge for the currently published generation: older\n    // generations do not have compact projection shards yet. Preserve correctness\n    // by falling back to one market scan until the next catalog generation writes\n    // the new projection index; subsequent generations stay on the compact path.\n    const legacy = (await readMarketOffers(market)).filter(isPublicOffer);\n    return legacy.map(searchProjectionFromOffer);\n  })).flat();\n}\n'''
if old not in s: raise SystemExit('projection rows block missing')
s=s.replace(old,new,1)
p.write_text(s)
print('catalog_search_projection_fallback_ok')

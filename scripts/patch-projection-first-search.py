from pathlib import Path

p = Path('apps/web/lib/catalog/storage.ts')
s = p.read_text()

old_manifest = '''async function readManifest(): Promise<CatalogManifest> { return readDataJson<CatalogManifest>("catalog/manifest.json", { version: 2, generationId: "empty", updatedAt: "", markets: {} }); }
async function readIndex<T>(generationId: string, path: string, fallback: T) { return readDataJson<T>(generationPath(generationId, `indexes/${path}`), fallback); }
'''
new_manifest = '''const MANIFEST_CACHE_MS = Math.max(250, Number(process.env.CATALOG_MANIFEST_CACHE_MS || 2_000));
let manifestCache: { expiresAt: number; promise: Promise<CatalogManifest> } | null = null;
async function readManifest(): Promise<CatalogManifest> {
  const now = Date.now();
  if (manifestCache && manifestCache.expiresAt > now) return manifestCache.promise;
  const promise = readDataJson<CatalogManifest>("catalog/manifest.json", { version: 2, generationId: "empty", updatedAt: "", markets: {} })
    .catch((error) => { manifestCache = null; throw error; });
  manifestCache = { expiresAt: now + MANIFEST_CACHE_MS, promise };
  return promise;
}
async function readIndex<T>(generationId: string, path: string, fallback: T) { return readDataJson<T>(generationPath(generationId, `indexes/${path}`), fallback); }
'''
if old_manifest not in s:
    raise SystemExit('manifest block not found')
s = s.replace(old_manifest, new_manifest, 1)

old_projection = '''async function readSearchProjection(generationId: string, market: string) {
  return readIndex<{ generationId: string; items: CatalogSearchProjection[] }>(generationId, `projection/${cleanShard(market)}.json`, { generationId, items: [] });
}
'''
new_projection = '''const SEARCH_PROJECTION_CACHE_MAX = Math.max(1, Math.min(14, Number(process.env.CATALOG_SEARCH_PROJECTION_CACHE_MAX || 8)));
const searchProjectionCache = new Map<string, Promise<{ generationId: string; items: CatalogSearchProjection[] }>>();
let projectionCacheGeneration = "";
async function readSearchProjection(generationId: string, market: string) {
  if (projectionCacheGeneration && projectionCacheGeneration !== generationId) searchProjectionCache.clear();
  projectionCacheGeneration = generationId;
  const key = `${generationId}:${cleanShard(market)}`;
  const current = searchProjectionCache.get(key);
  if (current) return current;
  const promise = readIndex<{ generationId: string; items: CatalogSearchProjection[] }>(generationId, `projection/${cleanShard(market)}.json`, { generationId, items: [] })
    .catch((error) => { searchProjectionCache.delete(key); throw error; });
  searchProjectionCache.set(key, promise);
  while (searchProjectionCache.size > SEARCH_PROJECTION_CACHE_MAX) {
    const oldest = searchProjectionCache.keys().next().value as string | undefined;
    if (!oldest || oldest === key) break;
    searchProjectionCache.delete(oldest);
  }
  return promise;
}
'''
if old_projection not in s:
    raise SystemExit('projection block not found')
s = s.replace(old_projection, new_projection, 1)

old_search = '''export async function searchOffers(params: CatalogSearchParams) {
  const manifest = await readManifest();
  const page = Math.max(1, Number(params.page || 1));
  const pageSize = Math.min(48, Math.max(1, Number(params.pageSize || 24)));
  const { ids, used } = await candidateIds(manifest, params);
  const byId = await readIndex<{ byId: Record<string, OfferLocation> }>(manifest.generationId, "offers-by-id.json", { byId: {} });
  const order = await readIndex<{ ids: string[] }>(manifest.generationId, "order-updatedAt.json", { ids: Object.keys(byId.byId) });
  const idList = ids ? order.ids.filter((id) => ids.has(id)) : order.ids;
  const needsProjection = Boolean(params.budgetFrom || params.budgetTo || params.yearFrom || params.yearTo || params.mileageFrom || params.mileageTo
    || params.engineFrom || params.engineTo || params.powerFrom || params.powerTo || params.auctionGrade || params.auctionDateFrom || params.auctionDateTo
    || (params.sort && params.sort !== "updatedAt"));
'''
new_search = '''export async function searchOffers(params: CatalogSearchParams) {
  const manifest = await readManifest();
  const page = Math.max(1, Number(params.page || 1));
  const pageSize = Math.min(48, Math.max(1, Number(params.pageSize || 24)));
  const needsProjection = Boolean(params.budgetFrom || params.budgetTo || params.yearFrom || params.yearTo || params.mileageFrom || params.mileageTo
    || params.engineFrom || params.engineTo || params.powerFrom || params.powerTo || params.auctionGrade || params.auctionDateFrom || params.auctionDateTo
    || (params.sort && params.sort !== "updatedAt"));

  // Current generations contain a compact per-market projection with every field
  // required by public cards and filters. Prefer that single object over reading a
  // market shard + multiple range shards + offers-by-id + ordering and then the
  // same projection again. The Promise cache above also lets facets + results in
  // the same server render share one immutable generation read.
  const directMarkets = params.market && params.market !== "any" ? [String(params.market)] : MARKETS;
  const directProjectionParts = await mapWithConcurrency(directMarkets, Math.min(7, directMarkets.length || 1), async (market) => ({
    market, projection: await readSearchProjection(manifest.generationId, market),
  }));
  const directProjectionReady = directProjectionParts.every(({ market, projection }) =>
    (projection.items || []).length > 0 || Number(manifest.markets?.[market]?.count || 0) === 0);
  if (directProjectionReady) {
    const modelKeys = await projectionModelKeys(params);
    const rows = directProjectionParts.flatMap(({ projection }) => projection.items || [])
      .filter((row) => catalogSearchProjectionMatches(row, params, modelKeys));
    if (needsProjection) {
      catalogSearchProjectionSort(rows, params.sort || "updatedAt");
    } else {
      rows.sort((a, b) => {
        const af = Date.parse(String(a.sourcePublishedAt || a.firstSeenAt || a.updatedAt || "")) || 0;
        const bf = Date.parse(String(b.sourcePublishedAt || b.firstSeenAt || b.updatedAt || "")) || 0;
        return bf - af || String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
      });
    }
    const total = rows.length;
    const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
    if (pageRows.every(projectionCanRenderCard)) {
      return {
        generationId: manifest.generationId, total, page, pageSize,
        items: pageRows.map(publicOfferFromProjection),
        usedIndexShards: directMarkets.map((market) => `catalog/generations/${manifest.generationId}/indexes/projection/${cleanShard(market)}.json`),
      };
    }
  }

  const { ids, used } = await candidateIds(manifest, params);
  const byId = await readIndex<{ byId: Record<string, OfferLocation> }>(manifest.generationId, "offers-by-id.json", { byId: {} });
  const order = await readIndex<{ ids: string[] }>(manifest.generationId, "order-updatedAt.json", { ids: Object.keys(byId.byId) });
  const idList = ids ? order.ids.filter((id) => ids.has(id)) : order.ids;
'''
if old_search not in s:
    raise SystemExit('searchOffers prefix not found')
s = s.replace(old_search, new_search, 1)
p.write_text(s)
print('projection_first_search_patch_ok')

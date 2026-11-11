import {assertScopedProjectionReaderReady} from './catalog-projection-reader-readiness.mjs';

// Japan's public route is AJES-owned, not an immutable local-generation shard.
// A cached count alone is never sufficient proof that this market is available.
export async function verifyRepairLiveJapan(fetchImpl = fetch, expectedRelease, now = Date.now()) {
  const before = await assertScopedProjectionReaderReady(fetchImpl);
  if (expectedRelease && before.releaseSha !== expectedRelease) throw Error('catalog_repair_live_release_changed');
  const response = await fetchImpl('https://avtocena.com/api/catalog/search?market=japan&page=1&pageSize=5',
    {cache:'no-store',signal:AbortSignal.timeout(30_000)});
  if (!response.ok) throw Error(`catalog_repair_live_japan_http_${response.status}`);
  const page = await response.json();
  const observed = Date.parse(page.observedAt || page.generationId || '');
  if (page.ok !== true || page.partial || page.stale || page.interrupted || page.scanLimited
    || !Number.isSafeInteger(page.total) || page.total <= 0 || !Array.isArray(page.items)
    || page.items.length !== Math.min(5,page.total) || page.countSummary?.stale
    || page.countSummary?.upperBound || !Number.isFinite(observed) || observed > now + 60_000 || now - observed > 15 * 60_000
    || page.items.some(row => row.market !== 'japan' || !/^ajes-stats-[A-Za-z0-9_-]+$/.test(row.id || ''))
    || new Set(page.items.map(row => row.id)).size !== page.items.length) throw Error('catalog_repair_live_japan_unverified');
  const after = await assertScopedProjectionReaderReady(fetchImpl);
  if (after.releaseSha !== before.releaseSha) throw Error('catalog_repair_live_release_changed');
  return {market:'japan',owner:'ajes_japan_feed',releaseSha:before.releaseSha,observedAt:new Date(observed).toISOString(),
    total:page.total,sampled:page.items.length,ids:page.items.map(row => row.id)};
}

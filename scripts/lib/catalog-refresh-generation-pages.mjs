import {validateOverviewSourceShard} from './catalog-overview-source-validation.mjs';

// Only derivatives under the captured generation may be changed. A publisher
// can build another generation concurrently; no shared alias or lease is touched.
export async function refreshGenerationPages({storage, markets, buildLanding, prepareRows, buildOverview,
  landingPath, overviewPath, now = () => new Date(), skipReady = false, policyNow}) {
  const day = () => new Date(now().getTime() + 7 * 3600000).toISOString().slice(0, 10);
  const capturedDay = day();
  const policyDate = policyNow ? new Date(policyNow.getTime()+7*3600000).toISOString().slice(0,10) : capturedDay;
  if(policyNow && (policyDate<capturedDay || policyNow.getTime()-now().getTime()>3*86400000))throw Error("catalog_pages_horizon_invalid");
  const manifest = await storage.readJson('catalog/manifest.json', null);
  const generationId = manifest?.generationId;
  if (!generationId || !/^[a-zA-Z0-9_-]+$/.test(generationId)) throw Error('catalog_pages_manifest_invalid');
  const prefix = `catalog/generations/${generationId}/indexes/`;
  const scoped = path => {
    if (!path.startsWith(prefix) || path.includes('..')) throw Error('catalog_pages_unscoped_write');
    return path;
  };
  const check = async () => {
    const current = await storage.readJson('catalog/manifest.json', null);
    if (current?.generationId !== generationId) throw Error('catalog_pages_generation_changed_retry');
    if (day() !== capturedDay) throw Error('catalog_pages_date_changed_retry');
  };
  const readPrevious = async path => {
    const previous = await storage.readJsonWithMeta(scoped(path), null);
    if (previous.found && !previous.etag) throw Error('catalog_pages_etag_required');
    return previous;
  };
  const write = async (path, payload, previous) => {
    await check();
    await storage.writeJson(scoped(path), payload, previous.found ? {ifMatch: previous.etag} : {ifNoneMatch: '*'});
  };
  const path = overviewPath(generationId);
  const previousOverview = await readPrevious(path);
  const previous = previousOverview.value;
  if (skipReady && previous?.generationId === generationId && previous.policyDate === policyDate
      && previous.dailyLandingsVersion === 1 && previous.facets?.generationId === generationId) {
    await check();
    return {generationId, policyDate, alreadyPrepared: true};
  }
  const rows = [], counts = {}, results = [];
  for (const market of markets) {
    const count = Number(manifest.markets?.[market]?.count || 0);
    if (!Number.isInteger(count) || count < 0) throw Error('catalog_pages_source_count_invalid');
    const projection = count ? await storage.readJson(`${prefix}projection/${market}.json`, null)
      : {generationId, items: []};
    validateOverviewSourceShard(projection, generationId, market, count);
    const target = landingPath(generationId, market);
    const previousLanding = await readPrevious(target);
    const landing = await buildLanding(generationId, market, projection.items);
    if (landing.generationId !== generationId || landing.policyDate !== policyDate
        || landing.market !== market || landing.sourceTotal !== count) throw Error('catalog_pages_landing_invalid');
    await write(target, landing, previousLanding);
    for (const row of prepareRows(projection.items)) rows.push(row);
    counts[market] = count;
    results.push({market, sourceTotal: count, total: landing.total});
  }
  const overview = await buildOverview(generationId, rows);
  if (overview.generationId !== generationId || overview.facets?.generationId !== generationId
      || overview.policyDate !== policyDate) throw Error('catalog_pages_overview_invalid');
  for (const market of markets) {
    if (!overview.markets[market]) throw Error('catalog_pages_market_missing');
    overview.markets[market].sourceTotal = counts[market];
  }
  overview.dailyLandingsVersion = 1;
  await write(path, overview, previousOverview);
  await check();
  return {generationId, policyDate, path, markets: results, generationScopedOnly: true};
}

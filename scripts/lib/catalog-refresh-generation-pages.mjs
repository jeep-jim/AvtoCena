import {validateOverviewSourceShard} from './catalog-overview-source-validation.mjs';

export async function refreshGenerationPagesWindow({refreshDay, getGeneration, now = () => new Date()}) {
  if (typeof getGeneration !== 'function') throw Error('catalog_pages_generation_reader_required');
  const day = date => new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10);
  for (let attempt = 0; attempt < 2; attempt++) {
    const captured = now(), capturedDay = day(captured), results = [];
    const checkDay = () => {
      if (day(now()) !== capturedDay) throw Error('catalog_pages_date_changed_retry');
    };
    try {
      const generationId = await getGeneration();
      if (!generationId || !/^[a-zA-Z0-9_-]+$/.test(generationId)) throw Error('catalog_pages_manifest_invalid');
      for (let offset = 0; offset < 3; offset++) {
        checkDay();
        const result = await refreshDay(new Date(captured.getTime() + offset * 86400000), offset);
        if (result?.generationId !== generationId) throw Error('catalog_pages_generation_changed_retry');
        results.push(result);
        checkDay();
      }
      // A publisher can commit between dated builds or after the last ready read.
      // Success must describe the complete window for the generation still active.
      if (await getGeneration() !== generationId) throw Error('catalog_pages_generation_changed_retry');
      checkDay();
      return results;
    } catch (error) {
      // Date and generation turnover share one retry; source and CAS failures never retry.
      if (attempt || !(error instanceof Error)
          || !['catalog_pages_date_changed_retry', 'catalog_pages_generation_changed_retry'].includes(error.message)) throw error;
    }
  }
}

// Match the overview version and market completeness required by the homepage
// reader (catalogOverviewMarketComplete with its requested ten-card sample).
function completeOverviewMarkets(overview, manifest, markets, isPublished) {
  if (overview.version !== 1 || overview.publicPolicyVersion !== 2) return false;
  return markets.every(market => {
    const count = Number(manifest.markets?.[market]?.count || 0), summary = overview.markets?.[market];
    if (!Number.isInteger(count) || count < 0 || !summary || !Number.isInteger(summary.total)
        || summary.total < 0 || summary.total > count || (summary.sourceTotal ?? summary.total) !== count
        || (count > 0 && summary.total === 0) || !Array.isArray(summary.items)
        || summary.items.some(item => !item?.id || item.market !== market)
        || new Set(summary.items.map(item => item.id)).size !== summary.items.length) return false;
    return summary.items.filter(isPublished).length >= Math.min(10, summary.total);
  });
}

// Only derivatives under the captured generation may be changed. A publisher
// can build another generation concurrently; no shared alias or lease is touched.
export async function refreshGenerationPages({storage, markets, buildLanding, prepareRows, buildOverview,
  landingPath, overviewPath, now = () => new Date(), skipReady = false, policyNow, landingsOnly = false,
  isPublished = () => true, buildEditorial, editorialPath, validEditorial, editorialRevision}) {
  const editorialEnabled=!landingsOnly&&!!buildEditorial;
  if(editorialEnabled&&(!editorialPath||!validEditorial||typeof editorialRevision!=='string'||!editorialRevision))throw Error('catalog_pages_editorial_builder_required');
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
  const path = landingsOnly ? null : overviewPath(generationId);
  const previousOverview = landingsOnly ? {value:null} : await readPrevious(path);
  const previous = previousOverview.value;
  const editPath=editorialEnabled?editorialPath(generationId):null;
  const previousEditorial=editorialEnabled?await readPrevious(editPath):null;
  if (skipReady && previous?.generationId === generationId && previous.policyDate === policyDate
      && previous.dailyLandingsVersion === 1 && previous.facets?.generationId === generationId
      && completeOverviewMarkets(previous, manifest, markets, isPublished)
      && (!editorialEnabled||validEditorial(previousEditorial.value,previous,editorialRevision,policyDate))) {
    await check();
    return {generationId, policyDate, alreadyPrepared: true};
  }
  const rows = [], sourceRows = [], counts = {}, results = [];
  for (const market of markets) {
    const count = Number(manifest.markets?.[market]?.count || 0);
    if (!Number.isInteger(count) || count < 0) throw Error('catalog_pages_source_count_invalid');
    const projection = count ? await storage.readJson(`${prefix}projection/${market}.json`, null)
      : {generationId, items: []};
    validateOverviewSourceShard(projection, generationId, market, count);
    if(editorialEnabled)for(const row of projection.items)sourceRows.push(row);
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
  if(landingsOnly){await check();return {generationId,policyDate,markets:results,generationScopedOnly:true,landingsOnly:true};}
  const overview = await buildOverview(generationId, rows);
  if (overview.generationId !== generationId || overview.facets?.generationId !== generationId
      || overview.policyDate !== policyDate) throw Error('catalog_pages_overview_invalid');
  for (const market of markets) {
    if (!overview.markets[market]) throw Error('catalog_pages_market_missing');
    overview.markets[market].sourceTotal = counts[market];
  }
  if(editorialEnabled){
    const editorial=await buildEditorial(generationId,sourceRows);
    if(!validEditorial(editorial,overview,editorialRevision,policyDate))throw Error('catalog_pages_editorial_snapshot_invalid');
    await write(editPath,editorial,previousEditorial);
    const verified=await storage.readJson(scoped(editPath),null);
    if(JSON.stringify(verified)!==JSON.stringify(editorial))throw Error('catalog_pages_editorial_readback_mismatch');
  }
  overview.dailyLandingsVersion = 1;
  await write(path, overview, previousOverview);
  await check();
  return {generationId, policyDate, path, markets: results, generationScopedOnly: true};
}

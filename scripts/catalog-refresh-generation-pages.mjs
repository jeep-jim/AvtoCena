import {generationPagePreparation,HOME_OVERVIEW_MARKETS,RELEASE_MARKETS,releaseHomeCatalogFlag} from './lib/release-market-scope.mjs';
import {overviewSourceCountsMatchManifest} from './lib/catalog-overview-source-validation.mjs';
const requireHomeCatalog=releaseHomeCatalogFlag(process.env.RELEASE_REQUIRE_HOME_CATALOG);
const preparation=generationPagePreparation(process.env.RELEASE_PREPARATION_MARKETS,requireHomeCatalog);
import {refreshGenerationPages} from './lib/catalog-refresh-generation-pages.mjs';
const {getJsonStorage} = await import('../apps/web/lib/data.ts');
const {buildCatalogMarketLanding, prepareCatalogProjectionRowsForDate, buildCatalogOverviewFromProjections,
  catalogMarketLandingPath} = await import('../apps/web/lib/catalog/storage.ts');
const {catalogOverviewGenerationPath,catalogOverviewMatchesGeneration,catalogOverviewMarketComplete} = await import('../apps/web/lib/catalog/overview.ts');
const {datedCatalogPagePath}=await import('../apps/web/lib/catalog/dated-pages.ts');
const {publicationWithdrawn}=await import('../apps/web/lib/catalog/publication-policy.ts');
// Reuse the same completeness contract as the visitor's bounded home read.
// Do not trust an old ready marker without checking every saved local market.
const overviewComplete=requireHomeCatalog?(overview,{generationId,manifest,policyDate})=>
 overview?.policyDate===policyDate&&catalogOverviewMatchesGeneration(overview,generationId)
 &&overviewSourceCountsMatchManifest(overview,manifest,RELEASE_MARKETS)&&HOME_OVERVIEW_MARKETS.every(market=>{
  const count=Number(manifest.markets?.[market]?.count||0);
  const summary=overview.markets?.[market];
  return Number.isInteger(count)&&count>=0&&Array.isArray(summary?.items)&&catalogOverviewMarketComplete(
   {...summary,items:summary.items.filter(item=>item&&!publicationWithdrawn(item))},count,10);
 }):undefined;
// Three exact days cover delayed cron delivery without serving yesterday's counts.
const captured=new Date();
for(let offset=0;offset<3;offset++){
  const now=new Date(captured.getTime()+offset*86400000);
  const day=new Date(now.getTime()+7*3600000).toISOString().slice(0,10);
  const dated=path=>offset ? datedCatalogPagePath(path,day) : path;
  console.log(JSON.stringify(await refreshGenerationPages({storage:getJsonStorage(),...preparation,overviewComplete,
    buildLanding:(g,m,rows)=>buildCatalogMarketLanding(g,m,rows,{now}),
    prepareRows:rows=>prepareCatalogProjectionRowsForDate(rows,now),
    buildOverview:(g,rows)=>buildCatalogOverviewFromProjections(g,rows,{now}),
    landingPath:(g,m)=>dated(catalogMarketLandingPath(g,m)),
    overviewPath:g=>dated(catalogOverviewGenerationPath(g)),policyNow:now,
    skipReady:process.env.CATALOG_OVERVIEW_SKIP_READY==='true'}),null,2));
}

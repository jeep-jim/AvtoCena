import {releaseMarkets} from './lib/release-market-scope.mjs';
const selectedMarkets=releaseMarkets(process.env.RELEASE_PREPARATION_MARKETS);
import {refreshGenerationPages} from './lib/catalog-refresh-generation-pages.mjs';
const {getJsonStorage} = await import('../apps/web/lib/data.ts');
const {buildCatalogMarketLanding, prepareCatalogProjectionRowsForDate, buildCatalogOverviewFromProjections,
  catalogMarketLandingPath} = await import('../apps/web/lib/catalog/storage.ts');
const {catalogOverviewGenerationPath} = await import('../apps/web/lib/catalog/overview.ts');
const {PUBLIC_CATALOG_MARKETS} = await import('../apps/web/lib/catalog/runtime-config.ts');
const {datedCatalogPagePath}=await import('../apps/web/lib/catalog/dated-pages.ts');
// Three exact days cover delayed cron delivery without serving yesterday's counts.
const captured=new Date();
for(let offset=0;offset<3;offset++){
  const now=new Date(captured.getTime()+offset*86400000);
  const day=new Date(now.getTime()+7*3600000).toISOString().slice(0,10);
  const dated=path=>offset ? datedCatalogPagePath(path,day) : path;
  console.log(JSON.stringify(await refreshGenerationPages({storage:getJsonStorage(),markets:selectedMarkets||PUBLIC_CATALOG_MARKETS,landingsOnly:!!selectedMarkets,
    buildLanding:(g,m,rows)=>buildCatalogMarketLanding(g,m,rows,{now}),
    prepareRows:rows=>prepareCatalogProjectionRowsForDate(rows,now),
    buildOverview:(g,rows)=>buildCatalogOverviewFromProjections(g,rows,{now}),
    landingPath:(g,m)=>dated(catalogMarketLandingPath(g,m)),
    overviewPath:g=>dated(catalogOverviewGenerationPath(g)),policyNow:now,
    skipReady:process.env.CATALOG_OVERVIEW_SKIP_READY==='true'}),null,2));
}

import {releaseMarkets} from './lib/release-market-scope.mjs';
// Release preparation runs on the checkout, while Docker sets AVTOCENA_RELEASE_SHA.
// Bind both to the controller's exact source before importing runtime helpers.
const preparationRelease=process.env.RELEASE_SOURCE_SHA||process.env.GITHUB_SHA;
if(preparationRelease){
 if(!/^[a-f0-9]{40}$/.test(preparationRelease))throw Error('catalog_pages_release_invalid');
 if(process.env.AVTOCENA_RELEASE_SHA&&process.env.AVTOCENA_RELEASE_SHA!==preparationRelease)throw Error('catalog_pages_release_mismatch');
 process.env.AVTOCENA_RELEASE_SHA=preparationRelease;
}
if(process.env.AVTOCENA_RELEASE_SHA&&!/^[a-f0-9]{40}$/.test(process.env.AVTOCENA_RELEASE_SHA))throw Error('catalog_pages_release_invalid');
const selectedMarkets=releaseMarkets(process.env.RELEASE_PREPARATION_MARKETS);
import {refreshGenerationPages, refreshGenerationPagesWindow} from './lib/catalog-refresh-generation-pages.mjs';
const {getJsonStorage} = await import('../apps/web/lib/data.ts');
const {buildCatalogMarketLanding, prepareCatalogProjectionRowsForDate, buildCatalogOverviewFromProjections,
  catalogMarketLandingPath} = await import('../apps/web/lib/catalog/storage.ts');
const {catalogOverviewGenerationPath} = await import('../apps/web/lib/catalog/overview.ts');
const {PUBLIC_CATALOG_MARKETS} = await import('../apps/web/lib/catalog/runtime-config.ts');
const {datedCatalogPagePath}=await import('../apps/web/lib/catalog/dated-pages.ts');
const {publicationWithdrawn}=await import('../apps/web/lib/catalog/publication-policy.ts');
const storage=getJsonStorage();
// Three exact days cover delayed cron delivery without serving yesterday's counts.
await refreshGenerationPagesWindow({
 getGeneration:async()=>(await storage.readJson('catalog/manifest.json',null))?.generationId,
 refreshDay:async(now,offset)=>{
  const day=new Date(now.getTime()+7*3600000).toISOString().slice(0,10);
  const dated=path=>offset ? datedCatalogPagePath(path,day) : path;
  const result=await refreshGenerationPages({storage,markets:selectedMarkets||PUBLIC_CATALOG_MARKETS,landingsOnly:!!selectedMarkets,
    buildLanding:(g,m,rows)=>buildCatalogMarketLanding(g,m,rows,{now}),
    prepareRows:rows=>prepareCatalogProjectionRowsForDate(rows,now),
    buildOverview:(g,rows)=>buildCatalogOverviewFromProjections(g,rows,{now}),
    landingPath:(g,m)=>dated(catalogMarketLandingPath(g,m)),
    overviewPath:g=>dated(catalogOverviewGenerationPath(g)),policyNow:now,
    skipReady:process.env.CATALOG_OVERVIEW_SKIP_READY==='true',isPublished:item=>!publicationWithdrawn(item)});
  console.log(JSON.stringify(result,null,2));
  return result;
}});

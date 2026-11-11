import {releaseMarkets} from './lib/release-market-scope.mjs';
const selectedMarkets=releaseMarkets(process.env.RELEASE_PREPARATION_MARKETS);
import {refreshGenerationPages, refreshGenerationPagesWindow} from './lib/catalog-refresh-generation-pages.mjs';
const {getJsonStorage} = await import('../apps/web/lib/data.ts');
const {buildCatalogMarketLanding, prepareCatalogProjectionRowsForDate, buildCatalogOverviewFromProjections,
  catalogMarketLandingPath} = await import('../apps/web/lib/catalog/storage.ts');
const {catalogOverviewGenerationPath} = await import('../apps/web/lib/catalog/overview.ts');
const {PUBLIC_CATALOG_MARKETS} = await import('../apps/web/lib/catalog/runtime-config.ts');
const {datedCatalogPagePath}=await import('../apps/web/lib/catalog/dated-pages.ts');
const {publicationWithdrawn}=await import('../apps/web/lib/catalog/publication-policy.ts');
const {withCatalogEditorial,editorialRevision}=await import('../apps/web/lib/catalog/editorial.ts');
const storage=getJsonStorage();
// Three exact days cover delayed cron delivery without serving yesterday's counts.
const expectedEditorialRevision=await withCatalogEditorial(async()=>editorialRevision());
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
    skipReady:process.env.CATALOG_OVERVIEW_SKIP_READY==='true',isPublished:item=>!publicationWithdrawn(item),editorialRevision:expectedEditorialRevision});
  console.log(JSON.stringify(result,null,2));
  return result;
}});

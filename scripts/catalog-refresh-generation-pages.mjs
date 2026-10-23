import {refreshGenerationPages} from './lib/catalog-refresh-generation-pages.mjs';
const {getJsonStorage} = await import('../apps/web/lib/data.ts');
const {buildCatalogMarketLanding, prepareCatalogProjectionRows, buildCatalogOverviewFromProjections,
  catalogMarketLandingPath} = await import('../apps/web/lib/catalog/storage.ts');
const {catalogOverviewGenerationPath} = await import('../apps/web/lib/catalog/overview.ts');
const {PUBLIC_CATALOG_MARKETS} = await import('../apps/web/lib/catalog/runtime-config.ts');
console.log(JSON.stringify(await refreshGenerationPages({storage: getJsonStorage(), markets: PUBLIC_CATALOG_MARKETS,
  buildLanding: buildCatalogMarketLanding, prepareRows: prepareCatalogProjectionRows,
  buildOverview: buildCatalogOverviewFromProjections, landingPath: catalogMarketLandingPath,
  overviewPath: catalogOverviewGenerationPath, skipReady: process.env.CATALOG_OVERVIEW_SKIP_READY === 'true'}), null, 2));

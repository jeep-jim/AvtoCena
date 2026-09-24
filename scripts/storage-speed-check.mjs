// Read-only diagnostics; never changes source inventory or catalog manifests.
import { readDataJson } from '../apps/web/lib/data.ts';
import { readHomeCatalogSnapshot } from '../apps/web/lib/catalog/storage.ts';
const manifest = await readDataJson('catalog/manifest.json', null);
const overview = await readDataJson('catalog/public/overview.json', null);
const maintenance = await readDataJson('catalog/storage-maintenance.json', null);
console.log('STORAGE', JSON.stringify(maintenance));
console.log('OVERVIEW', JSON.stringify({generationId:manifest?.generationId,overviewGeneration:overview?.generationId,
  bytes:Buffer.byteLength(JSON.stringify(overview)),markets:Object.fromEntries(Object.entries(manifest?.markets || {}).map(([market,row])=>[market,{source:row.count,total:overview?.markets?.[market]?.total,sourceTotal:overview?.markets?.[market]?.sourceTotal,samples:overview?.markets?.[market]?.items?.length}]))}));
for (let attempt=1;attempt<=3;attempt++) {
  const start=performance.now();
  const home=await readHomeCatalogSnapshot(6);
  const readAt=performance.now();
  console.log('TIMING',JSON.stringify({attempt,readMs:Math.round(readAt-start),cards:home.items.length,generationId:home.generationId}));
}

const {readCatalogMarketPage} = await import('../apps/web/lib/catalog/market-page.ts');
const {readCatalogFacets} = await import('../apps/web/lib/catalog/storage.ts');
for (let attempt=1; attempt<=2; attempt++) {
  const started=performance.now();
  const result=await Promise.all([
    readCatalogFacets({market:'china'}).then(value=>({kind:'facets',ms:Math.round(performance.now()-started),makes:value.makes.length})),
    readCatalogMarketPage({market:'china',page:1}).then(value=>({kind:'page',ms:Math.round(performance.now()-started),cards:value.items.length,total:value.total})),
  ]);
  console.log('MARKET_TIMING', JSON.stringify({attempt,result,rssMiB:Math.round(process.memoryUsage().rss/1048576)}));
}

// Read-only diagnostics; never changes source inventory or catalog manifests.
import {getHeapStatistics} from 'node:v8';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {countCatalogOffers,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage.ts';
import { readDataJson } from '../apps/web/lib/data.ts';
import { readHomeCatalogSnapshot } from '../apps/web/lib/catalog/storage.ts';
import {catalogPublicationStatus} from './lib/catalog-publication-status.mjs';
const publicationStatus=await catalogPublicationStatus(getJsonStorage());
console.log('PUBLICATION_STATUS',JSON.stringify(publicationStatus));
// Avoid expensive full-catalog benchmarks while a publisher owns the lease.
if(publicationStatus.writer.active)process.exit(0);
// Aggregate-only diagnostics for ordinary filters; no listing payloads or credentials.
const memory=()=>Object.fromEntries(Object.entries(process.memoryUsage()).map(([k,v])=>[k,Math.round(v/1048576)]));
const probeStorage=getJsonStorage(),probeRead=probeStorage.readJsonWithMeta.bind(probeStorage);
probeStorage.readJsonWithMeta=async function(file,fallback){
 const started=performance.now();const result=await probeRead(file,fallback);
 const kind=file.endsWith('/budget-count-v1.json')?'compact-index':file.includes('/projection/')?'projection':null;
 if(kind)console.log('FILTER_READ',JSON.stringify({kind,ms:Math.round(performance.now()-started),found:result.found,complete:kind==='compact-index'?Array.isArray(result.value?.otherRows):undefined,rows:kind==='compact-index'?result.value?.rows?.length:result.value?.items?.length,otherRows:result.value?.otherRows?.length,memory:memory()}));
 return result;
};
try{
 resetCatalogReadCachesForTests();
 console.log('FILTER_START',JSON.stringify({heapLimitMiB:Math.round(getHeapStatistics().heap_size_limit/1048576),memory:memory()}));
 for(const query of [{bodyType:'suv'},{bodyType:'suv',market:'korea'},{yearFrom:2022,budgetTo:1600000,mileageTo:50000}]){
  const started=performance.now(),result=await countCatalogOffers(query);
  console.log('FILTER_COUNT',JSON.stringify({query,total:result.total,ms:Math.round(performance.now()-started),memory:memory()}));
 }
}finally{probeStorage.readJsonWithMeta=probeRead;resetCatalogReadCachesForTests();}
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

// Same six market/model queries used by the related-offer section.
const {searchOffers}=await import('../apps/web/lib/catalog/storage.ts');
for(let attempt=1;attempt<=2;attempt++){
  const started=performance.now();
  const results=await Promise.all(['china','korea','japan','uae','europe','georgia'].map(async market=>{
    const result=await searchOffers({market,make:'Nissan',model:'Sylphy',pageSize:24,sort:'updatedAt'});
    return {market,total:result.total,items:result.items.length,indexes:result.usedIndexShards};
  }));
  console.log('RELATED_TIMING',JSON.stringify({attempt,ms:Math.round(performance.now()-started),rssMiB:Math.round(process.memoryUsage().rss/1048576),results}));
}

import {getJsonStorage} from '../apps/web/lib/data.ts';
import {specificationSelectorDirectory} from '../apps/web/lib/catalog/budget-selector-codec.ts';
import {datedCatalogPagePath} from '../apps/web/lib/catalog/dated-pages.ts';
const storage=getJsonStorage();
const marker=JSON.parse(await (await import('node:fs/promises')).readFile('.github/market-runs/owner-search-state.json','utf8'));
if(marker.mode==='budget-failure-evidence'){
 const records=[];
 for(const table of ['stats','korea'])for(const slot of ['catalog-failure-'+table+'.json','catalog-failure-pages/'+table+'-list-1.json']){
  const value=await storage.readJson('integrations/ajes/'+slot,null);
  records.push({table,slot,...Object.fromEntries(['kind','page','pageSize','startedAt','finishedAt','httpStatus','outcome'].map(key=>[key,value?.[key]??null])),providerCode:/^(bot|ban)\d*$/i.test(value?.providerCode||'')?value.providerCode:null});
 }
 const editorial=await storage.readJson('catalog-editorial/current.json',null);
 const editedSellerPrices={};for(const market of ['japan','korea'])editedSellerPrices[market]=Object.values(editorial?.entries||{}).filter(row=>row.market===market&&row.status==='visible'&&row.sellerPrice).length;
 console.log('BUDGET_SOURCE_STATE',JSON.stringify({checkedAt:new Date().toISOString(),records,editedSellerPrices}));
}else{
const health=await fetch('https://avtocena.com/api/health',{signal:AbortSignal.timeout(15000)}).then(r=>r.json());
if(health.releaseSha!=='463fd22559a2f9c5acd60f8f5e4b269689215c84')throw Error('release_changed');
const [manifest,lock,editorial,binding]=await Promise.all([
 storage.readJson('catalog/manifest.json',null),storage.readJson('catalog/import-lock.json',null),
 storage.readJson('catalog-editorial/current.json',null),
 storage.readJson(`knowledge/encyclopedia/calculation-releases/${health.releaseSha}.json`,null),
]);
const root=`catalog/generations/${manifest.generationId}/indexes/`,day=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
const specPath=specificationSelectorDirectory(binding?.digest||null,health.calculationVersion||health.releaseSha)+'/ready.json';
const [spec,base,overview,dated]=await Promise.all([
 storage.readJson(root+specPath,null),storage.readJson(root+'budget-markets-v3/ready.json',null),
 storage.readJson(root+'overview.json',null),storage.readJson(datedCatalogPagePath(root+'overview.json',day),null),
]);
const compact=value=>value?{generationId:value.generationId,version:value.version,policyDate:value.policyDate,encyclopediaDigest:value.encyclopediaDigest,markets:Object.keys(value.markets||{})}:null;
const hidden={};for(const row of Object.values(editorial?.entries||{}))if(row.status!=='visible')hidden[row.market]=(hidden[row.market]||0)+1;
const report={checkedAt:new Date().toISOString(),health,manifest:{generationId:manifest.generationId,updatedAt:manifest.updatedAt,markets:manifest.markets},lock:lock?Object.fromEntries(['operationId','operationType','startedAt','lockedUntil','runId','workflowRunId','market','sourceIds'].filter(k=>k in lock).map(k=>[k,lock[k]])):null,hidden,specPath,specification:compact(spec),basic:compact(base),overview:compact(overview),dated:compact(dated)};
console.log('SEARCH_STATE',JSON.stringify(report));

}

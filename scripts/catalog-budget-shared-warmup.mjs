import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {backfillBudgetMarketSelectors,warmBudgetPriceCaches,searchOffers,searchOffersWithoutBudgetIndexForTests,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage.ts';

const storage=getJsonStorage();
if(storage.driver!=='object')throw Error('object_storage_required');
// This task only appends derived generation selectors and replaces disposable
// price caches. No collection, provider request, manifest/cursor/offer write.
const writes=storage.writeJson.bind(storage),read=storage.readJsonWithMeta.bind(storage);
storage.writeJson=async(path,value,condition)=>{
 if(!/^catalog\/(?:generations\/[^/]+\/indexes\/budget-markets-v[12]\/(?:ready|china|korea|japan|europe|uae|georgia)\.json|runtime-budget-prices-v1\/(?:china|korea|europe|uae|georgia)\.json)$/.test(path))throw Error('unexpected_write:'+path);
 return writes(path,value,condition);
};
let trace=[];
storage.readJsonWithMeta=async(path,fallback)=>{
 const result=await read(path,fallback);
 trace.push({path,bytes:result.found?Buffer.byteLength(JSON.stringify(result.value)):0});return result;
};
if(process.argv[2]==='--probe'){
 const params=JSON.parse(process.argv[3]);
 resetCatalogReadCachesForTests();trace=[];const cpu=process.cpuUsage(),start=performance.now();
 const first=await searchOffers(params);
 const reads=trace.slice(),elapsed=performance.now()-start,cpuUsed=process.cpuUsage(cpu);
 assert.equal(reads.some(row=>row.path.includes('budget-prices-v3/')),false,'cold instance must reuse a complete shared replay');
 assert.equal(reads.some(row=>row.path.endsWith('/budget-count-v3.json')),false,'single-market query must not download the all-market selector');
 resetCatalogReadCachesForTests();
 const repeated=await searchOffers(params);
 assert.equal(repeated.total,first.total);assert.deepEqual(repeated.items.map(row=>row.id),first.items.map(row=>row.id));
 const baseline=await searchOffersWithoutBudgetIndexForTests(params);
 assert.equal(first.total,baseline.total,'exact existing search count');
 assert.deepEqual(first.items.map(row=>row.id),baseline.items.map(row=>row.id),'exact existing page order');
 console.log(JSON.stringify({params,total:first.total,ids:first.items.map(row=>row.id),ms:Math.round(elapsed),cpuMs:Math.round((cpuUsed.user+cpuUsed.system)/1000),readBytes:reads.reduce((sum,row)=>sum+row.bytes,0),reads}));
}else{
const selectors=await backfillBudgetMarketSelectors();
const warmed=await warmBudgetPriceCaches();
const reports=[];
for(const params of [{market:'china',budgetTo:3000000,pageSize:12},{market:'china',budgetFrom:1500000,budgetTo:2500000,city:'Новокузнецк',yearFrom:2022,pageSize:12},{market:'korea',budgetTo:3000000,pageSize:12}]){
 const {stdout}=await promisify(execFile)(process.execPath,['--import','tsx',process.argv[1],'--probe',JSON.stringify(params)],{maxBuffer:4*1024*1024});
 reports.push(JSON.parse(stdout.trim().split('\n').at(-1)));
}
const report={at:new Date().toISOString(),release:process.env.AVTOCENA_RELEASE_SHA,selectors,warmed,reports};
await fs.writeFile('catalog-budget-shared-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));

}

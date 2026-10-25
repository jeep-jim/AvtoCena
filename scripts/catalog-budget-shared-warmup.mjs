import {calculatedCatalogPrice} from '../apps/web/lib/catalog/calculated-price.ts';
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {catalogPowerBand} from '../apps/web/lib/catalog/power-mix.ts';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {backfillBudgetSpecificationSelectors,backfillBudgetMarketSelectors,warmBudgetPriceCaches,searchOffers,searchOffersWithoutBudgetIndexForTests,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage.ts';

const storage=getJsonStorage();
if(storage.driver!=='object')throw Error('object_storage_required');
// This task only appends derived generation selectors and replaces disposable
// price caches. No collection, provider request, manifest/cursor/offer write.
const writes=storage.writeJson.bind(storage),read=storage.readJsonWithMeta.bind(storage);
storage.writeJson=async(path,value,condition)=>{
 if(!/^catalog\/(?:generations\/[^/]+\/indexes\/budget-markets-v(?:(?:[12345]|[67]\/[a-f0-9]{64})\/(?:ready|china|korea|japan|europe|uae|georgia)|(?:3|7\/[a-f0-9]{64})\/parts\/(?:china|korea|japan|europe|uae|georgia)\/[a-f0-9]{64})\.json|runtime-(?:budget|sort)-prices-v[12]\/(?:china|korea|europe|uae|georgia)\.json)$/.test(path))throw Error('unexpected_write:'+path);
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
 if(JSON.stringify(first.items.map(row=>row.id))!==JSON.stringify(baseline.items.map(row=>row.id))){
  // Public ordering inputs only; never dump full offers, provider payloads or credentials.
  const describe=row=>({id:row.id,totalRub:row.totalRub,powerHp:row.powerHp,utilizationPowerKw:row.utilizationPowerKw,powertrainKind:row.powertrainKind,fuel:row.fuel,powerBand:catalogPowerBand(row),sourceGroup:row.sourceGroup,auctionDate:row.auctionDate,sourcePublishedAt:row.sourcePublishedAt,firstSeenAt:row.firstSeenAt,updatedAt:row.updatedAt});
  console.error(JSON.stringify({event:'budget_order_mismatch',params,indexed:first.items.map(describe),baseline:baseline.items.map(describe)}));
 }
 assert.deepEqual(first.items.map(row=>row.id),baseline.items.map(row=>row.id),'exact existing page order');
 assert.deepEqual(first.items.map(row=>[row.id,calculatedCatalogPrice(row),row.sellerPriceRub||null]),baseline.items.map(row=>[row.id,calculatedCatalogPrice(row),row.sellerPriceRub||null]),'exact existing page prices');
 console.log(JSON.stringify({params,total:first.total,ids:first.items.map(row=>row.id),ms:Math.round(elapsed),cpuMs:Math.round((cpuUsed.user+cpuUsed.system)/1000),readBytes:reads.reduce((sum,row)=>sum+row.bytes,0),reads}));
}else{
const selectors=await backfillBudgetMarketSelectors();
await backfillBudgetSpecificationSelectors();
const warmed=await warmBudgetPriceCaches();
// Reuse the existing off-server preparation cadence for displayed-price sorting.
// One market at a time; only one visible card is read, no inventory writes.
const sorted=[];
for(const market of ["china","korea","europe","uae","georgia"]){
 const start=performance.now();const result=await searchOffers({market,sort:"totalRub",pageSize:1});
 sorted.push({market,total:result.total,ms:Math.round(performance.now()-start)});
}

const reports=[];
for(const params of [{market:'china',budgetTo:3000000,pageSize:12},{market:'china',budgetFrom:1500000,budgetTo:2500000,city:'Новокузнецк',yearFrom:2022,pageSize:12},{market:'korea',budgetTo:3000000,pageSize:12}]){
 const {stdout}=await promisify(execFile)(process.execPath,['--import','tsx',process.argv[1],'--probe',JSON.stringify(params)],{maxBuffer:4*1024*1024});
 reports.push(JSON.parse(stdout.trim().split('\n').at(-1)));
}
const report={at:new Date().toISOString(),release:process.env.AVTOCENA_RELEASE_SHA,selectors,warmed,sorted,reports};
await fs.writeFile('catalog-budget-shared-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));

}

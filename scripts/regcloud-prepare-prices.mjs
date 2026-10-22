import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {backfillBudgetSpecificationSelectors,backfillBudgetMarketSelectors, warmBudgetPriceCaches, searchOffers, searchOffersWithoutBudgetIndexForTests} from '../apps/web/lib/catalog/storage.ts';
const storage=getJsonStorage();
if(storage.driver!=='object')throw Error('object_storage_required');
const manifest=await storage.readJson('catalog/manifest.json',null);
const lock=await storage.readJson('catalog/import-lock.json',null);
if(!manifest?.generationId || lock && Date.parse(lock.lockedUntil)>Date.now())throw Error('publication_not_ready');
const write=storage.writeJson.bind(storage);
storage.writeJson=async(path,value,condition)=>{
 if(!/^catalog\/(?:generations\/[^/]+\/indexes\/budget-markets-v(?:[12345]|6\/[a-f0-9]{64})\/(?:ready|china|korea|japan|europe|uae|georgia)\.json|runtime-(?:budget|sort)-prices-v[12]\/(?:china|korea|europe|uae|georgia)\.json)$/.test(path))throw Error('unexpected_derived_write');
 const current=await storage.readJson('catalog/manifest.json',null);
 if(current?.generationId!==manifest.generationId)throw Error('publication_changed');
 return write(path,value,condition);
};
console.log('selectors',JSON.stringify(await backfillBudgetMarketSelectors()));
console.log('specifications',JSON.stringify(await backfillBudgetSpecificationSelectors()));
console.log('budget',JSON.stringify(await warmBudgetPriceCaches()));
for(const market of ['korea','china','europe','uae','georgia']){
 const start=performance.now();const result=await searchOffers({market,sort:'totalRub',pageSize:1});
 if(!result.total || !result.items.length)throw Error('empty_market:'+market);
 console.log(JSON.stringify({market,total:result.total,ms:Math.round(performance.now()-start)}));
}

for(const params of [{market:'china',engineTo:2000,budgetTo:3000000,pageSize:24},{market:'korea',engineTo:2000,powerTo:160,pageSize:24}]){
 const compact=await searchOffers(params),baseline=await searchOffersWithoutBudgetIndexForTests(params);
 assert.equal(compact.total,baseline.total,'specification filter count must equal full authoritative search');
 assert.deepEqual(compact.items.map(row=>row.id),baseline.items.map(row=>row.id),'specification filter order must equal full authoritative search');
 console.log('specification-parity',JSON.stringify({params,total:compact.total,passed:true}));
}

import {releaseMarkets,RELEASE_MARKETS} from './lib/release-market-scope.mjs';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {backfillBudgetSpecificationSelectors,backfillBudgetMarketSelectors, warmBudgetPriceCaches, searchOffers, searchOffersWithoutBudgetIndexForTests} from '../apps/web/lib/catalog/storage.ts';
const markets=releaseMarkets(process.env.RELEASE_PREPARATION_MARKETS);
const storage=getJsonStorage();
if(storage.driver!=='object')throw Error('object_storage_required');
const manifest=await storage.readJson('catalog/manifest.json',null);
const lock=markets?null:await storage.readJson('catalog/import-lock.json',null);
if(!manifest?.generationId || lock && Date.parse(lock.lockedUntil)>Date.now())throw Error('publication_not_ready');
const write=storage.writeJson.bind(storage);
storage.writeJson=async(path,value,condition)=>{
 if(!/^catalog\/(?:generations\/[^/]+\/indexes\/budget-markets-v(?:(?:[12345]|[67]\/[a-f0-9]{64})\/(?:ready|china|korea|japan|europe|uae|georgia)|(?:3|7\/[a-f0-9]{64})\/parts\/(?:china|korea|japan|europe|uae|georgia)\/[a-f0-9]{64})\.json|runtime-(?:budget|sort)-prices-v(?:[12]\/(?:china|korea|europe|uae|georgia)|3\/(?:china|korea|europe|uae|georgia)\/[a-f0-9]{64})\.json)$/.test(path))throw Error('unexpected_derived_write');
 const current=await storage.readJson('catalog/manifest.json',null);
 if(current?.generationId!==manifest.generationId)throw Error('publication_changed');
 return write(path,value,condition);
};
const results=[];
for(const market of markets||RELEASE_MARKETS){
 try{
 await backfillBudgetMarketSelectors([market]);
 const specifications=await backfillBudgetSpecificationSelectors([market]);
 console.log('specifications',JSON.stringify({market,generationId:specifications.generationId,ready:!!specifications.markets[market]}));
 console.log('budget',JSON.stringify(await warmBudgetPriceCaches([market])));
 if(market!=='japan'){
 const start=performance.now();const result=await searchOffers({market,sort:'totalRub',pageSize:1});
 if(!result.total || !result.items.length)throw Error('empty_market:'+market);
 console.log(JSON.stringify({market,total:result.total,ms:Math.round(performance.now()-start)}));
}

for(const params of [{market:'china',make:'Volkswagen',page:2,pageSize:24},{market:'europe',make:'BMW',page:2,pageSize:24},{market:'china',engineTo:2000,budgetTo:3000000,pageSize:24},{market:'korea',engineTo:2000,powerTo:160,pageSize:24},{market:'uae',make:'Audi',model:'A3',budgetFrom:3000000,budgetTo:3300000,pageSize:24},{market:'korea',drive:'fwd',transmission:'dct',pageSize:24}].filter(params=>params.market===market)){
 const compact=await searchOffers(params),baseline=await searchOffersWithoutBudgetIndexForTests(params);
 if(params.make && !params.budgetFrom && !params.budgetTo){
  assert.ok(compact.items.length>0,'default brand acceptance must cover a real populated page');
  assert.ok(compact.usedIndexShards.every(path=>/^budget-cards-v[123]\//.test(path)),'default brand page must use bounded visible card blocks');
 }
 assert.equal(compact.total,baseline.total,'specification filter count must equal full authoritative search');
 assert.deepEqual(compact.items.map(row=>row.id),baseline.items.map(row=>row.id),'specification filter order must equal full authoritative search');
 console.log('specification-parity',JSON.stringify({params,total:compact.total,passed:true}));
}

 results.push({market,status:'success'});
 }catch(error){results.push({market,status:'failure',error:error.message});console.error('MARKET_PREPARATION_FAILED',market,error.message);}
}
writeFileSync('release-market-preparation.json',JSON.stringify({markets:markets||RELEASE_MARKETS,generationId:manifest.generationId,results},null,2));
if(results.some(r=>r.status==='failure'))throw Error('market_preparation_failed:'+results.filter(r=>r.status==='failure').map(r=>r.market).join(','));

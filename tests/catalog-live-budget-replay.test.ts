import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {priceCardForCity} from '../apps/web/lib/catalog/card-city-delivery';
import {splitBudgetReplayIndex,budgetReplayOffer,buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {applyActiveBusinessPriceBatch} from '../apps/web/lib/catalog/live-business-pricing';
import {calculateRussiaCustomsForIndividual} from '../packages/engine/src/calculation/russiaCustomsV2';
import {searchOffers,countCatalogOffers,readCatalogFacets,readCatalogBrandCounts,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {invalidateEffectiveMarketsCache} from '../apps/web/lib/effective-market-settings';

test('live budget moves offers across both bounds after FX changes and shares exact counts, facets and pagination',async()=>{
 const storage=getJsonStorage(),original=storage.readJsonWithMeta;
 const generationId='live-budget-fx';const reads:string[]=[];
 let index:any;let rows:any[]=[];let chunks=new Map<string,any>();
 const today=new Date().toISOString().slice(0,10),year=new Date().getUTCFullYear()-4;
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  reads.push(key);let value:any;
  if(key==='catalog/manifest.json')value={generationId,markets:{korea:{count:2}}};
  else if(key==='markets/markets.json')value=[{id:'korea',versions:[{id:'current',status:'active',securityDepositRub:110000}]}];
  else if(key==='fees/exchange-rates.json')value={rates:[['KRW',0.065],['EUR',95],['USD',85]].map(([currency,rate])=>({currency,cbrRate:rate,nominal:1,effectiveRate:rate,rateDate:today,rateSource:'cbr'}))};
  else if(key.endsWith('/budget-count-v3.json'))value=index;
  else if(key.includes('/budget-prices-v3/'))value=chunks.get(key.split('/indexes/')[1]);
  else if(key.includes('/budget-cards-v3/'))value={generationId,items:rows};
  else assert.fail('unexpected storage read: '+key);
  return {found:true,value:value as T};
 };
 try{
  resetCatalogReadCachesForTests();resetCatalogRateCache();invalidateEffectiveMarketsCache();
  const make=(id:string,sourcePrice:number)=>{
   const input:any={customsValueRub:sourcePrice*0.04,eurRateRub:90,productionDate:`${year}-01-01`,engineCc:1598,powerHp:123,powertrainKind:'combustion',fuel:'petrol',vehicleCategory:'M1'};
   return {id,market:'korea',make:'Hyundai',model:'Avante',year,sourcePrice,sourceCurrency:'KRW',engineCc:1598,powerHp:123,powertrainKind:'combustion',fuel:'petrol',totalRub:1500000,publicVisibleRub:1500000,publicSpecificationVerified:true,cardProjectionVersion:3,cardImageUrl:'https://example.com/car.jpg',calculationStatus:'ready',updatedAt:today,calculationSnapshot:{customsInput:input,customs:calculateRussiaCustomsForIndividual(input),sourcePriceRub:input.customsValueRub,missing:[],priceIncludesAllCustoms:true,priceIncludesUtilizationFee:true}};
  };
  rows=[make('now-expensive',25000000),make('now-affordable',10000000)];
  const live=await applyActiveBusinessPriceBatch(rows,{readOnly:true});
  assert.ok(live[0].totalRub!>live[1].totalRub!);
  const budgetTo=Math.floor((live[0].totalRub!+live[1].totalRub!)/2);
  rows[0].totalRub=rows[0].publicVisibleRub=budgetTo-300000;
  rows[1].totalRub=rows[1].publicVisibleRub=budgetTo+300000;
  index=buildBudgetCountIndex(generationId,rows,new Map(rows.map(row=>[row.id,0])),3);
  const replayed=await applyActiveBusinessPriceBatch(index.rows.map(budgetReplayOffer),{readOnly:true});assert.deepEqual(replayed.map(row=>row.totalRub),live.map(row=>row.totalRub),'compact replay equals full card replay to the ruble');
  const split=splitBudgetReplayIndex(index);index=split.index;chunks=new Map(split.chunks.map(chunk=>[chunk.path,chunk.value]));
  reads.length=0;
  const params={market:'korea' as const,budgetTo,pageSize:1};
  const [count,facets,brands]=await Promise.all([countCatalogOffers(params),readCatalogFacets(params),readCatalogBrandCounts(params)]);
  assert.equal(count.total,1);assert.deepEqual(facets.makes,['Hyundai']);assert.deepEqual(brands.counts,{Hyundai:1});
  assert.equal(reads.some(key=>key.includes('budget-cards')),false,'v3 counts never load photographs or full cards');
  const result=await searchOffers(params);assert.equal(result.total,1);assert.deepEqual(result.items.map(row=>row.id),['now-affordable']);
  const page2=await searchOffers({...params,page:2});assert.equal(page2.total,1);assert.deepEqual(page2.items,[]);
  const higher=await searchOffers({market:'korea',budgetFrom:budgetTo});assert.deepEqual(higher.items.map(row=>row.id),['now-expensive']);
  const city='Новокузнецк',delivered=priceCardForCity(live[1],city).offer.totalRub;
  assert.equal((await countCatalogOffers({market:'korea',city,budgetTo:delivered})).total,1);
  assert.equal((await countCatalogOffers({market:'korea',city,budgetTo:delivered-1})).total,0);
  assert.equal(reads.filter(key=>key.endsWith('budget-count-v3.json')).length,1);
 }finally{storage.readJsonWithMeta=original;resetCatalogReadCachesForTests();resetCatalogRateCache();invalidateEffectiveMarketsCache();}
});

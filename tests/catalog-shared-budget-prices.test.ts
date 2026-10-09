import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {sharedBudgetPrices,resetSharedBudgetPriceCache,restoreBudgetPrices,budgetPricingFingerprint} from '../apps/web/lib/catalog/shared-budget-prices';
import {splitBudgetMarketIndex,validBudgetMarketIndex} from '../apps/web/lib/catalog/budget-market-index';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {invalidateEffectiveMarketsCache} from '../apps/web/lib/effective-market-settings';

const index=()=>buildBudgetCountIndex('fixture-generation',[
 {id:'a',market:'korea',totalRub:1500000,make:'Hyundai',model:'Avante',year:2024},
 {id:'b',market:'korea',totalRub:2000000,make:'Kia',model:'K3',year:2024},
 {id:'c',market:'china',totalRub:2500000,make:'Toyota',model:'Camry',year:2024},
 {id:'d',market:'china',totalRub:null,make:'Toyota',model:'Camry',year:2024},
] as any[],new Map(),3);

test('shared price cache survives process-cache reset, rejects corrupt/old results, and coalesces parallel filters',async()=>{
 const storage=getJsonStorage(),read=storage.readJson,write=storage.writeJson;
 let saved:any=null,calls=0,writes=0;
 storage.readJson=async()=>saved;
 storage.writeJson=async(_path,value)=>{saved=structuredClone(value);writes++;};
 const source=index(),rows=source.rows.filter(row=>row[0]==='korea').map(row=>row.slice(0,7) as typeof row);
 const load=async()=>{calls++;return rows;};
 try{
  resetSharedBudgetPriceCache();
  const results=await Promise.all(Array.from({length:20},()=>sharedBudgetPrices(source,'korea','v1',load,async()=>'v1')));
  assert.equal(calls,1);assert.equal(writes,1);assert.deepEqual(results[0],rows);
  resetSharedBudgetPriceCache();
  assert.deepEqual(await sharedBudgetPrices(source,'korea','v1',load,async()=>'v1'),rows);
  assert.equal(calls,1,'another instance reads shared results without recalculating the market');
  for(const damage of [()=>saved.prices.pop(),()=>saved.key='wrong',()=>saved.sourceIds='partial',()=>saved.createdAt-=2*86400000]){
   damage();resetSharedBudgetPriceCache();
   const before=calls;
   assert.deepEqual(await sharedBudgetPrices(source,'korea','v1',load,async()=>'v1'),rows);
   assert.equal(calls,before+1,'damaged or expired cache uses exact replay');
  }
  assert.equal(restoreBudgetPrices(saved,saved.key,[rows[0]]),null,'partial input is never a full market');
  const before=calls;resetSharedBudgetPriceCache();
  await sharedBudgetPrices({...source,generationId:'next'},'korea','v1',load,async()=>'v1');
  assert.equal(calls,before+1,'generation changes invalidate stored results');
  await sharedBudgetPrices(source,'korea','v2',load,async()=>'v2');
  assert.equal(calls,before+2,'dependency changes invalidate local and remote results');
  resetSharedBudgetPriceCache();const beforeWrites=writes;
  await assert.rejects(sharedBudgetPrices(source,'korea','v3',load,async()=>'v4'),/context_changed/);
  assert.equal(writes,beforeWrites,'a mixed snapshot is not published');
  storage.readJson=async()=>{throw Error('unavailable');};storage.writeJson=async()=>{throw Error('unavailable');};
  resetSharedBudgetPriceCache();
  assert.deepEqual(await sharedBudgetPrices(source,'korea','v5',load,async()=>'v5'),rows);
 }finally{storage.readJson=read;storage.writeJson=write;resetSharedBudgetPriceCache();}
});

test('market selectors preserve every priced and unpriced identity and reject partial partitions',()=>{
 const source=index(),{directory,parts}=splitBudgetMarketIndex(source);
 assert.deepEqual([...parts.values()].flatMap(part=>part.rows.map(row=>row[5].id)).sort(),source.rows.map(row=>row[5].id).sort());
 assert.deepEqual([...parts.values()].flatMap(part=>part.otherRows!.map(row=>row[5].id)).sort(),source.otherRows!.map(row=>row[5].id).sort());
 assert.ok(validBudgetMarketIndex(directory,'china',parts.get('china')!));
 assert.ok(!validBudgetMarketIndex(directory,'korea',parts.get('china')!));
 const partial=structuredClone(parts.get('china')!);partial.rows.pop();
 assert.ok(!validBudgetMarketIndex(directory,'china',partial));
 const changed=structuredClone(parts.get('china')!);changed.rows[0][1]++;
 assert.ok(!validBudgetMarketIndex(directory,'china',changed));
});

test('fingerprint follows rates, freshness, settings and customs day without depending on fetchedAt',async(t)=>{
 const storage=getJsonStorage(),read=storage.readJsonWithMeta;
 let rate=0.065,deposit=110000,fetchedAt='first',date=new Date().toISOString().slice(0,10);
 storage.readJsonWithMeta=async<T>(path:string,fallback:T)=>({found:true,value:(path==='markets/markets.json'
  ?[{id:'korea',versions:[{id:'current',status:'active',securityDepositRub:deposit}]}]
  :path==='fees/exchange-rates.json'?{rates:[['KRW',rate],['USD',85],['EUR',95]].map(([currency,cbrRate])=>({currency,cbrRate,nominal:1,rateDate:date,rateSource:'cbr',fetchedAt}))}:fallback) as T});
 const fingerprint=async()=>{resetCatalogRateCache();invalidateEffectiveMarketsCache();return budgetPricingFingerprint('korea');};
 try{
  const first=await fingerprint();fetchedAt='second';assert.equal(await fingerprint(),first);
  rate=0.075;const second=await fingerprint();assert.notEqual(second,first);
  deposit=120000;const third=await fingerprint();assert.notEqual(third,second);
  const beforeRollover=Date.parse(date+'T23:59:59Z');
  t.mock.timers.enable({apis:['Date'],now:beforeRollover});
  const beforeDay=await fingerprint();t.mock.timers.tick(2000);
  assert.notEqual(await fingerprint(),beforeDay,'UTC customs anniversary invalidates prices');
  t.mock.timers.reset();
  date='2000-01-01';assert.notEqual(await fingerprint(),third);
  assert.equal(await budgetPricingFingerprint('japan'),null,'mutable Japan previews keep their exact path');
 }finally{storage.readJsonWithMeta=read;resetCatalogRateCache();invalidateEffectiveMarketsCache();}
});

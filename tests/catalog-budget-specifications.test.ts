import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {enrichBudgetSpecifications} from '../apps/web/lib/catalog/budget-specification-index';
import {catalogSearchProjectionMatches} from '../apps/web/lib/catalog/storage';

test('backfilled specifications preserve identities, unknowns and exact engine/certified-power matching',async()=>{
 const offers:any[]=[
  {id:'petrol',market:'china',make:'Test',model:'Car',fuel:'petrol',engineCc:1598,powerHp:123,totalRub:2000000},
  {id:'electric',market:'china',make:'Test',model:'EV',fuel:'electric',powertrainKind:'electric',powerHp:300,utilizationPowerKw:80,totalRub:2000000},
  {id:'unknown',market:'china',make:'Test',model:'Unknown',fuel:'electric',powertrainKind:'electric',powerHp:300,totalRub:null},
 ];
 const source=buildBudgetCountIndex('gen_spec',offers,new Map(offers.map(o=>[o.id,0])),3);
 delete source.specificationFilterVersion;
 for(const row of [...source.rows,...source.otherRows!])for(const key of ['engineCc','utilizationPowerKw','powertrainKind'])delete (row[5] as any)[key];
 const before=structuredClone(source);
 const rich=await enrichBudgetSpecifications(source,async()=>({generationId:'gen_spec',items:offers}));
 assert.deepEqual(source,before,'backfill does not mutate source index');
 assert.deepEqual(rich.rows.map(r=>r[5].id),source.rows.map(r=>r[5].id));
 assert.deepEqual(rich.otherRows!.map(r=>r[5].id),source.otherRows!.map(r=>r[5].id));
 for(const query of [{engineTo:2000},{engineFrom:1800},{powerTo:160},{powerFrom:150}]){
  const original=offers.filter(o=>catalogSearchProjectionMatches(o,query)).map(o=>o.id).sort();
  const compact=[...rich.rows,...rich.otherRows!].filter(r=>catalogSearchProjectionMatches({...r[5],market:r[0]},query)).map(r=>r[5].id).sort();
  assert.deepEqual(compact,original);
 }
 await assert.rejects(enrichBudgetSpecifications(source,async()=>({generationId:'future',items:offers})),/generation/);
 await assert.rejects(enrichBudgetSpecifications(source,async()=>({generationId:'gen_spec',items:offers.slice(1)})),/incomplete/);
 await assert.rejects(enrichBudgetSpecifications(source,async()=>({generationId:'gen_spec',items:[...offers,offers[0]]})),/identity/);
});


test('specification backfill accepts empty markets but rejects a missing populated market',async()=>{
 const {getJsonStorage,StorageConflictError}=await import('../apps/web/lib/data');
 const {backfillBudgetSpecificationSelectors,resetCatalogReadCachesForTests}=await import('../apps/web/lib/catalog/storage');
 const generationId='empty-market-specs';
 const offers:any[]=[{id:'china-one',market:'china',make:'Haval',model:'M6',engineCc:1497,totalRub:2000000}];
 const source=buildBudgetCountIndex(generationId,offers,new Map([['china-one',0]]),3);
 const manifest:any={generationId,markets:{china:{count:1},japan:{count:0}}};
 const values=new Map<string,any>([['catalog/manifest.json',manifest],[`catalog/generations/${generationId}/indexes/budget-count-v3.json`,source],[`catalog/generations/${generationId}/indexes/budget-cards-v3/0.json`,{generationId,items:offers}]]);
 const storage=getJsonStorage(),read=storage.readJson,meta=storage.readJsonWithMeta,write=storage.writeJson;
 const previousVersion=process.env.AVTOCENA_CALCULATION_VERSION;
 process.env.AVTOCENA_CALCULATION_VERSION='a'.repeat(64);
 storage.readJson=async <T>(key:string,fallback:T)=>values.has(key)?values.get(key):fallback;
 storage.readJsonWithMeta=async <T>(key:string,fallback:T)=>({found:values.has(key),value:values.has(key)?values.get(key):fallback});
 storage.writeJson=async(key,value,condition)=>{if(condition?.ifNoneMatch==='*'&&values.has(key))throw new StorageConflictError();values.set(key,value);};
 try{
  resetCatalogReadCachesForTests();
  const ready=await backfillBudgetSpecificationSelectors();
  assert.deepEqual(Object.keys(ready.markets),['china']);
  assert.equal(ready.markets.china.rows+ready.markets.china.otherRows,1);
  assert.equal([...values.keys()].some(key=>/budget-markets-v6\/[^/]+\/japan.json$/.test(key)),false);
  const firstKeys=[...values.keys()].filter(key=>key.includes('/budget-markets-v6/'));
  const firstValues=firstKeys.map(key=>JSON.stringify(values.get(key)));
  process.env.AVTOCENA_CALCULATION_VERSION='b'.repeat(64);resetCatalogReadCachesForTests();
  await backfillBudgetSpecificationSelectors();
  assert.equal([...values.keys()].filter(key=>key.includes('/budget-markets-v6/')).length,firstKeys.length*2,'a new release has its own immutable selector namespace');
  assert.deepEqual(firstKeys.map(key=>JSON.stringify(values.get(key))),firstValues,'previous live selectors remain byte-for-byte unchanged');
  await backfillBudgetSpecificationSelectors();
  manifest.markets.japan.count=1;resetCatalogReadCachesForTests();
  await assert.rejects(backfillBudgetSpecificationSelectors(),/budget_specification_nonempty_market_missing/);
 }finally{storage.readJson=read;storage.readJsonWithMeta=meta;storage.writeJson=write;if(previousVersion===undefined)delete process.env.AVTOCENA_CALCULATION_VERSION;else process.env.AVTOCENA_CALCULATION_VERSION=previousVersion;resetCatalogReadCachesForTests();}
});

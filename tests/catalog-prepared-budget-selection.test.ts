import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {buildBudgetCountIndex,type BudgetCountIndex,type BudgetCountRow} from '../apps/web/lib/catalog/budget-count-index';
import {publishSelectorMarket,MAX_PUBLISHED_SELECTOR_BYTES} from '../apps/web/lib/catalog/budget-selector-publication';
import {specificationSelectorDirectory} from '../apps/web/lib/catalog/budget-selector-codec';
import {readCalculationIndex} from '../apps/web/lib/encyclopedia/calculation-index';
import {budgetPricingFingerprint,calculationCacheVersion,prepareBudgetSelection,readPreparedBudgetSelection,sharedBudgetPrices,verifyPreparedBudgetSelection} from '../apps/web/lib/catalog/shared-budget-prices';
import {searchOffers,countCatalogOffers,readCatalogFacets,readCatalogBrandCounts,resetCatalogReadCachesForTests,warmBudgetPriceCaches,verifyPreparedBudgetPriceCaches} from '../apps/web/lib/catalog/storage';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {invalidateEffectiveMarketsCache} from '../apps/web/lib/effective-market-settings';

function fixture(unknownCount=0){
 const generationId='prepared-selection-fixture',year=new Date().getUTCFullYear()-2,today=new Date().toISOString();
 const base:any={market:'korea',make:'Hyundai',model:'Avante',year,engineCc:1598,powerHp:123,fuel:'petrol',powertrainKind:'combustion',
  transmission:'automatic',drive:'fwd',bodyType:'sedan',mileageKm:40000,cardImageUrl:'https://example.com/car.jpg',cardProjectionVersion:3,
  publicSpecificationVerified:true,calculationStatus:'ready',updatedAt:today};
 const offers=Array.from({length:12},(_,i)=>({...base,id:`priced-${i}`,make:i<8?'Hyundai':'Kia',model:i<8?'Avante':'K3',
  fuel:i%2?'petrol':'diesel',mileageKm:10000+i*1000,totalRub:1_000_000+i*100000,publicVisibleRub:1_000_000+i*100000,
  calculationSnapshot:{deliveryPricingBasis:{subtotalRub:1_000_000+i*100000,deliveryRub:0,percents:[]}}}));
 const index=buildBudgetCountIndex(generationId,offers,new Map(offers.map(row=>[row.id,0])),3);
 // Realistic membership size without attaching full source payloads/photos to
 // an unpriced selector. These rows remain in the ordinary inventory index.
 index.otherRows=Array.from({length:unknownCount},(_,i)=>['korea',0,null,null,false,
  {...index.rows[0][5],id:`unknown-${i}`,publicSpecificationVerified:false,block:1+Math.floor(i/256)}] as BudgetCountRow);
 index.rows=index.rows.map(row=>row.slice(0,7) as BudgetCountRow);
 index.sourceRows=index.rows.length+index.otherRows.length;
 const stored=new Map<string,any>(),reads:string[]=[];let writes=0,editorial:any={revision:'0',entries:{}};
 const storage=getJsonStorage(),originalRead=storage.readJson,originalMeta=storage.readJsonWithMeta,originalWrite=storage.writeJson;
 const value=(key:string,fallback:any)=>{
  if(stored.has(key))return stored.get(key);
  if(key==='catalog/manifest.json')return {generationId,markets:{korea:{count:index.sourceRows}}};
  if(key==='markets/markets.json')return [{id:'korea',versions:[{id:'current',status:'active',securityDepositRub:0}]}];
  if(key==='fees/exchange-rates.json')return {};
  if(key==='catalog-editorial/current.json')return editorial;
  if(key==='catalog/public/brand-summary.json')return {generationId,brands:{hyundai:{make:'Hyundai',count:index.sourceRows,marketCounts:{korea:index.sourceRows},models:[]}}};
  if(key.includes('/budget-cards-v3/0.json'))return {generationId,items:offers};
  if(key.includes('/budget-cards-v3/'))assert.fail('unpriced card block must not be fetched by the budget filter');
  return fallback;
 };
 storage.readJson=async<T>(key:string,fallback:T)=>{reads.push(key);return value(key,fallback) as T;};
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{reads.push(key);const found=value(key,fallback);return {found:found!==fallback,value:found as T};};
 storage.writeJson=async(key,entry)=>{stored.set(key,structuredClone(entry));writes++;};
 const reset=()=>{resetCatalogReadCachesForTests();resetCatalogRateCache();invalidateEffectiveMarketsCache();reads.length=0;};
 return {generationId,index,offers,stored,reads,storage,reset,get writes(){return writes;},setEditorial:(entry:any)=>{editorial=entry;},
  cleanup:()=>{storage.readJson=originalRead;storage.readJsonWithMeta=originalMeta;storage.writeJson=originalWrite;reset();}};
}

test('prepared budget selection preserves exact filters and cuts 65 full-selector parts to one priced part',async()=>{
 const f=fixture(64_000);
 try{
  f.reset();const fingerprint=(await budgetPricingFingerprint('korea'))!;
  const prefix=`catalog/generations/${f.generationId}/indexes/${specificationSelectorDirectory(readCalculationIndex()?.digest||null,calculationCacheVersion())}`;
  const entry=await publishSelectorMarket(f.index,'korea',async name=>f.stored.get(`${prefix}/${name}.json`),async(name,value)=>{f.stored.set(`${prefix}/${name}.json`,value);});
  assert.equal(entry.chunks.length,65);
  f.stored.set(`${prefix}/ready.json`,{version:4,generationId:f.generationId,encyclopediaDigest:readCalculationIndex()?.digest||null,markets:{korea:entry}});
  await sharedBudgetPrices(f.index,'korea',fingerprint,async()=>f.index.rows,async()=>fingerprint);
  await sharedBudgetPrices(f.index,'korea',fingerprint,async()=>f.index.rows,async()=>fingerprint,true);
  const queries=[
   {market:'korea',budgetTo:3_000_000,pageSize:12},
   {market:'korea',budgetFrom:1_200_000,budgetTo:1_900_000,city:'Новокузнецк',fuel:'petrol',pageSize:2},
   {market:'korea',budgetTo:1_500_000,city:'Уссурийск',mileageTo:18000,sort:'totalRubDesc',pageSize:3},
   {market:'korea',budgetFrom:100_000,budgetTo:900_000,sort:'totalRub'},
  ];
  const run=async(params:any)=>{
   const [result,count,facets,brands]=await Promise.all([searchOffers(params),countCatalogOffers(params),readCatalogFacets(params),readCatalogBrandCounts(params)]);
   return {result,count,facets,brands};
  };
  f.reset();const beforeCpu=process.cpuUsage(),beforeTime=performance.now();
  const baselineFirst=await run(queries[0]);
  const before={ms:performance.now()-beforeTime,cpu:process.cpuUsage(beforeCpu),parts:f.reads.filter(key=>key.startsWith(prefix+'/parts/')).length};
  assert.equal(before.parts,65);
  const baseline=[baselineFirst];for(const query of queries.slice(1))baseline.push(await run(query));
  const receipt=await prepareBudgetSelection(f.index,'korea',fingerprint,f.index.rows,async()=>fingerprint);
  assert.equal(receipt.sourceRows,64_012);assert.equal(receipt.index.sourceRows,12);
  assert.equal(receipt.directory.markets.korea.chunks!.length,1);
  const warmed=await warmBudgetPriceCaches(['korea']);
  assert.equal(warmed.results[0].preparedSelection.key,receipt.key,'ordinary background warmup produces the same verified selection');
  f.reset();const ready=await verifyPreparedBudgetPriceCaches(['korea']);
  assert.equal(ready.verified,true);assert.equal(ready.results[0].budgetRows,12);
  f.reset();assert.deepEqual(await verifyPreparedBudgetPriceCaches(['korea']),ready,'a fresh-process publication receipt is deterministic');
  f.reset();const written=f.writes,afterCpu=process.cpuUsage(),afterTime=performance.now();
  const actualFirst=await run(queries[0]);
  const after={ms:performance.now()-afterTime,cpu:process.cpuUsage(afterCpu),fullParts:f.reads.filter(key=>key.startsWith(prefix+'/parts/')).length,
   preparedParts:f.reads.filter(key=>key.includes('/runtime-budget-selections-v1/')&&key.includes('/parts/')).length};
  assert.equal(after.fullParts,0);assert.equal(after.preparedParts,1);
  const actual=[actualFirst];for(const query of queries.slice(1))actual.push(await run(query));
  for(let i=0;i<queries.length;i++){
   assert.equal(actual[i].result.total,baseline[i].result.total);
   assert.deepEqual(actual[i].result.items.map(row=>[row.id,row.totalRub,row.sellerPriceRub]),baseline[i].result.items.map(row=>[row.id,row.totalRub,row.sellerPriceRub]));
   assert.deepEqual(actual[i].count,baseline[i].count);assert.deepEqual(actual[i].facets,baseline[i].facets);assert.deepEqual(actual[i].brands,baseline[i].brands);
  }
  const model=await run({market:'korea',make:'Hyundai',model:'Avante',budgetTo:3_000_000,sort:'totalRubDesc',pageSize:3});
  assert.equal(model.count.total,8);assert.deepEqual(model.result.items.map(row=>row.id),['priced-7','priced-6','priced-5']);
  assert.equal(f.reads.some(key=>key.startsWith(prefix+'/parts/')||key.includes('/budget-prices-v3/')),false,'ready visitor queries never reload/reprice all inventory');
  assert.equal(f.writes,written,'ready visitor queries perform zero storage writes');
  // Current manual display specifications still change filter membership; the
  // prepared prices are not a frozen replacement for editorial authority.
  f.setEditorial({revision:'edited',entries:{'priced-0':{id:'priced-0',market:'korea',status:'visible',specifications:{drive:'awd'}}}});
  f.reset();const edited=await run({market:'korea',drive:'awd',budgetTo:3_000_000});
  assert.equal(edited.count.total,1);assert.deepEqual(edited.result.items.map(row=>row.id),['priced-0']);
  assert.equal((await countCatalogOffers({market:'korea'})).total,64_012,'ordinary inventory still includes every unpriced row');
  console.log('PREPARED_BUDGET_SELECTION_FIXTURE',JSON.stringify({inventory:64012,priced:12,before,after}));
 }finally{f.cleanup();}
});

test('preparation requires durable complete numeric prices and failed part writes cannot publish readiness',async()=>{
 const f=fixture(3);
 try{
  f.reset();const fingerprint=(await budgetPricingFingerprint('korea'))!;
  await assert.rejects(prepareBudgetSelection(f.index,'korea',fingerprint,f.index.rows,async()=>fingerprint),/prices_invalid/);
  await sharedBudgetPrices(f.index,'korea',fingerprint,async()=>f.index.rows,async()=>fingerprint);
  await sharedBudgetPrices(f.index,'korea',fingerprint,async()=>f.index.rows,async()=>fingerprint,true);
  const write=f.storage.writeJson;
  f.storage.writeJson=async(key,value,condition)=>{if(key.includes('/parts/'))throw Error('fixture storage unavailable');return write(key,value,condition);};
  await assert.rejects(prepareBudgetSelection(f.index,'korea',fingerprint,f.index.rows,async()=>fingerprint),/fixture storage unavailable/);
  assert.equal([...f.stored.keys()].some(key=>key.includes('runtime-budget-selections-v1')&&key.endsWith('/ready.json')),false);
  f.storage.writeJson=write;
  await assert.rejects(prepareBudgetSelection(f.index,'korea',fingerprint,f.index.rows.slice(1),async()=>fingerprint),/prices_invalid/,'a partial calculated set must not become a complete budget selector');
  const receipt=await prepareBudgetSelection(f.index,'korea',fingerprint,f.index.rows,async()=>fingerprint);
  f.reset();const writes=f.writes;
  assert.equal((await verifyPreparedBudgetSelection(f.index,'korea',fingerprint)).verified,true);
  assert.equal(f.writes,writes,'readiness is a read-only verification');
  const metadata=f.index.rows[0][5];
  f.index.rows[0][5]={...metadata,year:metadata.year-1,powerHp:90};
  await assert.rejects(verifyPreparedBudgetSelection(f.index,'korea',fingerprint),/readiness_failed/,'changed year/power metadata cannot pass the source digest');
  f.index.rows[0][5]=metadata;
  assert.equal(await readPreparedBudgetSelection('different-generation','korea',fingerprint),null);
  assert.equal(await readPreparedBudgetSelection(f.generationId,'korea','different-fx-day-settings'),null);
  assert.equal(await readPreparedBudgetSelection(f.generationId,'japan',fingerprint),null);
  const part=`catalog/runtime-budget-selections-v1/korea/${receipt.key}/${receipt.directory.markets.korea.chunks![0].name}.json`;
  f.stored.set(part,{encoding:'gzip-base64',payload:'corrupt'});f.reset();
  assert.equal(await readPreparedBudgetSelection(f.generationId,'korea',fingerprint),null);
  await assert.rejects(verifyPreparedBudgetSelection(f.index,'korea',fingerprint),/readiness_failed/);
 }finally{f.cleanup();}
});

test('manual seller price invalidates the prepared selector while display specification edits retain current authority',async()=>{
 const f=fixture(1);
 try{
  f.reset();const fingerprint=(await budgetPricingFingerprint('korea'))!;
  await sharedBudgetPrices(f.index,'korea',fingerprint,async()=>f.index.rows,async()=>fingerprint);
  await prepareBudgetSelection(f.index,'korea',fingerprint,f.index.rows,async()=>fingerprint);
  f.setEditorial({revision:'seller-edited',entries:{'priced-0':{id:'priced-0',market:'korea',status:'visible',sellerPrice:{amount:200000,currency:'USD'},specifications:{drive:'awd'}}}});
  f.reset();const current=(await budgetPricingFingerprint('korea'))!;
  assert.notEqual(current,fingerprint);
  assert.equal(await readPreparedBudgetSelection(f.generationId,'korea',current),null,'old delivered prices cannot satisfy the new seller input');
  assert.equal(await readPreparedBudgetSelection(f.generationId+'-next','korea',current),null,'a new inventory generation cannot reuse old membership');
  await assert.rejects(prepareBudgetSelection(f.index,'korea',fingerprint,f.index.rows),/context_changed/,'changed authority cannot publish readiness under an old fingerprint');
 }finally{f.cleanup();}
});

test('newly calculated old unpriced identities and an honestly empty price set survive preparation',async()=>{
 const f=fixture(2);
 try{
  f.reset();const fingerprint=(await budgetPricingFingerprint('korea'))!;
  const nowPriced=[...f.index.otherRows![0]] as BudgetCountRow;nowPriced[1]=1_200_000;
  const rows=[...f.index.rows,nowPriced];
  await sharedBudgetPrices(f.index,'korea',fingerprint,async()=>rows,async()=>fingerprint);
  await prepareBudgetSelection(f.index,'korea',fingerprint,rows,async()=>fingerprint);
  f.reset();assert.ok((await readPreparedBudgetSelection(f.generationId,'korea',fingerprint))!.rows.some(row=>row[5].id==='unknown-0'));
  const emptyContext=fingerprint+'-empty';
  await sharedBudgetPrices(f.index,'korea',emptyContext,async()=>[],async()=>emptyContext);
  const receipt=await prepareBudgetSelection(f.index,'korea',emptyContext,[],async()=>emptyContext);
  assert.equal(receipt.sourceRows,14);assert.equal(receipt.index.sourceRows,0);f.reset();
  assert.deepEqual((await readPreparedBudgetSelection(f.generationId,'korea',emptyContext))!.rows,[]);
  for(const [path,value] of f.stored)if(path.includes('/runtime-budget-selections-v1/'))assert.ok(Buffer.byteLength(JSON.stringify(value))<=MAX_PUBLISHED_SELECTOR_BYTES);
 }finally{f.cleanup();}
});

test('a large priced market retains all identities in independently bounded prepared parts',async()=>{
 const f=fixture(20);
 try{
  f.index.rows=Array.from({length:2050},(_,i)=>{
   const original=f.index.rows[i%12];return [...original.slice(0,5),{...original[5],id:`large-priced-${i}`,block:Math.floor(i/256)},original[6]] as BudgetCountRow;
  });
  f.index.sourceRows=f.index.rows.length+f.index.otherRows!.length;
  f.reset();const fingerprint=(await budgetPricingFingerprint('korea'))!;
  await sharedBudgetPrices(f.index,'korea',fingerprint,async()=>f.index.rows,async()=>fingerprint);
  const receipt=await prepareBudgetSelection(f.index,'korea',fingerprint,f.index.rows,async()=>fingerprint);
  assert.equal(receipt.sourceRows,2070);assert.equal(receipt.directory.markets.korea.chunks!.length,3);
  for(const part of receipt.directory.markets.korea.chunks!)assert.ok(part.rows<=1000&&part.bytes<=MAX_PUBLISHED_SELECTOR_BYTES);
  f.reset();const read=await readPreparedBudgetSelection(f.generationId,'korea',fingerprint);
  assert.deepEqual(read!.rows.map(row=>row[5].id),f.index.rows.map(row=>row[5].id));
 }finally{f.cleanup();}
});

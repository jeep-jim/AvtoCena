import {sharedBudgetPrices,budgetPricingFingerprint} from '../apps/web/lib/catalog/shared-budget-prices';
import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {searchOffers,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {invalidateEffectiveMarketsCache} from '../apps/web/lib/effective-market-settings';
import {compareCatalogTerms,parseCatalogSort} from '../apps/web/lib/catalog/catalog-sort';
import {sortCatalogRows} from '../apps/web/lib/catalog/market-page';

test('a narrow brand price sort falls back to matching card blocks when no prepared snapshot exists',async()=>{
 const base:any={market:'korea',make:'BMW',model:'3 Series',year:2024,engineCc:1598,powerHp:150,fuel:'petrol',powertrainKind:'combustion',cardImageUrl:'https://example.com/car.jpg',cardProjectionVersion:3,publicSpecificationVerified:true,calculationStatus:'ready',updatedAt:'2026-11-08T00:00:00Z'};
 const rows=Array.from({length:100},(_,i)=>({...base,id:`narrow-${i}`,make:i<5?'BMW':'Audi',totalRub:1_000_000+i*10_000,publicVisibleRub:1_000_000+i*10_000}));
 const generationId='narrow-sort',index=buildBudgetCountIndex(generationId,rows,new Map(rows.map((r,i)=>[r.id,Math.floor(i/10)])),3);
 const storage=getJsonStorage(),original=storage.readJsonWithMeta,originalRead=storage.readJson,originalWrite=storage.writeJson,reads:string[]=[];
 storage.readJson=async<T>(_key:string,fallback:T)=>fallback;
 storage.writeJson=async()=>{assert.fail('a model sort must not build a full-market price snapshot');};
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  reads.push(key);let value:unknown=fallback;
  if(key==='markets/markets.json')value=[{id:'korea',versions:[{id:'fixture',status:'active',securityDepositRub:110000}]}];
  else if(key==='fees/exchange-rates.json')value={};
  else if(key==='catalog/manifest.json')value={generationId,markets:{korea:{count:rows.length}}};
  else if(key.endsWith('/budget-count-v3.json'))value=index;
  else if(key.includes('/budget-cards-v3/')){assert.ok(key.endsWith('/0.json'),'unrelated model card block fetched');value={generationId,items:rows.slice(0,10)};}
  else assert.ok(!/projection|budget-prices/.test(key),'unexpected full-market read: '+key);
  return {found:value!==fallback,value:value as T};
 };
 try{
  resetCatalogReadCachesForTests();
  const ascending=await searchOffers({market:'korea',make:'BMW',sort:'totalRub',pageSize:2});
  assert.equal(ascending.total,5);assert.deepEqual(ascending.items.map(row=>row.id),['narrow-0','narrow-1']);
  const descending=await searchOffers({market:'korea',make:'BMW',sort:'totalRubDesc',pageSize:2});
  assert.deepEqual(descending.items.map(row=>row.id),['narrow-4','narrow-3']);
  for(const model of ['3','3 SERIES']){
   const selected=await searchOffers({market:'korea',make:'BMW',model,powerTo:160,sort:'totalRub',pageSize:2});
   assert.equal(selected.total,5,`BMW ${model} with the power filter keeps matching inventory`);
   assert.deepEqual(selected.items.map(row=>row.id),['narrow-0','narrow-1']);
  }
  assert.equal(reads.filter(key=>key.includes('/budget-cards-v3/')).length,1,'direction changes share exactly priced selected cards');
 }finally{storage.readJsonWithMeta=original;storage.readJson=originalRead;storage.writeJson=originalWrite;resetCatalogReadCachesForTests();resetCatalogRateCache();invalidateEffectiveMarketsCache();}
});

test('narrow price sorting uses a prepared exact snapshot and reads only visible card blocks',async()=>{
 const base:any={market:'korea',make:'BMW',model:'3 Series',year:2024,engineCc:1598,powerHp:150,fuel:'petrol',powertrainKind:'combustion',cardImageUrl:'https://example.com/car.jpg',cardProjectionVersion:3,publicSpecificationVerified:true,calculationStatus:'ready',updatedAt:'2026-11-08T00:00:00Z'};
 const rows=Array.from({length:100},(_,i)=>({...base,id:`prepared-${i}`,make:i<50?'BMW':'Audi',totalRub:2_000_000-i*10_000,publicVisibleRub:2_000_000-i*10_000}));
 const generationId='prepared-narrow-sort',index=buildBudgetCountIndex(generationId,rows,new Map(rows.map((r,i)=>[r.id,Math.floor(i/10)])),3);
 const storage=getJsonStorage(),original=storage.readJsonWithMeta,originalRead=storage.readJson,originalWrite=storage.writeJson,reads:string[]=[];
 const saved=new Map<string,unknown>();let writes=0;
 storage.readJson=async<T>(key:string,fallback:T)=>(saved.get(key)??fallback) as T;
 storage.writeJson=async(key,value)=>{saved.set(key,structuredClone(value));writes++;};
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  if(saved.has(key))return {found:true,etag:'saved',value:saved.get(key) as T};
  reads.push(key);let value:unknown=fallback;
  if(key==='markets/markets.json')value=[{id:'korea',versions:[{id:'fixture',status:'active',securityDepositRub:110000}]}];
  else if(key==='fees/exchange-rates.json')value={};
  else if(key==='catalog/manifest.json')value={generationId,markets:{korea:{count:rows.length}}};
  else if(key.endsWith('/budget-count-v3.json'))value=index;
  else if(key.includes('/budget-cards-v3/')){
   const block=Number(key.split('/').at(-1)!.replace('.json',''));
   assert.ok([0,4].includes(block),'a non-visible block must not be read for price sorting');
   value={generationId,items:rows.slice(block*10,block*10+10)};
  } else assert.ok(!/projection|pricing-replay/.test(key),'unexpected whole-market calculation read');
  return {found:value!==fallback,value:value as T};
 };
 try{
  resetCatalogReadCachesForTests();resetCatalogRateCache();invalidateEffectiveMarketsCache();
  const fingerprint=(await budgetPricingFingerprint('korea'))!;
  await sharedBudgetPrices(index,'korea',fingerprint,async()=>index.rows,async()=>fingerprint,true,{persistence:'required'});
  resetCatalogReadCachesForTests();reads.length=0;
  const ascending=await searchOffers({market:'korea',make:'BMW',model:'3',powerTo:160,sort:'totalRub',pageSize:2});
  assert.equal(ascending.total,50);assert.deepEqual(ascending.items.map(row=>row.id),['prepared-49','prepared-48']);
  assert.equal(reads.filter(key=>key.includes('/budget-cards-v3/')).length,1);
  const descending=await searchOffers({market:'korea',make:'BMW',model:'3',powerTo:160,sort:'totalRubDesc',pageSize:2});
  assert.deepEqual(descending.items.map(row=>row.id),['prepared-0','prepared-1']);
  assert.equal(reads.filter(key=>key.includes('/budget-cards-v3/')).length,2);
  assert.equal(writes,1,'visitor requests do not rebuild the market snapshot');
 }finally{storage.readJsonWithMeta=original;storage.readJson=originalRead;storage.writeJson=originalWrite;resetCatalogReadCachesForTests();resetCatalogRateCache();invalidateEffectiveMarketsCache();}
});

test('compact sorting keeps exact order, shares direction price reads and bounds concurrent blocks',async()=>{
 const base:any={market:'korea',make:'Hyundai',model:'Avante',year:2024,mileageKm:40000,engineCc:1598,powerHp:123,fuel:'petrol',powertrainKind:'combustion',transmission:'automatic',drive:'fwd',bodyType:'sedan',cardImageUrl:'https://example.com/car.jpg',cardProjectionVersion:3,publicSpecificationVerified:true,calculationStatus:'ready',updatedAt:'2026-10-04T00:00:00Z'};
 const rows=Array.from({length:60},(_,i)=>({...base,id:`car-${i}`,year:2020+i%7,totalRub:1_000_000+i*10_000,publicVisibleRub:1_000_000+i*10_000}));
 rows.push({...base,id:'unknown',year:2024,totalRub:null,publicVisibleRub:undefined,catalogPricingMode:'seller',sellerPriceRub:1} as any);
 rows.forEach((row:any,i:number)=>{row.color=i%2?'black':'white';row.mileageKm=i===1?0:i===2?undefined:(60-i)*100;});
 const generationId='compact-sort',index=buildBudgetCountIndex(generationId,rows,new Map(rows.map((r,i)=>[r.id,Math.floor(i/10)])));
 const storage=getJsonStorage(),original=storage.readJsonWithMeta,reads:string[]=[];let active=0,peak=0;
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  reads.push(key);let value:unknown;
  if(key==='markets/markets.json')value=[{id:'korea',versions:[{id:'fixture',status:'active',securityDepositRub:110000}]}];
  else if(key==='fees/exchange-rates.json')value={};
  else if(key==='catalog/manifest.json')value={generationId,markets:{korea:{count:rows.length}}};
  else if(key.endsWith('/colors-v1.json'))value={generationId,rows:rows.map((r:any)=>[r.id,r.market,r.color])};
  else if(key.endsWith('/budget-count-v3.json'))return {found:false,value:fallback};
  else if(key.endsWith('/budget-count-v2.json'))value=index;
  else if(key.includes('/budget-cards-v2/')){active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;const block=Number(key.split('/').at(-1)!.replace('.json',''));value={generationId,items:rows.slice(block*10,block*10+10)};}
  else if(key==='catalog-editorial/current.json')return {found:false,value:fallback};
  else assert.fail('unexpected full projection or unrelated storage read: '+key);
  return {found:true,value:value as T};
 };
 try{
  resetCatalogReadCachesForTests();
  for(const sort of ['year','yearAsc'] as const){const r=await searchOffers({fuel:'petrol',sort,pageSize:8});const years=r.items.map(x=>x.year);assert.deepEqual(years,[...years].sort((a,b)=>sort==='year'?b-a:a-b));assert.equal(r.total,61);}
  for(const sort of ['year,mileage','mileageDesc,yearAsc','totalRub,mileage']){
   const result=await searchOffers({fuel:'petrol',sort,page:2,pageSize:8});
   const expected=[...rows].sort((a,b)=>compareCatalogTerms(a,b,parseCatalogSort(sort)!,r=>Number(r.totalRub))||a.id.localeCompare(b.id)).slice(8,16);
   assert.deepEqual(result.items.map(r=>r.id),expected.map(r=>r.id),'compound order before pagination: '+sort);
  }
  const white=await searchOffers({color:'Белый',fuel:'petrol',sort:'mileage',pageSize:8});
  assert.equal(white.total,31);assert.ok(white.items.every((r:any)=>r.color==='white'));
  const black=await searchOffers({color:'Чёрный',fuel:'petrol',sort:'mileage',pageSize:8});
  assert.equal(black.total,30);assert.equal(black.items[0].mileageKm,0);
  resetCatalogReadCachesForTests();reads.length=0;peak=0;
  const ascending=await searchOffers({fuel:'petrol',sort:'totalRub',pageSize:8});
  assert.deepEqual(ascending.items.map(x=>x.id),Array.from({length:8},(_,i)=>`car-${i}`));
  const countAfterFirst=reads.filter(x=>x.includes('/budget-cards-')).length;
  const descending=await searchOffers({fuel:'petrol',sort:'totalRubDesc',pageSize:8});
  assert.deepEqual(descending.items.map(x=>x.id),Array.from({length:8},(_,i)=>`car-${59-i}`));
  assert.equal(reads.filter(x=>x.includes('/budget-cards-')).length,countAfterFirst,'direction toggle reuses blocks');
  assert.ok(peak<=2,`at most two blocks in flight, got ${peak}`);
  for(const sort of ['totalRub','totalRubDesc'] as const){const last=await searchOffers({fuel:'petrol',sort,page:8,pageSize:8});assert.equal(last.items.at(-1)?.id,'unknown');}
 }finally{storage.readJsonWithMeta=original;resetCatalogReadCachesForTests();}
});

test('v3 sorting reuses compact keys and recovers only missing legacy prices',async()=>{
 const base:any={market:'korea',make:'Hyundai',model:'Avante',year:2024,mileageKm:40000,engineCc:1598,powerHp:123,fuel:'petrol',powertrainKind:'combustion',transmission:'automatic',drive:'fwd',bodyType:'sedan',cardImageUrl:'https://example.com/car.jpg',cardProjectionVersion:3,publicSpecificationVerified:true,calculationStatus:'ready',updatedAt:'2026-10-04T00:00:00Z'};
 const rows=Array.from({length:60},(_,i)=>({...base,id:`car-${i}`,year:2020+i%7,totalRub:1_000_000+i*10_000,publicVisibleRub:1_000_000+i*10_000}));
 rows.push({...base,id:'unknown',year:2024,totalRub:null,publicVisibleRub:undefined} as any);
 const generationId='compact-sort',index=buildBudgetCountIndex(generationId,rows,new Map(rows.map((r,i)=>[r.id,Math.floor(i/10)])),3);
 const storage=getJsonStorage(),original=storage.readJsonWithMeta,originalRead=storage.readJson,originalWrite=storage.writeJson,reads:string[]=[];let active=0,peak=0;
 storage.readJson=async<T>(key:string,fallback:T)=>fallback;
 storage.writeJson=async()=>{};
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  reads.push(key);let value:unknown;
  if(key==='markets/markets.json')value=[{id:'korea',versions:[{id:'fixture',status:'active',securityDepositRub:110000}]}];
  else if(key==='fees/exchange-rates.json')value={};
  else if(key==='catalog/manifest.json')value={generationId,markets:{korea:{count:rows.length}}};
  else if(key.endsWith('/budget-count-v3.json'))value=index;
  else if(key.includes('/budget-cards-v3/')){active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;const block=Number(key.split('/').at(-1)!.replace('.json',''));value={generationId,items:rows.slice(block*10,block*10+10)};}
  else if(key==='catalog-editorial/current.json')return {found:false,value:fallback};
  else assert.fail('unexpected full projection or unrelated storage read: '+key);
  return {found:true,value:value as T};
 };
 try{
  resetCatalogReadCachesForTests();
  for(const sort of ['year','yearAsc'] as const){const r=await searchOffers({fuel:'petrol',sort,pageSize:8});const years=r.items.map(x=>x.year);assert.deepEqual(years,[...years].sort((a,b)=>sort==='year'?b-a:a-b));assert.equal(r.total,61);}
  resetCatalogReadCachesForTests();reads.length=0;peak=0;
  const ascending=await searchOffers({fuel:'petrol',sort:'totalRub',pageSize:8});
  assert.deepEqual(ascending.items.map(x=>x.id),Array.from({length:8},(_,i)=>`car-${i}`));
  assert.equal(reads.filter(x=>x.includes('/budget-cards-')).length,2,'one legacy unknown block plus visible page');
  const descending=await searchOffers({fuel:'petrol',sort:'totalRubDesc',pageSize:8});
  assert.deepEqual(descending.items.map(x=>x.id),Array.from({length:8},(_,i)=>`car-${59-i}`));
  assert.equal(reads.filter(x=>x.includes('/budget-cards-')).length,3,'reverse order adds only its visible block');
  assert.ok(peak<=2,`at most two blocks in flight, got ${peak}`);
  for(const sort of ['totalRub','totalRubDesc'] as const){const last=await searchOffers({fuel:'petrol',sort,page:8,pageSize:8});assert.equal(last.items.at(-1)?.id,'unknown');}
 }finally{storage.readJsonWithMeta=original;storage.readJson=originalRead;storage.writeJson=originalWrite;resetCatalogReadCachesForTests();}
});

test('seller prices sort by current visible currency values without becoming delivered totals',async()=>{
 const base:any={catalogPricingMode:'seller',market:'korea',make:'Hyundai',model:'Avante',year:2024,mileageKm:40000,engineCc:1598,powerHp:123,fuel:'petrol',powertrainKind:'combustion',transmission:'automatic',drive:'fwd',bodyType:'sedan',cardImageUrl:'https://example.com/car.jpg',cardProjectionVersion:3,publicSpecificationVerified:true,calculationStatus:'ready',updatedAt:'2026-10-04T00:00:00Z'};
 const rows=Array.from({length:60},(_,i)=>({...base,id:`car-${i}`,sourceCurrency:'USD',sourcePrice:(60-i)*1000,year:2020+i%7,totalRub:1_000_000+i*10_000,publicVisibleRub:1_000_000+i*10_000}));
 rows.push({...base,id:'unknown',year:2024,totalRub:null,publicVisibleRub:undefined} as any);
 const generationId='compact-sort',index=buildBudgetCountIndex(generationId,rows,new Map(rows.map((r,i)=>[r.id,Math.floor(i/10)])),3);
 const legacy=index.rows.splice(30);for(const row of legacy){row[1]=0;row[7]=undefined;}index.otherRows!.push(...legacy);
 const storage=getJsonStorage(),original=storage.readJsonWithMeta,originalRead=storage.readJson,originalWrite=storage.writeJson,reads:string[]=[];let active=0,peak=0;
 storage.readJson=async<T>(key:string,fallback:T)=>(await storage.readJsonWithMeta(key,fallback)).value;
 storage.writeJson=async()=>{};
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  reads.push(key);let value:unknown;
  if(key==='markets/markets.json')value=[{id:'korea',versions:[{id:'fixture',status:'active',securityDepositRub:110000}]}];
  else if(key==='fees/exchange-rates.json')value={rates:[{currency:'USD',cbrRate:85,nominal:1,effectiveRate:85,rateDate:new Date().toISOString().slice(0,10),rateSource:'cbr'}]};
  else if(key.startsWith('catalog/runtime-sort-prices-v2/'))return {found:false,value:fallback};
  else if(key==='catalog/manifest.json')value={generationId,markets:{korea:{count:rows.length}}};
  else if(key.endsWith('/budget-count-v3.json'))value=index;
  else if(key.includes('/budget-cards-v3/')){active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;const block=Number(key.split('/').at(-1)!.replace('.json',''));value={generationId,items:rows.slice(block*10,block*10+10)};}
  else if(key==='catalog-editorial/current.json')return {found:false,value:fallback};
  else assert.fail('unexpected full projection or unrelated storage read: '+key);
  return {found:true,value:value as T};
 };
 try{
  resetCatalogReadCachesForTests();resetCatalogRateCache();invalidateEffectiveMarketsCache();
  for(const sort of ['year','yearAsc'] as const){const r=await searchOffers({fuel:'petrol',sort,pageSize:8});const years=r.items.map(x=>x.year);assert.deepEqual(years,[...years].sort((a,b)=>sort==='year'?b-a:a-b));assert.equal(r.total,61);}
  resetCatalogReadCachesForTests();resetCatalogRateCache();invalidateEffectiveMarketsCache();reads.length=0;peak=0;
  const ascending=await searchOffers({fuel:'petrol',sort:'totalRub',pageSize:8});
  assert.deepEqual(ascending.items.map(x=>x.id),Array.from({length:8},(_,i)=>`car-${59-i}`));
  assert.ok(ascending.items.every(x=>x.totalRub==null && x.catalogPricingMode==='seller' && Number(x.sellerPriceRub)>0));
  assert.equal(reads.filter(x=>x.includes('/budget-cards-')).length,4,'legacy missing price inputs recovered once in bounded blocks');
  const descending=await searchOffers({fuel:'petrol',sort:'totalRubDesc',pageSize:8});
  assert.deepEqual(descending.items.map(x=>x.id),Array.from({length:8},(_,i)=>`car-${i}`));
  assert.equal(reads.filter(x=>x.includes('/budget-cards-')).length,5,'reverse direction reuses recovered keys and reads only its visible block');
  assert.ok(peak<=2,`at most two blocks in flight, got ${peak}`);
  for(const sort of ['totalRub','totalRubDesc'] as const){const last=await searchOffers({fuel:'petrol',sort,page:8,pageSize:8});assert.equal(last.items.at(-1)?.id,'unknown');}
 }finally{storage.readJsonWithMeta=original;storage.readJson=originalRead;storage.writeJson=originalWrite;resetCatalogReadCachesForTests();resetCatalogRateCache();invalidateEffectiveMarketsCache();}
});

test('final page price order uses displayed Japan preview instead of underlying source total',()=>{
 const a={id:'a',totalRub:100,japanDeliveredPreview:{totalRub:300}},b={id:'b',totalRub:200,japanDeliveredPreview:{totalRub:250}};
 assert.deepEqual(sortCatalogRows([a,b],'totalRub').map(r=>r.id),['b','a']);
 assert.deepEqual(sortCatalogRows([a,b],'totalRubDesc').map(r=>r.id),['a','b']);
});

test('visible-page seller order uses the labelled seller value',()=>{
 const a={id:'a',catalogPricingMode:'seller',totalRub:null,sellerPriceRub:300},b={id:'b',catalogPricingMode:'seller',totalRub:null,sellerPriceRub:100};
 assert.deepEqual(sortCatalogRows([a,b],'totalRub').map(r=>r.id),['b','a']);
 assert.deepEqual(sortCatalogRows([a,b],'totalRubDesc').map(r=>r.id),['a','b']);
 assert.equal(a.totalRub,null);
});


test('delivered sorting keeps seller-only and hybrid rows after every calculated price in both directions',()=>{
 const rows=[{id:'hybrid',fuel:'hybrid',catalogPricingMode:'seller',sellerPriceRub:100,totalRub:null},
 {id:'expensive',totalRub:5500000},{id:'cheap',totalRub:1750000},
 {id:'seller',catalogPricingMode:'seller',sellerPriceRub:900000,totalRub:900000},
 {id:'calculated-hybrid',fuel:'hybrid',totalRub:2000000}];
 assert.deepEqual(sortCatalogRows(rows,'totalRub').map(r=>r.id),['cheap','calculated-hybrid','expensive','hybrid','seller']);
 assert.deepEqual(sortCatalogRows(rows,'totalRubDesc').map(r=>r.id),['expensive','calculated-hybrid','cheap','seller','hybrid']);
});

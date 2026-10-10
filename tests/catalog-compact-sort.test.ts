import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {searchOffers,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';
import {sortCatalogRows} from '../apps/web/lib/catalog/market-page';

test('compact sorting keeps exact order, shares direction price reads and bounds concurrent blocks',async()=>{
 const base:any={market:'korea',make:'Hyundai',model:'Avante',year:2024,mileageKm:40000,engineCc:1598,powerHp:123,fuel:'petrol',powertrainKind:'combustion',transmission:'automatic',drive:'fwd',bodyType:'sedan',cardImageUrl:'https://example.com/car.jpg',cardProjectionVersion:3,publicSpecificationVerified:true,calculationStatus:'ready',updatedAt:'2026-10-04T00:00:00Z'};
 const rows=Array.from({length:60},(_,i)=>({...base,id:`car-${i}`,year:2020+i%7,totalRub:1_000_000+i*10_000,publicVisibleRub:1_000_000+i*10_000}));
 rows.push({...base,id:'unknown',year:2024,totalRub:null,publicVisibleRub:undefined} as any);
 const generationId='compact-sort',index=buildBudgetCountIndex(generationId,rows,new Map(rows.map((r,i)=>[r.id,Math.floor(i/10)])));
 const storage=getJsonStorage(),original=storage.readJsonWithMeta,reads:string[]=[];let active=0,peak=0;
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  reads.push(key);let value:unknown;
  if(key==='markets/markets.json')value=[{id:'korea',versions:[{id:'fixture',status:'active',securityDepositRub:110000}]}];
  else if(key==='fees/exchange-rates.json')value={};
  else if(key==='catalog/manifest.json')value={generationId,markets:{korea:{count:rows.length}}};
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

test('v3 sorting reads full cards only for the visible page',async()=>{
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
  assert.equal(reads.filter(x=>x.includes('/budget-cards-')).length,1,'price ordering reads only the first visible block');
  const descending=await searchOffers({fuel:'petrol',sort:'totalRubDesc',pageSize:8});
  assert.deepEqual(descending.items.map(x=>x.id),Array.from({length:8},(_,i)=>`car-${59-i}`));
  assert.equal(reads.filter(x=>x.includes('/budget-cards-')).length,2,'reverse order reads only its visible block');
  assert.ok(peak<=2,`at most two blocks in flight, got ${peak}`);
  for(const sort of ['totalRub','totalRubDesc'] as const){const last=await searchOffers({fuel:'petrol',sort,page:8,pageSize:8});assert.equal(last.items.at(-1)?.id,'unknown');}
 }finally{storage.readJsonWithMeta=original;storage.readJson=originalRead;storage.writeJson=originalWrite;resetCatalogReadCachesForTests();}
});

test('final page price order uses displayed Japan preview instead of underlying source total',()=>{
 const a={id:'a',totalRub:100,japanDeliveredPreview:{totalRub:300}},b={id:'b',totalRub:200,japanDeliveredPreview:{totalRub:250}};
 assert.deepEqual(sortCatalogRows([a,b],'totalRub').map(r=>r.id),['b','a']);
 assert.deepEqual(sortCatalogRows([a,b],'totalRubDesc').map(r=>r.id),['a','b']);
});

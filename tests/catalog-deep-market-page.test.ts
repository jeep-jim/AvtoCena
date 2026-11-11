import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {prepareCatalogProjectionRows,searchOffers,searchOffersWithoutBudgetIndexForTests,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';

test('deep unfiltered market pages preserve authoritative order without loading the full projection',async(t)=>{
 const generationId='deep-market';
 const base:any={market:'china',make:'BMW',model:'X3',year:2024,engineCc:1598,powerHp:123,fuel:'petrol',powertrainKind:'combustion',transmission:'automatic',drive:'fwd',bodyType:'suv',cardImageUrl:'https://example.com/car.jpg',cardProjectionVersion:3,publicSpecificationVerified:true,calculationStatus:'ready',updatedAt:'2026-10-04T00:00:00Z'};
 const input=Array.from({length:250},(_,i)=>({...base,id:`car-${i}`,make:i%2?'BMW':'Audi',model:i%2?'X3':'A4',powerHp:i%4?123:220,updatedAt:`2026-10-${String(1+i%20).padStart(2,'0')}T00:00:00Z`,totalRub:1_000_000+i*100_000,publicVisibleRub:1_000_000+i*100_000}));
 input.push({...base,id:'seller',totalRub:null,catalogPricingMode:'seller',sellerPriceRub:800000} as any);
 input.push({...base,id:'unknown',totalRub:null,catalogPricingMode:'seller'} as any);
 const rows=prepareCatalogProjectionRows(input),index=buildBudgetCountIndex(generationId,rows,new Map(rows.map((row,i)=>[row.id,Math.floor(i/8)])),3);
 const storage=getJsonStorage(),oldRead=storage.readJsonWithMeta,reads:string[]=[];let allowProjection=true;
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  reads.push(key);let value:any;
  if(key==='catalog/manifest.json')value={generationId,markets:{china:{count:rows.length}}};
  else if(key==='catalog-editorial/current.json')value={revision:'no-edits',entries:{}};
  else if(key.endsWith('/budget-count-v3.json'))value=index;
  else if(key.includes('/budget-cards-v3/')){const block=Number(key.split('/').at(-1)!.replace('.json',''));value={generationId,items:rows.slice(block*8,block*8+8)};}
  else if(key.includes('/projection/')){assert.ok(allowProjection,'deep page must not load the entire market');value={generationId,items:rows};}
  return {found:value!==undefined,value:(value??fallback) as T};
 };
 try{
  resetCatalogReadCachesForTests();
  const full=await searchOffersWithoutBudgetIndexForTests({market:'china',pageSize:384},384);
  resetCatalogReadCachesForTests();allowProjection=false;
  const realNow=Date.now;let elapsed=0;t.mock.method(Date,'now',()=>realNow()+elapsed);
  for(const expiry of [0,31_000,306_000]){
   elapsed=expiry;reads.length=0;
   for(const page of [9,11,10187]){
    const actual=await searchOffers({market:'china',page,pageSize:24,city:'Новокузнецк'});
    assert.equal(actual.total,full.total);
    assert.deepEqual(actual.items.map(r=>r.id),full.items.slice((page-1)*24,page*24).map(r=>r.id));
   }
   assert.equal(reads.some(key=>key.includes('/projection/')),false);
  }
  t.mock.restoreAll();
  delete index.displayOrderVersion;resetCatalogReadCachesForTests();allowProjection=true;reads.length=0;
  const legacy=await searchOffers({market:'china',page:11,pageSize:24});
  assert.deepEqual(legacy.items.map(r=>r.id),full.items.slice(240,264).map(r=>r.id));
  assert.ok(reads.some(key=>key.includes('/projection/')),'legacy index keeps authoritative fallback');
 }finally{t.mock.restoreAll();storage.readJsonWithMeta=oldRead;resetCatalogReadCachesForTests();}
});

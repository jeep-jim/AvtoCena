import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {searchOffers,searchOffersWithoutBudgetIndexForTests,resetCatalogReadCachesForTests,prepareCatalogProjectionRows} from '../apps/web/lib/catalog/storage';

test('default brand/model browsing preserves projection order and reads only visible card blocks',async()=>{
 const base:any={market:'korea',make:'Hyundai',model:'Avante',year:2024,mileageKm:40000,engineCc:1598,powerHp:123,fuel:'petrol',powertrainKind:'combustion',transmission:'automatic',drive:'fwd',bodyType:'sedan',cardImageUrl:'https://example.com/car.jpg',cardProjectionVersion:3,publicSpecificationVerified:true,calculationStatus:'ready',updatedAt:'2026-10-04T00:00:00Z'};
 const input=Array.from({length:300},(_,i)=>({...base,id:`car-${i}`,color:i%2?'white':'black',make:i>=80?'Kia':'Hyundai',model:i%3?'Avante':'Avante N',powerHp:i%4?123:200,sourceGroup:i%2?'new':'used',updatedAt:`2026-10-${String(1+i%20).padStart(2,'0')}T00:00:00Z`,totalRub:1_000_000+i*10_000,publicVisibleRub:1_000_000+i*10_000}));
 input.push({...base,id:'seller-affordable',totalRub:null,catalogPricingMode:'seller',sellerPriceRub:800000} as any);
 input.push({...base,id:'seller-expensive',totalRub:null,catalogPricingMode:'seller',sellerPriceRub:20_000_000} as any);
 input.push({...base,id:'unknown',totalRub:null,catalogPricingMode:'seller'} as any);
 input.push({...base,id:'calculated-expensive',totalRub:22_000_000,publicVisibleRub:22_000_000} as any);
 const rows=prepareCatalogProjectionRows(input),generationId='brand-compact';
 const index=buildBudgetCountIndex(generationId,rows,new Map(rows.map((r,i)=>[r.id,Math.floor(i/8)])),3);
 const storage=getJsonStorage(),original=storage.readJsonWithMeta,reads:string[]=[];let allowProjection=true;let editorial:any;
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  reads.push(key);let value:unknown;
  if(key==='markets/markets.json')value=[];
  else if(key==='fees/exchange-rates.json')value={};
  else if(key==='catalog/manifest.json')value={generationId,markets:{korea:{count:rows.length}}};
  else if(key==='catalog-editorial/current.json'){if(editorial)value=editorial;else return {found:false,value:fallback};}
  else if(key.endsWith('/budget-count-v3.json'))value=index;
  else if(key.endsWith('/colors-v1.json'))value={generationId,rows:rows.map((r:any)=>[r.id,r.market,r.color])};
  else if(key.includes('/budget-cards-v3/')){const block=Number(key.split('/').at(-1)!.replace('.json',''));value={generationId,items:rows.slice(block*8,block*8+8)};}
  else if(key.includes('/projection-brand/')){assert.ok(allowProjection,'ordinary brand browsing must not download full brand projection');value={generationId,items:rows.filter(row=>row.make==='Hyundai')};}
  else assert.fail('unexpected storage read: '+key);
  return {found:true,value:value as T};
 };
 try{
  const queries=[{make:'Hyundai'},{make:'Hyundai',model:'Avante'},{make:'Hyundai',market:'korea'},{make:'Hyundai',model:'Avante',powerTo:160},{make:'Hyundai',yearFrom:2024},{make:'Hyundai',bodyType:'sedan'},{make:'Hyundai',bodyType:'suv'},{make:'Hyundai',color:'Белый'}];
  for(const query of queries){
   resetCatalogReadCachesForTests();allowProjection=true;
   const expected=await searchOffersWithoutBudgetIndexForTests({...query,pageSize:120},120);
   resetCatalogReadCachesForTests();allowProjection=false;reads.length=0;
   const actual=await searchOffers({...query,page:2,pageSize:7});
   assert.equal(actual.total,expected.total,JSON.stringify(query));
   assert.deepEqual(actual.items.map(r=>r.id),expected.items.slice(7,14).map(r=>r.id),'order before pagination: '+JSON.stringify(query));
   assert.ok(reads.filter(key=>key.includes('/budget-cards-')).length<=7,'at most one card block per visible car');
   assert.ok(!reads.some(key=>key.includes('/projection')));
   const last=await searchOffers({...query,page:Math.ceil(expected.total/7),pageSize:7});
   assert.deepEqual(last.items.map(r=>r.id),expected.items.slice((Math.ceil(expected.total/7)-1)*7).map(r=>r.id),'seller-only and unknown-price tail stays ordered');
  }
  for(const change of [{specifications:{powerHp:230}},{sellerPrice:{amount:1250000,currency:'RUB'}}]){
   editorial={revision:JSON.stringify(change),entries:{'car-1':{id:'car-1',market:'korea',status:'visible',...change}}};
   resetCatalogReadCachesForTests();allowProjection=true;
   const expected=await searchOffersWithoutBudgetIndexForTests({make:'Hyundai',pageSize:120},120);
   resetCatalogReadCachesForTests();reads.length=0;allowProjection=Boolean(change.sellerPrice);
   const actual=await searchOffers({make:'Hyundai',pageSize:120},120);
   assert.deepEqual(actual.items.map(r=>r.id),expected.items.map(r=>r.id),'manual changes retain authoritative order');
   if(change.sellerPrice)assert.ok(reads.some(key=>key.includes('/projection-brand/')));
  }
  editorial=undefined;
  // An old index must retain the authoritative path, never silently alter ordering.
  delete index.displayOrderVersion;resetCatalogReadCachesForTests();allowProjection=true;reads.length=0;
  await searchOffers({make:'Hyundai',sort:'year',pageSize:7});
  reads.length=0;
  await searchOffers({make:'Hyundai',pageSize:7});
  assert.ok(reads.some(key=>key.includes('/projection-brand/')));
 }finally{storage.readJsonWithMeta=original;resetCatalogReadCachesForTests();}
});

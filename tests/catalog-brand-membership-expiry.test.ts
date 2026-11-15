import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {searchOffers,resetCatalogReadCachesForTests,prepareCatalogProjectionRows} from '../apps/web/lib/catalog/storage';

test('make-only searches reuse immutable membership after request expiry and invalidate changed editorial or generation',async(t)=>{
 let now=Date.now(),generationId='brand-expiry-one',editorial:any,metadataReads=0;
 const base:any={market:'europe',make:'BMW',model:'X3',year:2024,mileageKm:40000,engineCc:1998,powerHp:150,fuel:'petrol',powertrainKind:'combustion',cardImageUrl:'https://example.test/car.jpg',cardProjectionVersion:3,publicSpecificationVerified:true,updatedAt:'2026-11-01T00:00:00Z'};
 const rows=prepareCatalogProjectionRows(Array.from({length:300},(_,i)=>({...base,id:'expiry-'+i,make:i%3?'BMW':'Audi',totalRub:2_000_000+i*1000,publicVisibleRub:2_000_000+i*1000})));
 const build=()=>{
  const index=buildBudgetCountIndex(generationId,rows,new Map(rows.map(row=>[row.id,0])),3);
  for(const row of [...index.rows,...(index.otherRows||[])]){
   const make=row[5].make;
   Object.defineProperty(row[5],'make',{enumerable:true,get(){metadataReads++;return make;}});
  }
  return index;
 };
 let index=build();
 t.mock.method(Date,'now',()=>now);
 t.mock.method(getJsonStorage(),'readJsonWithMeta',async(key:string,fallback:any)=>{
  if(key==='catalog/manifest.json')return {found:true,value:{generationId,markets:{europe:{count:rows.length}}}};
  if(key==='catalog-editorial/current.json')return editorial?{found:true,value:editorial}:{found:false,value:fallback};
  if(key.endsWith('/budget-count-v3.json'))return {found:true,value:index};
  if(key.includes('/budget-cards-v3/'))return {found:true,value:{generationId,items:rows}};
  if(key==='markets/markets.json')return {found:true,value:[]};
  if(key==='fees/exchange-rates.json')return {found:true,value:{}};
  return {found:false,value:fallback};
 });
 resetCatalogReadCachesForTests();
 try{
  const query={market:'europe',make:'BMW',page:2,pageSize:24};
  const first=await searchOffers(query);
  assert.equal(first.total,200);assert.equal(first.items.length,24);assert.ok(metadataReads>0);
  metadataReads=0;now+=35_000;
  const refreshed=await searchOffers(query);
  assert.deepEqual(refreshed.items,first.items);assert.equal(refreshed.total,first.total);
  assert.equal(metadataReads,0,'unchanged make-only membership and sort positions must not be rebuilt after 30 seconds');
  const hidden=first.items[0].id;
  editorial={revision:'hidden-next',entries:{[hidden]:{id:hidden,market:'europe',status:'hidden'}}};now+=35_000;
  const edited=await searchOffers(query);
  assert.equal(edited.total,199);assert.ok(!edited.items.some(row=>row.id===hidden));
  assert.ok(metadataReads>0,'new editorial authority recomputes membership');
  generationId='brand-expiry-two';index=build();now+=61_000;
  const replacement=await searchOffers(query);
  assert.equal(replacement.generationId,generationId);assert.equal(replacement.total,199);
 }finally{t.mock.restoreAll();resetCatalogReadCachesForTests();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {withCatalogEditorial} from '../apps/web/lib/catalog/editorial';
import {buildCatalogMarketLanding,buildCatalogOverviewFromProjections,prepareCatalogProjectionRows,readHomeCatalogSnapshot,searchOffers,searchOffersWithoutBudgetIndexForTests,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';

test('hidden market homepage and pagination retain exact display order after five minutes without full projections',async(t)=>{
 const generationId='hidden-market';
 const base:any={market:'europe',make:'BMW',model:'X3',year:2024,engineCc:1598,powerHp:123,fuel:'petrol',powertrainKind:'combustion',transmission:'automatic',drive:'fwd',bodyType:'suv',cardImageUrl:'https://example.com/car.jpg',cardProjectionVersion:3,publicSpecificationVerified:true,calculationStatus:'ready',updatedAt:'2026-10-04T00:00:00Z'};
 const input=Array.from({length:250},(_,i)=>({...base,id:`car-${i}`,make:i%2?'BMW':'Audi',model:i%2?'X3':'A4',powerHp:i%4?123:220,sourceGroup:i%2?'new':'used',updatedAt:`2026-10-${String(1+i%20).padStart(2,'0')}T00:00:00Z`,totalRub:1_000_000+i*100_000,publicVisibleRub:1_000_000+i*100_000}));
 input.push({...base,id:'seller-affordable',totalRub:null,catalogPricingMode:'seller',sellerPriceRub:800000} as any);
 input.push({...base,id:'seller-expensive',totalRub:null,catalogPricingMode:'seller',sellerPriceRub:20_000_000} as any);
 input.push({...base,id:'unknown',totalRub:null,catalogPricingMode:'seller'} as any);
 const rows=prepareCatalogProjectionRows(input),index=buildBudgetCountIndex(generationId,rows,new Map(rows.map((row,i)=>[row.id,Math.floor(i/8)])),3);
 const overview=await buildCatalogOverviewFromProjections(generationId,rows);
 let editorial:any={revision:'hidden-1',entries:{'car-1':{id:'car-1',market:'europe',status:'hidden'}}};
 const storage=getJsonStorage(),oldRead=storage.readJsonWithMeta,reads:string[]=[];let allowProjection=false;
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  reads.push(key);let value:any;
  if(key==='catalog/manifest.json')value={generationId,markets:{europe:{count:rows.length}}};
  else if(key==='catalog-editorial/current.json')value=editorial;
  else if(key.endsWith('/overview.json'))value=overview;
  else if(key.endsWith('/budget-count-v3.json'))value=index;
  else if(key.includes('/budget-cards-v3/')){const block=Number(key.split('/').at(-1)!.replace('.json',''));value={generationId,items:rows.slice(block*8,block*8+8)};}
  else if(key.includes('/projection/')){assert.ok(allowProjection,'hidden market must not load a complete projection');value={generationId,items:rows};}
  return {found:value!==undefined,value:(value??fallback) as T};
 };
 try{
  resetCatalogReadCachesForTests();
  const expected=await withCatalogEditorial(()=>buildCatalogMarketLanding(generationId,'europe',rows));
  allowProjection=true;
  const expectedFull=await searchOffersWithoutBudgetIndexForTests({market:'europe',pageSize:384},384);
  resetCatalogReadCachesForTests();allowProjection=false;
  const realNow=Date.now;let elapsed=0;t.mock.method(Date,'now',()=>realNow()+elapsed);
  for(const expiry of [0,31_000,306_000]){
   elapsed=expiry;reads.length=0;
   const page=await searchOffers({market:'europe',page:2,pageSize:7});
   assert.equal(page.total,rows.length-1);assert.deepEqual(page.items.map(r=>r.id),expected.items.slice(7,14).map(r=>r.id));
   assert.ok(reads.filter(key=>key.includes('/budget-cards-')).length<=7);
   const home=await readHomeCatalogSnapshot(10);
   assert.equal(home.marketCounts.europe,rows.length-1);assert.deepEqual(home.items.map(r=>r.id),expected.items.slice(0,10).map(r=>r.id));
   const tail=await searchOffers({market:'europe',page:Math.ceil(page.total/7),pageSize:7});
   assert.deepEqual(tail.items.map(r=>r.id),expectedFull.items.slice((Math.ceil(page.total/7)-1)*7).map(r=>r.id),'seller/unknown tail keeps authoritative ordering');
   assert.equal(reads.some(key=>key.includes('/projection/')),false,'no full reads after short or five-minute expiry');
  }
  t.mock.restoreAll();
  // Restoring the hidden car changes membership immediately; another hidden ID
  // keeps this query on the compact editorial path.
  editorial={revision:'hidden-2',entries:{'car-1':{id:'car-1',market:'europe',status:'visible'},'car-2':{id:'car-2',market:'europe',status:'hidden'}}};
  resetCatalogReadCachesForTests();reads.length=0;
  const changed=await searchOffers({market:'europe',pageSize:384},384);
  assert.ok(changed.items.some(r=>r.id==='car-1'));assert.ok(!changed.items.some(r=>r.id==='car-2'));
  assert.equal(reads.some(key=>key.includes('/projection/')),false);
  // Old selectors and manual seller-price edits retain the authoritative route.
  for(const oldIndex of [false,true]){
   if(oldIndex)delete index.displayOrderVersion;
   else editorial.entries['seller-affordable']={id:'seller-affordable',market:'europe',status:'visible',sellerPrice:{amount:1500000,currency:'RUB'}};
   resetCatalogReadCachesForTests();allowProjection=true;reads.length=0;
   const actual=await searchOffers({market:'europe',pageSize:24});
   const full=await searchOffersWithoutBudgetIndexForTests({market:'europe',pageSize:24});
   assert.deepEqual(actual.items.map(r=>r.id),full.items.map(r=>r.id));
   assert.ok(reads.some(key=>key.includes('/projection/')));
   delete editorial.entries['seller-affordable'];
  }
 }finally{t.mock.restoreAll();storage.readJsonWithMeta=oldRead;resetCatalogReadCachesForTests();}
});

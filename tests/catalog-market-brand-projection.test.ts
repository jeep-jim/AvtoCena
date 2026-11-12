import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {searchOffers,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';
const rows=Array.from({length:260},(_,i)=>({id:`brand-${i}`,market:i%2?'korea':'china',make:i%3?'Nissan':'Toyota',model:'K5',year:2023,
 cardProjectionVersion:3,cardImageUrl:'https://example.test/car.jpg',fuel:'petrol',powertrainKind:'combustion',
 engineCc:1999,powerHp:160,powerKw:117.68,icePowerKw:117.68,utilizationPowerKw:117.68,
 publicVisibleRub:3000000+i,totalRub:3000000+i,publicSpecificationVerified:true,sourcePrice:30000000,sourceCurrency:'KRW',
 sourceGroup:i%5?'source-a':'source-b',updatedAt:new Date(Date.UTC(2026,8,1,0,i)).toISOString(),
 calculationSnapshot:{currencyRate:{currency:'KRW',sourcePrice:30000000,effectiveRate:.06,rateSource:'cbr',rateDate:'2026-09-19'}}}));
const queries=[{market:'korea',make:'Nissan',page:2},{market:'china',make:'Nissan',sort:'totalRub'},
 {market:'korea',make:'Nissan',yearFrom:2023},{market:'korea',make:'Nissan',model:'K5'},
 {market:'korea',make:'Nissan',budgetTo:4000000,city:'Новокузнецк'},
 {market:'china',make:'Nissan',budgetTo:4000000,city:'Москва'}] as any[];
function fixture(t:any,available:boolean,generation=()=> 'one') {
 const reads:string[]=[];
 t.mock.method(getJsonStorage(),'readJsonWithMeta',async(file:string,fallback:any)=>{
  reads.push(file);const generationId=generation();
  if(file==='catalog/manifest.json')return {found:true,value:{generationId,markets:{china:{count:130},korea:{count:130}}}};
  if(file.includes('/projection-brand/'))return {found:available,value:available?{generationId,items:rows.filter(r=>r.make==='Nissan')}:fallback};
  if(file.includes('/projection/'))return {found:true,value:{generationId,items:rows.filter(r=>file.endsWith(`${r.market}.json`))}};
  return {found:false,value:fallback};
 });
 return reads;
}
test('market-scoped brand results match full market filtering and share one compact read',async(t)=>{
 resetCatalogReadCachesForTests();fixture(t,false);
 const expected=await Promise.all(queries.map(q=>searchOffers(q)));
 t.mock.restoreAll();resetCatalogReadCachesForTests();const reads=fixture(t,true);
 const actual=await Promise.all(queries.map(q=>searchOffers(q)));
 for(let i=0;i<queries.length;i++){
  assert.deepEqual(actual[i].items,expected[i].items);assert.equal(actual[i].total,expected[i].total);
  assert.ok(actual[i].items.every(r=>r.market===queries[i].market));
 }
 assert.equal(reads.filter(p=>p.includes('/projection-brand/')).length,1);
 assert.equal(reads.filter(p=>p.includes('/projection/')).length,0);
 t.mock.restoreAll();resetCatalogReadCachesForTests();
});
test('brand cache is generation-scoped immediately after the shared manifest refresh',async(t)=>{
 resetCatalogReadCachesForTests();let generation='one',now=Date.now();
 t.mock.method(Date,'now',()=>now);const reads=fixture(t,true,()=>generation);
 assert.equal((await searchOffers(queries[0])).generationId,'one');
 generation='two';now+=61000;
 assert.equal((await searchOffers(queries[0])).generationId,'two');
 assert.equal(reads.filter(p=>p.includes('/projection-brand/')).length,2);
 assert.equal(reads.filter(p=>p.includes('/projection/')).length,0);
 t.mock.restoreAll();resetCatalogReadCachesForTests();
});

// Exercise the actual projection boundary with deterministic I/O. Pricing is
// downstream: grouped searches must receive disjoint country inputs there.
test('six country searches prepare each brand row once, not six times',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('../apps/web/lib/catalog/storage.ts',import.meta.url),'utf8');
 const start=source.indexOf('async function currentProjectionRows('),end=source.indexOf('/** Small publication summary',start);
 const implementation=source.slice(start,end).replace('params: CatalogSearchParams = {}','params = {}');
 const markets=['china','korea','japan','uae','europe','georgia'];
 const input=markets.flatMap(market=>Array.from({length:5},(_,i)=>({id:market+i,market,make:'Audi'})));
 let prepared=0;
 const read=new Function('catalogMakeFilterValues','readManifest','readCurrentBrandProjection','prepareCatalogProjectionRows','projectionModelKeys','projectionIdentityMatches',implementation+';return currentProjectionRows;')(
  ()=>['Audi'],async()=>({generationId:'test'}),async()=>({generationId:'test',items:input}), (rows:any[])=>{prepared+=rows.length;return rows;},
  async()=>null,(row:any,params:any)=>!params.market||params.market==='any'||row.market===params.market);
 const results=await Promise.all(markets.map(market=>read({make:'Audi',market,budgetTo:3000000})));
 assert.equal(prepared,input.length);assert.equal(new Set(results.flatMap(r=>r.rows.map((row:any)=>row.id))).size,input.length);
 results.forEach((r,i)=>assert.deepEqual(r.rows,input.filter(row=>row.market===markets[i])));
 assert.deepEqual((await read({make:'Audi'})).rows,input);
 assert.deepEqual((await read({make:'Audi',market:'any'})).rows,input);
});

test('brand budget uses a current prepared V3 snapshot and never rebuilds another brand on a miss',async(t)=>{
 const {buildBudgetCountIndex}=await import('../apps/web/lib/catalog/budget-count-index');
 const {budgetPricingFingerprint,sharedBudgetPrices}=await import('../apps/web/lib/catalog/shared-budget-prices');
 const generationId='brand-budget-cold';let activeGeneration=generationId;
 const clock=Date.now();let now=clock;t.mock.method(Date,'now',()=>now);
 const index=buildBudgetCountIndex(generationId,rows as any,new Map(rows.map((r,i)=>[r.id,i])));
 index.version=3;
 index.pricingChunks={china:['forbidden-replay/china.json'],korea:['forbidden-replay/korea.json']};
 const objects=new Map<string,any>();const reads:string[]=[];
 t.mock.method(getJsonStorage(),'readJsonWithMeta',async(file:string,fallback:any)=>{
  reads.push(file);
  assert.ok(!file.includes('forbidden-replay/'),'a narrow brand budget must not initiate a whole-market price replay');
  let value=objects.get(file);
  if(file==='catalog/manifest.json')value={generationId:activeGeneration,markets:{china:{count:130},korea:{count:130}}};
  else if(file.endsWith('/budget-count-v3.json'))value=index;
  else if(file.includes('/projection-brand/'))value={generationId:activeGeneration,items:rows.filter(r=>r.make==='Nissan')};
  else if(file.includes('/budget-cards-v3/')){const block=Number(file.split('/').at(-1)!.replace('.json',''));value={generationId,items:[rows[block]]};}
  else if(file.includes('/projection/'))assert.fail('must not read a complete market');
  return {found:value!==undefined,value:value??fallback};
 });
 t.mock.method(getJsonStorage(),'writeJson',async(file:string,value:any)=>{objects.set(file,value);});
 const params={market:'korea',make:'Nissan',model:'K5',budgetTo:4000000,pageSize:6};
 const previous=process.env.AVTOCENA_CALCULATION_VERSION;
 try{
  // First preserve the authoritative, original brand-only fallback result.
  resetCatalogReadCachesForTests();
  const {searchOffersWithoutBudgetIndexForTests}=await import('../apps/web/lib/catalog/storage');
  const expected=await searchOffersWithoutBudgetIndexForTests(params);
  assert.ok(expected.total>6);
  for(const state of ['selector-cold','selector-expired','generation-changed','missing','ready','changed-calculation','invalid'] as const){
   now=clock;activeGeneration=generationId;resetCatalogReadCachesForTests();objects.clear();
   process.env.AVTOCENA_CALCULATION_VERSION='a'.repeat(64);
   if(state!=='missing'){
    const fingerprint=await budgetPricingFingerprint('korea');assert.ok(fingerprint);
    await sharedBudgetPrices(index,'korea',fingerprint,async()=>index.rows.filter(r=>r[0]==='korea'),undefined,false,{persistence:'required'});
   }
   if(state==='changed-calculation')process.env.AVTOCENA_CALCULATION_VERSION='b'.repeat(64);
   if(state==='invalid')for(const key of objects.keys())objects.set(key,{version:1,key:'invalid'});
   resetCatalogReadCachesForTests();
   if(state!=='selector-cold'){
    const {countCatalogOffers}=await import('../apps/web/lib/catalog/storage');
    await countCatalogOffers({market:'korea',yearFrom:2021});
   }
   if(state==='selector-expired')now+=3_600_001;
   if(state==='generation-changed'){activeGeneration='brand-budget-next';now+=61_000;}
   reads.length=0;
   const actual=await searchOffers(params);
   if(['selector-cold','selector-expired','generation-changed'].includes(state))assert.equal(reads.some(p=>p.includes('/budget-count-')||p.includes('/budget-markets-')),false,'cold brand request must not load the entire market selector');
   assert.equal(actual.total,expected.total,state);
   assert.deepEqual(actual.items.map(r=>[r.id,r.totalRub]),expected.items.map(r=>[r.id,r.totalRub]),state);
   assert.equal(reads.some(p=>p.includes('/projection-brand/')),state!=='ready',state);
  }
 }finally{
  if(previous===undefined)delete process.env.AVTOCENA_CALCULATION_VERSION;else process.env.AVTOCENA_CALCULATION_VERSION=previous;
  t.mock.restoreAll();resetCatalogReadCachesForTests();
 }
});

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
 {market:'korea',make:'Nissan',yearFrom:2023},{market:'korea',make:'Nissan',model:'K5'}] as any[];
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

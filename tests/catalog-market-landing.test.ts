import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCatalogMarketLanding,catalogMarketLandingPath,backfillCatalogMarketLandings,readCatalogFacets,searchOffers,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';
import {getJsonStorage} from '../apps/web/lib/data';
const rows=Array.from({length:220},(_,i)=>({id:`car-${i}`,market:'korea',make:i%2?'Hyundai':'Kia',model:'K5',year:2023,
 cardProjectionVersion:3,cardImageUrl:'https://example.test/car.jpg',fuel:'petrol',powertrainKind:'combustion',bodyType:'sedan',
 engineCc:1999,powerHp:160,powerKw:117.68,icePowerKw:117.68,utilizationPowerKw:117.68,
 publicVisibleRub:3000000,publicSpecificationVerified:true,totalRub:3000000+i,sourcePrice:30000000,sourceCurrency:'KRW',
 sourceGroup:i%3?'encar':'kcar',updatedAt:new Date(Date.UTC(2026,8,1,0,i)).toISOString(),
 calculationSnapshot:{currencyRate:{currency:'KRW',sourcePrice:30000000,effectiveRate:.06,rateSource:'cbr',rateDate:'2026-09-19'}}})) as any[];
function fixture(t:any,landing:any) {
 const reads:string[]=[];
 t.mock.method(getJsonStorage(),'readJsonWithMeta',async(file:string)=>{
  reads.push(file);
  if(file==='catalog/manifest.json')return {found:true,value:{generationId:'test',markets:{korea:{count:rows.length}}}};
  if(file===catalogMarketLandingPath('test','korea'))return {found:!!landing,value:landing};
  if(file.includes('/projection/'))return {found:true,value:{generationId:'test',items:rows}};
  throw Error(`Unexpected read ${file}`);
 });
 return reads;
}
test('compact first eight pages and facets match full search without reading the full market',async(t)=>{
 const snapshot=JSON.stringify(rows);
 const landing=await buildCatalogMarketLanding('test','korea',rows);
 const queries=[{market:'korea',page:1},{market:'korea',page:2},{market:'korea',page:8},{market:'korea',pageSize:192}] as any[];
 let reads=fixture(t,null);
 const expected=[];
 for(const q of queries)expected.push(await searchOffers(q,192));
 const facets=await readCatalogFacets({market:'korea'});
 t.mock.restoreAll();resetCatalogReadCachesForTests();reads=fixture(t,landing);
 for(let i=0;i<queries.length;i++){
  const actual=await searchOffers(queries[i],192);
  assert.deepEqual(actual.items,expected[i].items);assert.equal(actual.total,expected[i].total);
 }
 assert.deepEqual(await readCatalogFacets({market:'korea'}),facets);
 assert.equal(reads.filter(p=>p.includes('/projection/')).length,0);
 assert.equal(reads.filter(p=>p.includes('/market-landing-')).length,1);
 assert.equal(JSON.stringify(rows),snapshot,'building indexes must preserve source evidence');
 t.mock.restoreAll();resetCatalogReadCachesForTests();
});
test('later pages, filters, custom sorting and city requests retain full-search behavior',async(t)=>{
 const landing=await buildCatalogMarketLanding('test','korea',rows);
 for(const query of [{page:9},{make:'Kia'},{sort:'totalRub'},{city:'Кемерово'}]){
  resetCatalogReadCachesForTests();const reads=fixture(t,landing);
  await searchOffers({market:'korea',...query} as any);
  assert.ok(reads.some(p=>p.includes('/projection/')),JSON.stringify(query));t.mock.restoreAll();
 }
 resetCatalogReadCachesForTests();
});
test('wrong generations, incomplete counts and malformed samples fall back safely',async(t)=>{
 const valid=await buildCatalogMarketLanding('test','korea',rows);
 for(const landing of [{...valid,generationId:'old'},{...valid,sourceTotal:221},{...valid,items:valid.items.slice(1)}]){
  resetCatalogReadCachesForTests();const reads=fixture(t,landing);
  assert.equal((await searchOffers({market:'korea'})).total,220);
  assert.ok(reads.some(p=>p.includes('/projection/')));t.mock.restoreAll();
 }
 resetCatalogReadCachesForTests();
});
test('backfill only appends derived immutable objects with conditional writes',async(t)=>{
 fixture(t,null);const writes:any[]=[];
 t.mock.method(getJsonStorage(),'writeJson',async(...args:any[])=>{writes.push(args);});
 const result=await backfillCatalogMarketLandings();
 assert.equal(result.results[0].samples,192);
 assert.equal(writes.length,1);assert.equal(writes[0][0],catalogMarketLandingPath('test','korea'));
 assert.deepEqual(writes[0][2],{ifNoneMatch:'*'});
 t.mock.restoreAll();resetCatalogReadCachesForTests();
});

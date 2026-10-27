import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCatalogOverviewFromProjections,buildCatalogMarketLanding,catalogMarketLandingPath,backfillCatalogMarketLandings,readCatalogFacets,readPublicCatalogMarketCounts,searchOffers,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';
import {getJsonStorage,StorageConflictError} from '../apps/web/lib/data';
const rows=Array.from({length:220},(_,i)=>({id:`car-${i}`,market:'korea',make:i%2?'Hyundai':'Kia',model:'K5',year:2023,
 cardProjectionVersion:3,cardImageUrl:'https://example.test/car.jpg',fuel:'petrol',powertrainKind:'combustion',bodyType:'sedan',
 engineCc:1999,powerHp:160,powerKw:117.68,icePowerKw:117.68,utilizationPowerKw:117.68,
 publicVisibleRub:3000000,publicSpecificationVerified:true,totalRub:3000000+i,sourcePrice:30000000,sourceCurrency:'KRW',
 sourceGroup:i%3?'encar':'kcar',updatedAt:new Date(Date.UTC(2026,8,1,0,i)).toISOString(),
 calculationSnapshot:{currencyRate:{currency:'KRW',sourcePrice:30000000,effectiveRate:.06,rateSource:'cbr',rateDate:'2026-09-19'}}})) as any[];
function fixture(t:any,landing:any) {
 const reads:string[]=[];
 t.mock.method(getJsonStorage(),'readJsonWithMeta',async(file:string)=>{
  if(file==='catalog-editorial/current.json')return {found:false,value:{revision:'0',entries:{}}};
  reads.push(file);
  if(file==='markets/markets.json')return {found:true,value:[]};
  if(file==='catalog/manifest.json')return {found:true,value:{generationId:'test',markets:{korea:{count:rows.length}}}};
  if(file==='catalog/public/facets.json')return {found:false,value:{generationId:''}};
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
 assert.deepEqual(await readCatalogFacets({market:'korea',city:'Уссурийск',sort:'totalRub'}),facets,'city without price bounds must retain prepared facets');
 assert.equal(reads.filter(p=>p.includes('/projection/')).length,0);
 assert.equal(reads.filter(p=>p.includes('/market-landing-')).length,1);
 assert.equal(JSON.stringify(rows),snapshot,'building indexes must preserve source evidence');
 t.mock.restoreAll();resetCatalogReadCachesForTests();
});
test('public market counts use validated landings and preserve exact fallback totals',async(t)=>{
 const landing=await buildCatalogMarketLanding('test','korea',rows);
 for(const prepared of [landing,{...landing,generationId:'old'},null]){
  resetCatalogReadCachesForTests();const reads=fixture(t,prepared);
  const counts=await readPublicCatalogMarketCounts();
  assert.equal(counts.generationId,'test');assert.equal(counts.total,landing.total);
  assert.equal(counts.markets.korea,landing.total);
  assert.ok(Object.entries(counts.markets).every(([market,count])=>market==='korea'||count===0));
  if(prepared===landing)assert.equal(reads.some(path=>path.includes('/projection/')),false);
  else assert.ok(reads.some(path=>path.includes('/projection/')));
  t.mock.restoreAll();
 }
 resetCatalogReadCachesForTests();
});
test('later pages, filters and custom sorting retain full-search behavior',async(t)=>{
 const landing=await buildCatalogMarketLanding('test','korea',rows);
 for(const query of [{page:9},{make:'Kia'},{sort:'totalRub'}]){
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

test('daily refresh replaces yesterday with compare-and-swap and restores compact search parity',async(t)=>{
 const storage=getJsonStorage();
 let stored={...await buildCatalogMarketLanding('test','korea',rows),policyDate:'2000-01-01'};
 fixture(t,null);const base=storage.readJsonWithMeta.bind(storage),writes:string[]=[];
 const reads:string[]=[];
 t.mock.method(storage,'readJsonWithMeta',async(file:string,fallback:any)=>{
  reads.push(file);
  if(file==='catalog/import-lock.json')return {found:false,value:null};
  if(file===catalogMarketLandingPath('test','korea'))return {found:true,etag:'yesterday',value:stored};
  return base(file,fallback);
 });
 t.mock.method(storage,'writeJson',async(file:string,value:any,condition:any)=>{
  assert.equal(file,catalogMarketLandingPath('test','korea'));
  assert.deepEqual(condition,{ifMatch:'yesterday'});writes.push(file);stored=value;
 });
 resetCatalogReadCachesForTests();
 const expected=await searchOffers({market:'korea',pageSize:3});
 assert.ok(reads.some(file=>file.includes('/projection/')),'yesterday must not bypass age checks');
 await backfillCatalogMarketLandings({refreshDateSensitive:true});
 assert.equal(writes.length,1);
 resetCatalogReadCachesForTests();reads.length=0;
 const actual=await searchOffers({market:'korea',pageSize:3});
 assert.equal(actual.total,expected.total);assert.deepEqual(actual.items,expected.items);
 assert.equal(reads.some(file=>file.includes('/projection/')),false,'fresh first page must not read the full market');
 t.mock.restoreAll();resetCatalogReadCachesForTests();
});

test('daily refresh refuses active publisher and never hides a competing write',async(t)=>{
 for(const locked of [true,false]){
  fixture(t,null);const storage=getJsonStorage(),base=storage.readJsonWithMeta.bind(storage);let writes=0;
  t.mock.method(storage,'readJsonWithMeta',async(file:string,fallback:any)=>{
   if(file==='catalog/import-lock.json')return {found:true,value:locked?{lockedUntil:new Date(Date.now()+60000).toISOString()}:null};
   return base(file,fallback);
  });
  t.mock.method(storage,'writeJson',async()=>{writes++;throw new StorageConflictError();});
  if(locked){await assert.rejects(backfillCatalogMarketLandings({refreshDateSensitive:true}),/publication_in_progress/);assert.equal(writes,0);}
  else {await assert.rejects(backfillCatalogMarketLandings({refreshDateSensitive:true}),StorageConflictError);assert.equal(writes,1);}
  t.mock.restoreAll();resetCatalogReadCachesForTests();
 }
});

test('nested repair landing keeps owner verification and CAS through the write boundary',async(t)=>{
 const owner={operationId:'read-model-repair-test',operationType:'catalog_read_model_repair' as const,startedAt:new Date().toISOString(),lockedUntil:new Date(Date.now()+60000).toISOString()};
 for(const loseLease of [false,true]){
  fixture(t,null);const storage=getJsonStorage(),base=storage.readJsonWithMeta.bind(storage);let writes=0,lockReads=0;
  t.mock.method(storage,'readJsonWithMeta',async(file:string,fallback:any)=>{
   if(file==='catalog/import-lock.json'){lockReads++;return {found:true,value:loseLease&&lockReads>1?{...owner,operationId:'other'}:owner};}
   return base(file,fallback);
  });
  t.mock.method(storage,'writeJson',async(_file:string,_value:any,condition:any)=>{writes++;assert.deepEqual(condition,{ifNoneMatch:'*'});});
  if(loseLease){await assert.rejects(backfillCatalogMarketLandings({refreshDateSensitive:true,repairLease:owner}),/lease_lost/);assert.equal(writes,0);}
  else {await backfillCatalogMarketLandings({refreshDateSensitive:true,repairLease:owner});assert.equal(writes,1);assert.ok(lockReads>=3);}
  t.mock.restoreAll();resetCatalogReadCachesForTests();
 }
});

test('future landing uses exact age date and cannot poison the current-day cache',async()=>{
 const today=new Date('2026-10-26T16:59:00Z'),tomorrow=new Date('2026-10-26T17:01:00Z');
 const source=[{...rows[0],id:'expires',year:2020,inventorySourceDate:'2020-10-26'},
  {...rows[1],id:'retained',year:2020,inventorySourceDate:'2020-10-27'}];
 const before=await buildCatalogMarketLanding('test','korea',source,{now:today});
 const after=await buildCatalogMarketLanding('test','korea',source,{now:tomorrow});
 assert.equal(before.total,2);assert.equal(after.total,1);assert.equal(after.items[0].id,'retained');
 assert.equal(after.sourceTotal,2);assert.equal(after.policyDate,'2026-10-27');
 const overview=await buildCatalogOverviewFromProjections('test',source,{now:tomorrow});
 assert.equal(overview.policyDate,'2026-10-27');assert.equal(overview.markets.korea.sourceTotal,2);
 assert.equal(overview.markets.korea.total,1);assert.deepEqual(overview.markets.korea.items.map(row=>row.id),['retained']);
 assert.equal((await buildCatalogMarketLanding('test','korea',source,{now:today})).total,2);
});
test('dated landing replaces expired base without loading full projections',async(t)=>{
 const valid=await buildCatalogMarketLanding('test','korea',rows);
 resetCatalogReadCachesForTests();const reads=fixture(t,{...valid,policyDate:'2000-01-01'});
 const storage=getJsonStorage(),base=storage.readJsonWithMeta.bind(storage);
 t.mock.method(storage,'readJsonWithMeta',async(file:string,fallback:any)=>{
  if(file===catalogMarketLandingPath('test','korea').replace('.json',`.${valid.policyDate}.json`))return {found:true,value:valid};
  return base(file,fallback);
 });
 assert.equal((await searchOffers({market:'korea'})).total,valid.total);
 assert.equal(reads.some(path=>path.includes('/projection/')),false);
 t.mock.restoreAll();resetCatalogReadCachesForTests();
});


test('selected city alone keeps exact first-page inventory on the prepared path',async(t)=>{
 const landing=await buildCatalogMarketLanding('test','korea',rows);
 for(const city of ['Новокузнецк','Уссурийск','Москва'])for(const page of [1,8]){
  resetCatalogReadCachesForTests();fixture(t,null);
  const expected=await searchOffers({market:'korea',city,page});
  t.mock.restoreAll();resetCatalogReadCachesForTests();const reads=fixture(t,landing);
  const actual=await searchOffers({market:'korea',city,page});
  assert.deepEqual(actual.items,expected.items,`exact identity/order/prices for ${city}, page ${page}`);
  assert.equal(actual.total,expected.total);
  assert.equal(reads.some(path=>path.includes('/projection/')),false,'city-only navigation must not download a whole market');
  t.mock.restoreAll();
 }
 resetCatalogReadCachesForTests();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCatalogProjectionRows,resetCatalogReadCachesForTests,readCatalogFacets,searchOffers} from '../apps/web/lib/catalog/storage';
import {getJsonStorage} from '../apps/web/lib/data';

function row():any {
 return {id:'projection-reuse',market:'korea',make:'Kia',model:'K5',year:2023,
 cardProjectionVersion:3,cardImageUrl:'https://example.test/car.jpg',fuel:'petrol',powertrainKind:'combustion',
 engineCc:1999,powerHp:160,powerKw:117.68,icePowerKw:117.68,utilizationPowerKw:117.68,
 publicVisibleRub:3000000,publicSpecificationVerified:true,totalRub:3000000,sourcePrice:30000000,sourceCurrency:'KRW',
 calculationSnapshot:{currencyRate:{currency:'KRW',sourcePrice:30000000,effectiveRate:.06,rateSource:'cbr',rateDate:'2026-09-19'}}};
}
test('facets and market views reuse immutable row checks without modifying stored evidence',()=>{
 resetCatalogReadCachesForTests();
 let reads=0;const input=row();Object.defineProperty(input,'powerDataSource',{get(){reads++;return 'manufacturer_official';},enumerable:true});
 const first=prepareCatalogProjectionRows([input]);const checked=reads;
 assert.equal(first.length,1);assert.ok(checked>0);
 const next=prepareCatalogProjectionRows([input]);assert.equal(reads,checked);
 assert.equal(next[0],first[0]);assert.notEqual(next,first);
 next.length=0;assert.equal(prepareCatalogProjectionRows([input]).length,1);
 resetCatalogReadCachesForTests();prepareCatalogProjectionRows([input]);assert.ok(reads>checked);
});
test('a refreshed record is audited again and suspicious power cannot reappear through cached views',()=>{
 resetCatalogReadCachesForTests();
 const good=row();assert.equal(prepareCatalogProjectionRows([good])[0].powerHp,160);
 const rejected={...good,powerDataSource:'kcar_exact_detail_rvo_hrspow_hp',powerHp:34,powerKw:25,icePowerKw:25,utilizationPowerKw:25};
 const result=prepareCatalogProjectionRows([rejected]);assert.equal(result.length,1);
 assert.equal(result[0].powerHp,undefined);assert.equal(result[0].totalRub,null);assert.equal(result[0].sellerPriceRub,1800000);
 assert.equal(rejected.powerHp,34);assert.equal(good.totalRub,3000000);
 assert.equal(prepareCatalogProjectionRows([{...good,cardImageUrl:undefined}]).length,0);
});
test('parallel facets and market searches download one shared catalog snapshot',async(t)=>{
 resetCatalogReadCachesForTests();
 const reads:string[]=[];const input={...row(),bodyType:'sedan'};
 t.mock.method(getJsonStorage(),'readJsonWithMeta',async(file:string)=>{
  if(file==='catalog-editorial/current.json')return {found:false,value:{revision:'0',entries:{}}};
  reads.push(file);await new Promise(resolve=>setImmediate(resolve));
  if(file==='catalog/public/facets.json')return {found:false,value:{generationId:''}};
  if(file==='catalog/manifest.json')return {found:true,value:{generationId:'shared-test',markets:{korea:{count:1}}}};
  if(file==='catalog/public/projection/all.json')return {found:true,value:{generationId:'shared-test',items:[input]}};
  throw Error(`Unexpected duplicate storage read: ${file}`);
 });
 try {
  const [facets,result]=await Promise.all([readCatalogFacets({bodyType:'sedan'}),searchOffers({market:'korea',bodyType:'sedan'})]);
  assert.equal(result.total,1);assert.deepEqual(facets.makes,['Kia']);
  assert.deepEqual(reads.filter(path=>path.includes('/projection/')),['catalog/public/projection/all.json']);
 } finally {t.mock.restoreAll();resetCatalogReadCachesForTests();}
});


test('unchanged projections survive minute boundaries but follow the next published generation',async(t)=>{
 resetCatalogReadCachesForTests();
 let now=Date.now(),generationId='first';let projectionReads=0;
 t.mock.method(Date,'now',()=>now);
 t.mock.method(getJsonStorage(),'readJsonWithMeta',async(file:string)=>{
  if(file==='catalog-editorial/current.json')return {found:false,value:{revision:'0',entries:{}}};
  if(file==='catalog/public/facets.json')return {found:false,value:{generationId:''}};
  if(file==='catalog/manifest.json')return {found:true,value:{generationId,markets:{korea:{count:1}}}};
  if(file==='catalog/public/projection/korea.json'){
   projectionReads++;
   return {found:true,value:{generationId,items:[{...row(),id:generationId,make:generationId==='first'?'Kia':'Hyundai'}]}};
  }
  throw Error(`Unexpected read: ${file}`);
 });
 try {
  assert.deepEqual((await readCatalogFacets({market:'korea'})).makes,['Kia']);
  now+=61000;
  assert.deepEqual((await readCatalogFacets({market:'korea'})).makes,['Kia']);
  assert.equal(projectionReads,1,'same immutable snapshot must not be downloaded every minute');
  generationId='second';now+=61000;
  assert.deepEqual((await readCatalogFacets({market:'korea'})).makes,['Hyundai']);
  assert.equal(projectionReads,2,'new manifest must invalidate the previous snapshot immediately');
 } finally {t.mock.restoreAll();resetCatalogReadCachesForTests();}
});

test('large recommendation scans preserve results and yield to other requests',async()=>{
 const {filterCatalogProjectionRows,catalogSearchProjectionMatches}=await import('../apps/web/lib/catalog/storage');
 resetCatalogReadCachesForTests();
 const rows=Array.from({length:2048},(_,index)=>({...row(),id:`scan-${index}`,market:index%2?'china':'korea',model:index%3?'K5':'K50'}));
 const params={market:'korea',make:'Kia',model:'K5'};
 const expected=prepareCatalogProjectionRows(rows).filter(r=>catalogSearchProjectionMatches(r,params)).map(r=>r.id);
 let progressed=false;const pending=filterCatalogProjectionRows(rows,params);
 setImmediate(()=>{progressed=true;});
 const actual=await pending;
 assert.equal(progressed,true,'a large scan must not monopolize the event loop');
 assert.deepEqual(actual.map(r=>r.id),expected);
});
test('cached admission is rechecked after Krasnoyarsk midnight',t=>{
 resetCatalogReadCachesForTests();
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-12T16:59:59Z')});
 const input={...row(),year:2020,inventorySourceDate:'2020-10-12'};
 assert.equal(prepareCatalogProjectionRows([input]).length,1);
 t.mock.timers.tick(2000);
 assert.equal(prepareCatalogProjectionRows([input]).length,0);
});


test('brand searches reuse a warm full snapshot without downloading duplicate brand files',async(t)=>{
 resetCatalogReadCachesForTests();
 let generationId='shared-brands';let now=Date.now();const brandReads:string[]=[];
 t.mock.method(Date,'now',()=>now);
 t.mock.method(getJsonStorage(),'readJsonWithMeta',async(file:string)=>{
  if(file==='catalog-editorial/current.json')return {found:false,value:{revision:'0',entries:{}}};
  if(file==='catalog/manifest.json')return {found:true,value:{generationId,markets:{korea:{count:1}}}};
  if(file==='catalog/public/facets.json')return {found:false,value:{generationId:''}};
  if(file==='catalog/public/projection/all.json')return {found:true,value:{generationId,items:[{...row(),bodyType:'sedan'}]}};
  if(file.includes('/projection-brand/')) {
   brandReads.push(file);
   return {found:true,value:{generationId,items:[{...row(),id:'updated',bodyType:'sedan'}]}};
  }
  throw Error(`Unexpected read: ${file}`);
 });
 try {
  await readCatalogFacets({bodyType:'sedan'});
  const result=await searchOffers({make:'Kia',bodyType:'sedan'});
  assert.equal(result.total,1);assert.equal(result.items[0].id,'projection-reuse');
  assert.equal((await searchOffers({make:'Unknown',bodyType:'sedan'})).total,0);
  assert.deepEqual(brandReads,[]);
  generationId='next';now+=61000;
  const changed=await searchOffers({make:'Kia',bodyType:'sedan'});
  assert.equal(changed.items[0].id,'updated');assert.equal(brandReads.length,1);
 } finally {t.mock.restoreAll();resetCatalogReadCachesForTests();}
});

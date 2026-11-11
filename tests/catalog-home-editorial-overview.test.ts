import assert from 'node:assert/strict';
import test from 'node:test';
import {getJsonStorage} from '../apps/web/lib/data';
import {buildCatalogMarketLanding,buildCatalogOverviewFromProjections,readHomeCatalogSnapshot,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';
import {resetCatalogEditorialCache} from '../apps/web/lib/catalog/editorial';
import {applyEditorialOverview} from '../apps/web/lib/catalog/editorial-overview';

test('exact editorial overview avoids full market reads and revision changes restore correct cards and counts',async()=>{
 const storage=getJsonStorage(),read=storage.readJsonWithMeta;
 const generationId='editorial-overview',reads:string[]=[];
 const base:any={market:'korea',make:'Hyundai',model:'Avante',year:2024,totalRub:1500000,
  sourceId:'fixture',sourcePrice:1000000,sourceCurrency:'RUB',mileageKm:40000,engineCc:1598,powerHp:123,
  fuel:'petrol',powertrainKind:'combustion',transmission:'automatic',drive:'fwd',bodyType:'sedan',
  cardImageUrl:'https://example.com/car.jpg',images:[{url:'https://example.com/car.jpg'}],cardProjectionVersion:3,
  publicVisibleRub:1500000,publicSpecificationVerified:true,calculationStatus:'ready',updatedAt:'2026-11-11T00:00:00Z'};
 const rows=Array.from({length:3},(_,i)=>({...base,id:'fixture:'+i,sourceOfferId:String(i)}));
 let editorial:any={revision:'edit-a',entries:{[rows[0].id]:{id:rows[0].id,market:'korea',sourceId:'fixture',sourceOfferId:'0',status:'hidden'}}};
 let overview:any=null;
 let landing:any=null;
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  reads.push(key);let value:any;
  if(key==='catalog-editorial/current.json')value=editorial;
  else if(key==='catalog/manifest.json')value={generationId,markets:{korea:{count:3}}};
  else if(key.endsWith('/overview.json'))value=overview;
  else if(key.includes('/market-landing-v1/korea.json'))value=landing;
  else if(key.includes('/projection/'))value={generationId,items:rows};
  else if(key==='markets/markets.json')value=[{id:'korea',versions:[{id:'fixture',status:'active',securityDepositRub:0}]}];
  return {found:value!=null,value:(value==null?fallback:structuredClone(value)) as T};
 };
 const reset=()=>{resetCatalogEditorialCache();resetCatalogReadCachesForTests();reads.length=0;};
 try{
  reset();
  // Ordinary landing remains a source projection, outside the overview's
  // editorial context, so restoring the last hidden car can reuse it safely.
  landing=await buildCatalogMarketLanding(generationId,'korea',rows,{now:new Date()});
  assert.equal(landing.total,3);
  overview=await buildCatalogOverviewFromProjections(generationId,rows);
  assert.equal(overview.editorialRevision,'edit-a');
  assert.deepEqual(overview.editorialMarkets,['korea']);
  assert.equal(overview.markets.korea.sourceTotal,3);
  assert.equal(overview.markets.korea.total,2);
  assert.equal(overview.markets.korea.items.some((row:any)=>row.id===rows[0].id),false);
  reset();
  const home=await readHomeCatalogSnapshot(2),publicOverview=await applyEditorialOverview(overview);
  assert.equal(home.marketCounts.korea,2);
  assert.equal(publicOverview!.markets.korea.total,2);
  assert.equal(home.items.some(row=>row.id===rows[0].id),false);
  assert.equal(reads.some(path=>path.includes('/projection/')),false,'unchanged prepared revision must not replay full markets');
  // Restoring the last hidden car leaves no hidden entries. Revision mismatch
  // must still refresh the formerly edited market rather than retain count 2.
  editorial={revision:'edit-b',entries:{[rows[0].id]:{...editorial.entries[rows[0].id],status:'visible'}}};
  reset();
  const restored=await readHomeCatalogSnapshot(3);
  assert.equal(restored.marketCounts.korea,3);
  assert.ok(restored.items.some(row=>row.id===rows[0].id));
  assert.ok(reads.some(path=>path.includes('/market-landing-v1/')));
  assert.equal((await applyEditorialOverview(overview))!.markets.korea.total,3);
  // Removing the whole previous edit index must behave the same way.
  editorial={revision:'0',entries:{}};reset();
  assert.equal((await readHomeCatalogSnapshot(3)).marketCounts.korea,3);
  assert.equal((await applyEditorialOverview(overview))!.markets.korea.total,3);
  // A new hidden car after preparation is excluded immediately.
  editorial={revision:'edit-c',entries:{[rows[1].id]:{id:rows[1].id,market:'korea',sourceId:'fixture',sourceOfferId:'1',status:'hidden'}}};reset();
  const changed=await readHomeCatalogSnapshot(3);
  assert.equal(changed.marketCounts.korea,2);
  assert.equal(changed.items.some(row=>row.id===rows[1].id),false);
  assert.equal(overview.editorialRevision,'edit-a','runtime cannot mutate saved readiness');
  // Old overviews retain the existing moderation path until rebuilt.
  const legacy=structuredClone(overview);delete legacy.editorialRevision;delete legacy.editorialMarkets;
  reset();
  const legacyResult=await applyEditorialOverview(legacy);
  assert.equal(legacyResult!.markets.korea.total,2);
  assert.equal(legacyResult!.markets.korea.items.some(row=>row.id===rows[1].id),false);
  assert.ok(reads.some(path=>path.includes('/projection/')));
 }finally{storage.readJsonWithMeta=read;reset();}
});

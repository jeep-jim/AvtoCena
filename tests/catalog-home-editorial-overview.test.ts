import assert from 'node:assert/strict';
import test from 'node:test';
import {getJsonStorage} from '../apps/web/lib/data';
import {buildCatalogOverviewFromProjections,buildCatalogMarketLanding,buildEditorialOverviewSnapshot,
  readHomeCatalogSnapshot,searchOffers,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';
import {resetCatalogEditorialCache} from '../apps/web/lib/catalog/editorial';
import {applyEditorialOverview} from '../apps/web/lib/catalog/editorial-overview';
import {readCatalogOverview} from '../apps/web/lib/catalog/overview';
import {validEditorialOverviewSnapshot} from '../apps/web/lib/catalog/editorial-overview-snapshot';

test('separate editorial snapshot matches full moderated search order and leaves rollback raw overview unchanged',async()=>{
 const storage=getJsonStorage(),read=storage.readJsonWithMeta;
 const generationId='editorial-overview',reads:string[]=[];
 const base:any={market:'korea',year:2024,totalRub:1500000,
  sourceId:'fixture',sourcePrice:1000000,sourceCurrency:'RUB',mileageKm:40000,engineCc:1598,powerHp:123,
  fuel:'petrol',powertrainKind:'combustion',transmission:'automatic',drive:'fwd',bodyType:'sedan',
  cardImageUrl:'https://example.com/car.jpg',images:[{url:'https://example.com/car.jpg'}],cardProjectionVersion:3,
  publicVisibleRub:1500000,publicSpecificationVerified:true,calculationStatus:'ready'};
 const rows=Array.from({length:63},(_,i)=>({...base,id:'fixture:'+i,sourceOfferId:String(i),
  make:i<45?'Hyundai':i<54?'Kia':'Toyota',model:i<45?'Avante':i<54?'K5':'Camry',
  updatedAt:new Date(Date.UTC(2026,10,11,0,i)).toISOString(),totalRub:1500000+i*1000,publicVisibleRub:1500000+i*1000}));
 const entry=(i:number,status='hidden')=>({id:rows[i].id,market:'korea',sourceId:'fixture',sourceOfferId:String(i),status});
 let editorial:any={revision:'edit-a',entries:{[rows[0].id]:entry(0),[rows[62].id]:entry(62),
  [rows[2].id]:{...entry(2,'visible'),sellerPrice:{amount:2000000,currency:'RUB'}}}};
 let overview:any=null,landing:any=null,prepared:any=null;
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  reads.push(key);let value:any;
  if(key==='catalog-editorial/current.json')value=editorial;
  else if(key==='catalog/manifest.json')value={generationId,markets:{korea:{count:rows.length}}};
  else if(key.endsWith('/overview.json'))value=overview;
  else if(key.includes('/editorial-overview-v1'))value=prepared;
  else if(key.includes('/market-landing-v1/korea'))value=landing;
  else if(key.includes('/projection/'))value={generationId,items:rows};
  else if(key==='markets/markets.json')value=[{id:'korea',versions:[{id:'fixture',status:'active',securityDepositRub:0}]}];
  return {found:value!=null,value:(value==null?fallback:structuredClone(value)) as T};
 };
 const reset=()=>{resetCatalogEditorialCache();resetCatalogReadCachesForTests();reads.length=0;};
 const ids=(items:any[])=>items.map(row=>row.id);
 try{
  reset();
  landing=await buildCatalogMarketLanding(generationId,'korea',rows,{now:new Date()});
  overview=await buildCatalogOverviewFromProjections(generationId,rows);
  const original=JSON.stringify(overview);
  assert.equal(landing.total,63);assert.equal(overview.markets.korea.total,63);
  assert.equal('editorialRevision' in overview,false,'legacy raw format remains untouched');
  prepared=await buildEditorialOverviewSnapshot(generationId,rows);
  assert.equal(prepared.editorialRevision,'edit-a');assert.equal(prepared.markets.korea.total,61);
  assert.equal(prepared.markets.korea.items.length,48);assert.equal(JSON.stringify(overview),original);
  const expected10=await searchOffers({market:'korea',pageSize:10,sort:'updatedAt'});
  const expected24=await searchOffers({market:'korea',pageSize:24,sort:'updatedAt'});
  assert.deepEqual(ids(prepared.markets.korea.items.slice(0,24)),ids(expected24.items));
  assert.deepEqual(prepared.markets.korea.items.slice(0,24),expected24.items,'same source fields, price overlays and card shape');
  reset();
  const home=await readHomeCatalogSnapshot(10),publicOverview=await applyEditorialOverview(overview);
  assert.equal(home.marketCounts.korea,61);assert.equal(publicOverview!.markets.korea.total,61);
  assert.deepEqual(ids(home.items),ids(expected10.items));
  assert.deepEqual(ids(publicOverview!.markets.korea.items),ids(expected24.items));
  assert.equal(reads.some(path=>path.includes('/projection/')),false,'prepared exact revision must not replay markets');
  // Missing, old, foreign or incomplete snapshots keep the original moderated fallback.
  const good=structuredClone(prepared);
  for(const damage of [(v:any)=>{v.editorialRevision='other';},(v:any)=>{v.generationId='foreign';},
   (v:any)=>{v.policyDate='2000-01-01';},(v:any)=>{v.markets.korea.sourceTotal=62;},
   (v:any)=>{v.markets.korea.items.pop();},(v:any)=>{v.markets.korea.items[1]=v.markets.korea.items[0];}]){
   prepared=structuredClone(good);damage(prepared);reset();
   assert.deepEqual(ids((await readHomeCatalogSnapshot(10)).items),ids(expected10.items));
   assert.ok(reads.some(path=>path.includes('/projection/')));
  }
  prepared=null;reset();
  assert.deepEqual(ids((await applyEditorialOverview(overview))!.markets.korea.items),ids(expected24.items));
  prepared=good;
  // Restoring the last hidden rows or removing all edits bypasses this derivative.
  // readCatalogOverview is byte-identical to the accepted a182 reader.
  for(const state of [{revision:'edit-b',entries:{[rows[0].id]:entry(0,'visible'),[rows[62].id]:entry(62,'visible')}},{revision:'0',entries:{}}]){
   editorial=state;reset();
   const rollbackRaw=await readCatalogOverview(generationId);
   assert.equal(rollbackRaw!.markets.korea.total,63);
   assert.deepEqual(ids(rollbackRaw!.markets.korea.items),ids(overview.markets.korea.items));
   assert.equal((await readHomeCatalogSnapshot(10)).marketCounts.korea,63);
   assert.equal((await applyEditorialOverview(overview))!.markets.korea.total,63);
   assert.equal(reads.some(path=>path.includes('editorial-overview-v1')),false);
   assert.equal(JSON.stringify(overview),original);
  }
  editorial={revision:'edit-c',entries:{[rows[1].id]:entry(1)}};reset();
  const changed=await readHomeCatalogSnapshot(10);
  assert.equal(changed.marketCounts.korea,62);assert.ok(reads.some(path=>path.includes('/projection/')));
  assert.equal(validEditorialOverviewSnapshot(good,overview,'edit-c',good.policyDate),false);
 }finally{storage.readJsonWithMeta=read;reset();}
});

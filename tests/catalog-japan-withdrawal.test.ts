import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {publicationWithdrawn,retiredSourceUrl} from '../apps/web/lib/catalog/publication-policy';
import {collectionEnabled,collectionWorkflowEnabled,defaultCollectionControls,COLLECTION_SOURCES} from '../apps/web/lib/catalog/collection-controls-schema';
import {sourceUrl} from '../apps/web/lib/autocalc/source';
import {buildAiSitemapProjection,buildAiProductFeed,readAiSitemapProjection,readPublishedAiProductFeed} from '../apps/web/lib/ai-discovery';
import {getJsonStorage} from '../apps/web/lib/data';
import {readCatalogOverview,resetCatalogOverviewCache} from '../apps/web/lib/catalog/overview';
import {editorialHidden,resetCatalogEditorialCache} from '../apps/web/lib/catalog/editorial';
import {getOffer,getOfferFromCurrentShard,getOfferFromCurrentProjection,searchOffers,readCatalogBrandCounts,readHomeCatalogSnapshot,resetCatalogReadCachesForTests,buildCatalogBrandSummary} from '../apps/web/lib/catalog/storage';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
const base:any={market:'korea',make:'Hyundai',model:'Avante',year:2024,totalRub:1500000,sourceId:'fixture',sourceOfferId:'1',sourcePrice:1000000,sourceCurrency:'RUB',mileageKm:40000,engineCc:1598,powerHp:123,fuel:'petrol',powertrainKind:'combustion',transmission:'automatic',drive:'fwd',bodyType:'sedan',cardImageUrl:'https://example.com/car.jpg',images:[{url:'https://example.com/car.jpg'}],cardProjectionVersion:3,publicVisibleRub:1500000,publicSpecificationVerified:true,calculationStatus:'ready',status:'active',updatedAt:'2026-10-13T00:00:00Z'};
const rows=[{...base,id:'korean-retained'}, {...base,id:'a'.repeat(24),market:'japan',make:'Toyota',model:'Prius'}];
test('withdrawal is independent of collection switches and editorial overrides, retaining Green Corner only',()=>{
 for(const row of [rows[1],{id:'jptrade_123'},{id:'x',marketLabel:'Япония'},{id:'x',imageUrl:'https://jp1.pa-server.ru/x.jpg'}])assert.equal(publicationWithdrawn(row),true);
 assert.equal(publicationWithdrawn(rows[0]),false);
 assert.equal(publicationWithdrawn({id:'green-123',market:'japan',sourceId:'akebono_green_japan_open'}),false);
 assert.equal(publicationWithdrawn({id:'green-123',market:'japan',sourceId:'proauctions_japan_stat'}),true);
 assert.equal(editorialHidden(rows[1],{revision:'1',entries:{[rows[1].id]:{...rows[1],status:'visible'}}}),true);
 const controls=defaultCollectionControls();
 controls.sources.proauctions_japan_stat={enabled:true,enabledAt:null,disabledAt:null,changedBy:null};
 assert.equal(collectionEnabled(controls,'proauctions_japan_stat'),false);
 assert.equal(collectionWorkflowEnabled(controls,'japan'),false);
 assert.equal(collectionWorkflowEnabled(controls,'green'),true);
 assert.ok(!COLLECTION_SOURCES.some(s=>/proauctions|jptrade/.test(s.id)));
});
test('retired source hosts cannot be fetched by manual import; unrelated and stock URLs remain valid',()=>{
 for(const host of ['demo.pro-auctions.ru','pro-auctions.ru','jp42.pa-server.ru','jptrade.ru']){
  assert.equal(retiredSourceUrl(`https://${host}/x`),true);
  assert.throws(()=>sourceUrl(`https://${host}/x`),/больше не поддерживается/);
 }
 assert.equal(retiredSourceUrl('https://pro-auctions.ru.example.com/'),false);
 assert.equal(sourceUrl('https://akebono.world/').hostname,'akebono.world');
});
test('immutable old search, overview and detail records cannot republish withdrawn Japan',async()=>{
 const storage=getJsonStorage(),old=storage.readJsonWithMeta,generationId='withdrawal-fixture';
 const facets={generationId,makes:['Hyundai','Toyota'],models:[],markets:['korea','japan'],bodyTypes:[],fuels:[],transmissions:[],drives:[]};
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  let value:any;
  if(key==='catalog/manifest.json')value={generationId,markets:{korea:{count:1},japan:{count:1}},updatedAt:base.updatedAt};
  else if(key==='catalog/public/brand-summary.json')value=buildCatalogBrandSummary(generationId,rows);
  else if(key.includes('/projection/')||key.includes('/projection-brand/')||key.includes('/offers/'))value={generationId,items:rows};
  else if(key.endsWith('/budget-count-v2.json'))value=buildBudgetCountIndex(generationId,rows,new Map(rows.map(r=>[r.id,0])));
  else if(key.includes('/budget-cards-v2/'))value={generationId,items:rows};
  else if(key.endsWith('/overview.json'))value={version:1,publicPolicyVersion:2,generationId,policyDate:new Date(Date.now()+7*3600000).toISOString().slice(0,10),facets,markets:Object.fromEntries(['korea','japan','china','europe','uae','georgia'].map(m=>[m,{sourceTotal:rows.filter(r=>r.market===m).length,total:rows.filter(r=>r.market===m).length,items:rows.filter(r=>r.market===m)}]))};
  else if(key==='markets/markets.json')value=[{id:'korea',versions:[{id:'fixture',status:'active',securityDepositRub:0}]}];
  return {found:value!==undefined,value:(value??fallback) as T};
 };
 try{
  resetCatalogReadCachesForTests();resetCatalogEditorialCache();resetCatalogOverviewCache();
  for(const params of [{market:'japan'},{market:'japan',sort:'totalRub'},{sort:'year'},{make:'Toyota'}]){
   const result=await searchOffers(params);
   assert.ok(result.items.every(row=>row.market!=='japan'));
   if(params.market==='japan'||params.make==='Toyota')assert.equal(result.total,0);
  }
  for(const read of [getOffer,getOfferFromCurrentShard,getOfferFromCurrentProjection])assert.equal(await read(rows[1].id),null);
  const overview=await readCatalogOverview(generationId);assert.deepEqual(overview?.markets.japan.items,[]);assert.equal(overview?.markets.japan.total,0);assert.equal(overview?.markets.korea.total,1);
  const home=await readHomeCatalogSnapshot();assert.equal(home.total,1);assert.equal(home.marketCounts.japan,0);assert.ok(home.items.every(row=>row.market!=='japan'));
  const brands=await readCatalogBrandCounts();assert.equal(brands.counts.Hyundai,1);assert.ok(!brands.counts.Toyota);
 }finally{storage.readJsonWithMeta=old;resetCatalogReadCachesForTests();resetCatalogEditorialCache();resetCatalogOverviewCache();}
});
test('exports filter auctions and reject pre-withdrawal binary feeds',async()=>{
 const projection={generationId:'g',items:rows};
 assert.deepEqual(buildAiSitemapProjection(projection).items.map(r=>r.id),[rows[0].id]);
 assert.equal(buildAiProductFeed(projection).productCount,1);
 assert.ok(!gunzipSync(buildAiProductFeed(projection).data).toString().includes(rows[1].id));
 let binaryRead=false;
 const storage:any={readJson:async(path:string)=>path==='catalog/manifest.json'?{generationId:'g'}:{version:1,generationId:'g',objectPath:'catalog/public/feeds/openai-products.csv.gz',format:'google-compatible-csv-gzip'},binaryExists:async()=>{binaryRead=true;return true;}};
 assert.equal(await readPublishedAiProductFeed(storage),null);assert.equal(binaryRead,false);
});
test('legacy compact sitemap without market falls back to identity-bearing projection',async()=>{
 const storage:any={readJson:async(path:string,fallback:any)=>{
  if(path==='catalog/manifest.json')return {generationId:'withdrawal-sitemap'};
  if(path.endsWith('sitemap-projection.json'))return {generationId:'withdrawal-sitemap',items:rows.map(({market,...row})=>row)};
  if(path.includes('/projection/'))return {generationId:'withdrawal-sitemap',items:rows};
  return fallback;
 }};
 const result=await readAiSitemapProjection(storage);
 assert.ok(result);assert.ok(result.items.every(row=>row.market!=='japan'));
});

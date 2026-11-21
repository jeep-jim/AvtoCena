import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogInventoryAgeDecision} from '../apps/web/lib/catalog/inventory-admission';
import {catalogMinYearForMarket,isCatalogYearAllowed} from '../apps/web/lib/catalog/offer-quality';
import {ajesLot,ajesQuery} from '../apps/web/lib/catalog/ajes-query';
import {getJsonStorage} from '../apps/web/lib/data';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {
 buildCatalogBrandSummary,buildCatalogMarketLanding,catalogMarketLandingPath,
 countCatalogOffers,currentOfferShardName,getOfferWithoutEditorial,projectionCanRenderCard,
 readCatalogFacets,readCatalogModelNames,readPublicCatalogMarketCounts,resetCatalogReadCachesForTests,searchOffers,
} from '../apps/web/lib/catalog/storage';

const day='2026-11-21T04:00:00.000Z';
test('fixed inclusive model year applies to Europe and Korea starting at 2022 independently of exact manufacturing age',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date(day)});
 for(const market of ['korea','europe']){
  assert.equal(catalogMinYearForMarket(market),2022);
  assert.equal(isCatalogYearAllowed(2021,market),false);
  assert.equal(isCatalogYearAllowed(2022,market),true);
  assert.equal(catalogInventoryAgeDecision({market,year:2021,productionDate:'2023-08-01'}).eligible,false);
  assert.equal(catalogInventoryAgeDecision({market,year:2022,productionDate:'2021-11-15'}).eligible,true);
  assert.equal(catalogInventoryAgeDecision({market,year:2022},new Date('2029-01-01T04:00:00Z')).eligible,false);
  assert.equal(catalogInventoryAgeDecision({market,year:2022,productionDate:'2022-02-01'},new Date('2028-03-01T04:00:00Z')).eligible,false);
 }
 for(const market of ['china','japan','uae','georgia'])
   assert.equal(catalogInventoryAgeDecision({market,year:2021}).eligible,true);
});

test('separate AJES legacy Korea search/count and exact ID mapping retain boundary without enabling source',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date(day)});
 for(const aggregate of [undefined,'count','models','makes'] as const){
   const q=ajesQuery({table:'korea',yearFrom:2019,yearTo:2022,...(aggregate?{aggregate}:{})});
   assert.match('sql' in q?q.sql:'',/year>=2022/);
   assert.equal('empty' in q&&q.empty,false);
 }
 const q=ajesQuery({table:'korea',yearTo:2021});
 assert.equal('empty' in q&&q.empty,true);
 const base={ID:'local',MARKA_NAME:'Kia',MODEL_NAME:'K5',FINISH:'100',YEAR:'2021'};
 assert.equal(ajesLot(base,'korea',true),null);
 assert.equal(ajesLot({...base,YEAR:'2022'},'korea',true)?.year,2022);
 assert.equal(ajesLot({...base,STATUS:'Sold'},'stats',true)?.year,2021);
 assert.match(ajesQuery({table:'stats',aggregate:'count'}).sql,/year>=2008/);
 assert.match(ajesQuery({table:'china',aggregate:'count'}).sql,/year>=2014/);
});

const marketRows=(market:string)=>{
 const mk=(year:number,idx:number)=>({id:`${market}-local-${year}-${idx}`,market,make:year===2021?(market==='georgia'?'GeorgiaOld':'OnlyOld'):'Kia',model:year===2021?'Old':'K5',year,
  cardProjectionVersion:3,cardImageUrl:'https://example.test/car.jpg',fuel:'petrol',powertrainKind:'combustion',bodyType:'sedan',
  engineCc:1999,powerHp:160,powerKw:117.68,icePowerKw:117.68,utilizationPowerKw:117.68,status:'active',
  publicVisibleRub:3000000,publicSpecificationVerified:true,totalRub:3000000,sourcePrice:30000000,sourceCurrency:market==='korea'?'KRW':'EUR',
  sourceGroup:market==='korea'?'encar':'mobile_de_open',updatedAt:new Date(Date.UTC(2026,8,1,0,idx)).toISOString()});
 return [mk(2021,0),...Array.from({length:25},(_,i)=>mk(i%2?2023:2022,i+1))] as any[];
};
test('stale aggregate/compact selectors cannot overcount; real list/count/facets/active detail agree',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date(day)});
 const gen='gen_1795233600000_year2022test',storage=getJsonStorage();
 const rows=[...marketRows('korea'),...marketRows('europe'),...marketRows('georgia')];
 const before=JSON.stringify(rows);
 const reads:string[]=[];
 const manifest={version:2,generationId:gen,markets:Object.fromEntries(['korea','europe','georgia'].map(m=>[m,{count:26,chunks:['chunk-0001']}]))};
 const landings=new Map();
 for(const m of ['korea','europe','georgia']){
   const current=await buildCatalogMarketLanding(gen,m,rows.filter(x=>x.market===m));
   assert.equal(current.total,m==='georgia'?26:25);
   const {modelYearPolicy,...old}=current;
   // Retained object created under former same-day policy: even if all returned
   // cards pass, a truncated/unchecked old total must not be trusted.
   landings.set(catalogMarketLandingPath(gen,m),{...old,total:26,items:current.items});
 }
 const index=buildBudgetCountIndex(gen,rows);
 let useCompact=false;
 t.mock.method(storage,'readJsonWithMeta',async(file:string,fallback:any)=>{
  reads.push(file);
  const val=file==='catalog/manifest.json'?manifest
   : file==='catalog/public/brand-summary.json'?buildCatalogBrandSummary(gen,rows)
   : file==='catalog/public/facets.json'||file===`catalog/generations/${gen}/indexes/facets.json`?{
     generationId:gen,makes:['OnlyOld','GeorgiaOld','Kia'],models:[{make:'OnlyOld',model:'Old'},{make:'GeorgiaOld',model:'Old'},{make:'Kia',model:'K5'}],
     markets:['korea','europe','georgia'],bodyTypes:['sedan'],fuels:['petrol'],transmissions:[],drives:[]}
   : useCompact&&file===`catalog/generations/${gen}/indexes/budget-count-v2.json`?index
   : useCompact&&file===`catalog/generations/${gen}/indexes/budget-cards-v2/0.json`?{generationId:gen,items:rows}
   : landings.has(file)?landings.get(file)
   : file.includes('/projection/')?{generationId:gen,items:rows.filter(x=>file.endsWith('/all.json')||file.endsWith('/'+x.market+'.json'))}
   : file.startsWith('catalog/public/offers/')?{generationId:gen,items:rows.filter(x=>file.endsWith('/'+currentOfferShardName(x.id)+'.json'))}
   : fallback;
  return {found:val!==fallback,value:val};
 });
 let writes=0;
 t.mock.method(storage,'writeJson',async()=>{writes++;throw Error('forbidden_write');});
 for(const compact of [false,true]){
  useCompact=compact;reads.length=0;resetCatalogReadCachesForTests();
  for(const market of ['korea','europe'] as const){
    const older=rows.find(x=>x.market===market&&x.year===2021),good=rows.find(x=>x.market===market&&x.year===2022);
    assert.equal(projectionCanRenderCard(older),false);
    assert.equal(projectionCanRenderCard(good),true);
    const a=await searchOffers({market,page:1}),b=await searchOffers({market,page:2});
    assert.equal(a.total,25);assert.equal(b.total,25);
    if(compact)assert.ok(a.usedIndexShards.includes('budget-cards-v2/0.json'));
    assert.equal(a.items.length,24);assert.equal(b.items.length,1);
    assert.equal(new Set([...a.items,...b.items].map(x=>x.id)).size,25);
    assert.ok([...a.items,...b.items].every(x=>x.year>=2022&&x.totalRub===3000000));
    assert.equal((await countCatalogOffers({market})).total,25);
    assert.equal((await countCatalogOffers({market,yearTo:2021})).total,0);
    assert.equal((await countCatalogOffers({market,yearFrom:2022,yearTo:2022})).total,13);
    assert.equal((await readCatalogFacets({market})).makes.includes('OnlyOld'),false);
    assert.equal(await getOfferWithoutEditorial(older.id),null);
    assert.equal((await getOfferWithoutEditorial(good.id))?.year,2022);
  }
  for(const facets of [await readCatalogFacets({}),await readCatalogFacets({market:'any'})]){
   assert.ok(!facets.makes.includes('OnlyOld')&&facets.makes.includes('GeorgiaOld'));
  }
  for(const names of [await readCatalogModelNames(),await readCatalogModelNames('','korea|europe|georgia')]){
   assert.ok(!names.some(row=>row.make==='OnlyOld')&&names.some(row=>row.make==='GeorgiaOld'),JSON.stringify({compact,names}));
  }
  const totals=await readPublicCatalogMarketCounts();
  assert.equal(totals.markets.korea,25);assert.equal(totals.markets.europe,25);assert.equal(totals.markets.georgia,26);
  assert.equal((await countCatalogOffers({market:'georgia',yearTo:2021})).total,1);
 }
 assert.equal(writes,0);
 assert.equal(JSON.stringify(rows),before);
});

test('same-day historical market landing with 192 eligible sample cards cannot overcount a hidden old tail',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date(day)});
 resetCatalogReadCachesForTests();
 const gen='gen_1795233600000_old_landing',market='europe';
 const [older,first]=marketRows(market);
 const rows=[older,...Array.from({length:193},(_,i)=>({...first,id:`europe-local-2022-${i}`}))];
 const verified=await buildCatalogMarketLanding(gen,market,rows);
 assert.equal(verified.items.length,192);
 assert.equal(verified.sourceTotal,194);
 assert.equal(verified.total,193);
 const {modelYearPolicy,...previous}=verified;
 const manifest={version:2,generationId:gen,markets:{europe:{count:194,chunks:['chunk-0001']}}};
 const reads:string[]=[];
 let landing={...previous,total:194} as typeof verified;
 t.mock.method(getJsonStorage(),'readJsonWithMeta',async(file:string,fallback:any)=>{
   reads.push(file);
   const value=file==='catalog/manifest.json'?manifest
     :file===catalogMarketLandingPath(gen,market)?landing
     :file.endsWith('/projection/europe.json')?{generationId:gen,items:rows}:fallback;
   return {found:value!==fallback,value};
 });
 assert.equal((await searchOffers({market})).total,193);
 assert.ok(reads.some(file=>file.endsWith('/projection/europe.json')));
 landing=verified;resetCatalogReadCachesForTests();reads.length=0;
 assert.equal((await searchOffers({market})).total,193);
 assert.ok(!reads.some(file=>file.endsWith('/projection/europe.json')));
 assert.equal(modelYearPolicy,'korea-europe-min-model-year-2022-v1');
});

test('old global order fallback touches only affected eligibility partitions and preserves untouched order',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date(day)});
 const gen='gen_1795233600000_global_fallback';
 const [oldK,goodK]=marketRows('korea'),[oldG,goodG]=marketRows('georgia');
 const reads:string[]=[];
 let listings=[oldK,goodK,oldG,goodG];
 let manifest={version:2,generationId:gen,markets:{korea:{count:2,chunks:['all']},georgia:{count:2,chunks:['first','never']}}};
 t.mock.method(getJsonStorage(),'readJsonWithMeta',async(file:string,fallback:any)=>{
   reads.push(file);
   const value=file==='catalog/manifest.json'?manifest
     :file.endsWith('/projection/korea.json')?{generationId:gen,items:listings.filter(row=>row.market==='korea')}
     :file.endsWith('/offers-by-id.json')?{byId:Object.fromEntries(listings.map(row=>[row.id,{market:row.market,chunk:row.market==='korea'?'all':'first'}]))}
     :file.endsWith('/order-updatedAt.json')?{ids:listings.map(row=>row.id)}
     :file.endsWith('/offers/georgia/first.json')?[oldG,goodG]
     :fallback;
   return {found:value!==fallback,value};
 });
 resetCatalogReadCachesForTests();
 const withKorea=await searchOffers({market:'any',pageSize:1});
 assert.equal(withKorea.total,3);
 assert.equal(withKorea.items[0].id,goodK.id);
 assert.ok(!reads.some(file=>file.includes('/offers/georgia/')));
 listings=[oldG,goodG];
 manifest={...manifest,markets:{...manifest.markets,korea:{count:0,chunks:[]}}};
 resetCatalogReadCachesForTests();reads.length=0;
 const georgiaOnly=await searchOffers({market:'any',pageSize:1});
 assert.equal(georgiaOnly.total,2);
 assert.ok(reads.some(file=>file.endsWith("/offers/georgia/first.json")));
 assert.ok(!reads.some(file=>file.endsWith('/offers/georgia/never.json')));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createAjesClient,AjesUnavailable} from '../apps/web/lib/catalog/ajes-client';
import {reserveAjesRequest} from '../apps/web/lib/catalog/ajes-quota';
import {retiredAjesOffer} from '../apps/web/lib/catalog/ajes-access-policy';

const require=createRequire(import.meta.url);
async function fixture(entry:string,stubs:Record<string,string>={}){
 const mocks={'server-only':'',...stubs};
 const built=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'japan-only-fixture',setup(b){
  b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'fixture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}));
 }}]});
 const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);return mod.exports;
}

test('all retired AJ query kinds fail before settings, credentials, caches, quota, diagnostics or provider access',async()=>{
 const touched:string[]=[];
 const forbidden=(name:string)=>(..._args:any[])=>{touched.push(name);throw Error('unexpected '+name);};
 const deps:any=Object.fromEntries(['calculationIndex','password','assertEnabled','reserve','fetcher','endpoint','readQuery','readLegacyQuery','readDetail','readSavedSearch','readListedDetail','saveQuery','saveDetail','saveEvidence','saveAggregateEvidence','saveRequestFailure'].map(name=>[name,forbidden(name)]));
 const client=createAjesClient(deps);
 for(const table of ['china','korea'])for(const query of [{},{page:2},{aggregate:'count'},{aggregate:'makes'},{aggregate:'models',make:'TOYOTA'},{aggregate:'colors'},{id:'saved-detail'}]){
  await assert.rejects(client.read({table,...query},'203.0.113.1'),e=>e instanceof AjesUnavailable&&e.reason==='market_not_supported');
 }
 // Missing IP cannot accidentally select an earlier cache path for a retired market.
 await assert.rejects(client.read({table:'korea',id:'saved-detail'},''),/market_not_supported/);
 assert.deepEqual(touched,[]);
});

test('retired quota calls leave stored historical usage untouched',async()=>{
 let reads=0,writes=0;
 const storage={readJsonWithMeta:async()=>{reads++;throw Error('unexpected');},writeJson:async()=>{writes++;throw Error('unexpected');}} as any;
 for(const table of ['china','korea'] as const)await assert.rejects(reserveAjesRequest(storage,table as any),/market_not_supported/);
 assert.equal(reads,0);assert.equal(writes,0);
});

test('old AJ source selections cannot activate China, Korea or UAE, even without a paid snapshot',async()=>{
 const {usesAjesMarket}=await fixture('apps/web/lib/catalog/ajes-market-selection.ts',{
  './storage':'export const hasPublishedPaidEncar=()=>{throw Error("must not consult storage");};',
  './collection-controls':'export const assertCollectionEnabled=()=>{throw Error("must not consult settings");};',
 });
 for(const market of ['china','korea','uae','europe','georgia',undefined])for(const source of [undefined,'ajes','existing'])assert.equal(await usesAjesMarket(market,source),false);
 for(const source of [undefined,'ajes','existing'])assert.equal(await usesAjesMarket('japan',source),true);
});

test('retired AJ search returns 410 before all dependencies; Japanese search and green stock keep their paths',async()=>{
 const touched:Array<{name:string;args:any[]}>=[];
 (globalThis as any).__ajSearchRetirement={
  touch:(name:string,...args:any[])=>{touched.push({name,args});},
  forbidden:(name:string)=>{touched.push({name,args:[]});throw Error('unexpected '+name);},
 };
 const forbidden=(...names:string[])=>names.map(name=>`export const ${name}=()=>globalThis.__ajSearchRetirement.forbidden('${name}');`).join('\n');
 try{
  const api=await fixture('apps/web/app/(public)/api/catalog/search/route.ts',{
   'next/server':'export const NextResponse={json:(body,init)=>Response.json(body,init)};',
   '@/lib/catalog/china-public-aggregate':forbidden('omitLegacyChinaAggregate','withChinaAggregateAuthority'),
   '@/lib/catalog/mixed-market-count':forbidden('readMixedMarketCounts'),
   '@/lib/catalog/china-regcloud-object-reader':forbidden('chinaRegcloudRuntimeConfigured'),
   '@/lib/catalog/market-selection':`export const selectedCatalogMarkets=market=>{globalThis.__ajSearchRetirement.touch('selectedCatalogMarkets',market);if(market!=='japan')throw Error('unexpected market');return ['japan'];};`+forbidden('marketSelectionUrl'),
   '@/lib/catalog/green-corner':forbidden('readGreenCorner','readGreenCornerPage'),
   '@/app/api/catalog/green/route':`export const GET=async request=>{globalThis.__ajSearchRetirement.touch('greenSearch',request.url);return Response.json({ok:true,items:[{id:'green-unchanged'}]});};`,
   '@/lib/catalog/ajes-count-display':`export const exactAjesCount=summary=>summary.total;`,
   '@/lib/catalog/ajes-market-selection':`export const usesAjesMarket=async(market,source)=>{globalThis.__ajSearchRetirement.touch('usesAjesMarket',market,source);return market==='japan';};`,
   '@/lib/catalog/ajes-error-response':forbidden('ajesErrorResponse'),
   '@/lib/catalog/ajes-catalog':`export const readAjesCatalogPage=async params=>{globalThis.__ajSearchRetirement.touch('readAjesCatalogPage',params);return {total:1,items:[{id:'ajes-stats-unchanged',market:'japan'}]};};export const readAjesCountSummary=async key=>{globalThis.__ajSearchRetirement.touch('readAjesCountSummary',JSON.parse(key));return {total:12,stale:false,upperBound:false};};`+forbidden('withAjesCount'),
   '@/lib/catalog/market-page':forbidden('readCatalogMarketPage'),
   '@/lib/catalog/runtime-config':`export const PUBLIC_CATALOG_MARKET_SET=new Set(['china','korea','japan','uae','europe','georgia']);`,
   '@/lib/catalog/engine-input':forbidden('parseEngineCc'),
   '@/lib/catalog/live-business-pricing':forbidden('applyActiveBusinessPricingBatch'),
   '@/lib/catalog/public-rates':forbidden('loadPublicRateExtras'),
   '@/lib/catalog/storage':forbidden('countCatalogOffers','readCatalogFacets','searchOffers','projectPreparedChinaFixtureSearch'),
   '@/lib/catalog/prepared-china-http-fixture':'export class PreparedChinaCutChanged extends Error{};'+forbidden('hasPreparedChinaHttpFixture','preparedChinaIndexedModelOnly','readPreparedChinaFixtureList','readPreparedChinaIndexedModel','readPreparedChinaIndexedCity','readPreparedChinaCompatibility','hasIndependentChinaHttpFixture'),
  });
  for(const market of ['china','korea','uae','europe','georgia','any','unknown','','japan,korea','japan|china',undefined]){
   for(const extra of ['', '&countOnly=1&includeFacets=1&includeRates=1', '&marketPage=1&page=2&powerTo=160', '&stock=green']){
    const params=new URLSearchParams({source:'ajes'});if(market!==undefined)params.set('market',market);
    const response=await api.GET(new Request('https://fixture.test/api/catalog/search?'+params+extra));
    assert.equal(response.status,410,`${market}${extra}`);assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.deepEqual(await response.json(),{ok:false,error:'source_retired'});
    assert.deepEqual(touched,[],'must return before selection, AJ, prepared or ordinary catalog, count, facets and pricing');
   }
  }
  for(const source of [undefined,'ajes','existing']){
   touched.length=0;const params=new URLSearchParams({market:'japan',make:'Toyota',powerTo:'160',page:'2'});if(source)params.set('source',source);
   const response=await api.GET(new Request('https://fixture.test/api/catalog/search?'+params));
   assert.equal(response.status,200);assert.equal((await response.json()).items[0].id,'ajes-stats-unchanged');
   assert.equal(response.headers.get('Cache-Control'),'private, max-age=15, stale-while-revalidate=30');
   assert.deepEqual(touched.map(x=>x.name),['selectedCatalogMarkets','usesAjesMarket','readAjesCatalogPage']);
   assert.deepEqual(touched.at(-1)!.args[0],Object.fromEntries(params));
  }
  touched.length=0;
  const count=await api.GET(new Request('https://fixture.test/api/catalog/search?market=japan&source=ajes&countOnly=1'));
  assert.equal(count.status,200);assert.equal((await count.json()).total,12);
  assert.deepEqual(touched.map(x=>x.name),['selectedCatalogMarkets','usesAjesMarket','readAjesCountSummary']);
  touched.length=0;
  const green=await api.GET(new Request('https://fixture.test/api/catalog/search?market=japan&source=ajes&stock=green'));
  assert.equal(green.status,200);assert.equal((await green.json()).items[0].id,'green-unchanged');
  assert.deepEqual(touched.map(x=>x.name),['selectedCatalogMarkets','greenSearch']);
 }finally{delete (globalThis as any).__ajSearchRetirement;}
});

test('public direct AJ IDs and retired queries stop before saved details, rates or request headers',async()=>{
 const api=await fixture('apps/web/lib/catalog/ajes-public.ts',{
  './ajes-runtime':'export const ajesClient={read:()=>{throw Error("must not read supplier");}};',
  'next/headers':'export const headers=()=>{throw Error("must not read headers");};',
  './rates':'export const convertToRub=()=>{throw Error("must not read rates");};',
  './editorial':'export const applyCatalogEditorial=()=>{};export const editorialHidden=()=>{};export const readCatalogEditorial=()=>{throw Error("must not read editorial");};',
  './japan-owner-specifications':'export const applyJapanOwnerSpecifications=x=>x;',
  './japan-drive':'export const enrichJapanDrive=x=>x;export const japanDriveSql=()=>"";',
  '../encyclopedia/japan-fuel-reference':'export const applyJapanFactoryFuel=x=>x;',
  '../encyclopedia/calculation-index':'export const applyEncyclopediaCalculation=x=>x;export const readCalculationIndex=()=>null;',
 });
 for(const table of ['china','korea']){
  for(const query of [{table},{table,id:'old-car'},{table,aggregate:'count'}])await assert.rejects(api.readAjesPublic(query),/market_not_supported/);
  assert.equal(await api.getAjesOffer('ajes-'+table+'-old-car'),null);
 }
});

test('AJ catalog counts, facets and pages reject non-Japan before shortcuts or directory reads',async()=>{
 const api=await fixture('apps/web/lib/catalog/ajes-catalog.ts',{
  'react':'export const cache=x=>x;',
  'next/headers':'export const headers=()=>{throw Error("unexpected headers");};',
  './ajes-runtime':'export const ajesClient={read:()=>{throw Error("unexpected supplier");}};',
  './ajes-public':'const fail=()=>{throw Error("unexpected public source");};export const readAjesPublic=fail,cappedAjesQuery=fail;',
  './ajes-query':'export const ajesCatalogQuery=()=>{throw Error("unexpected query");};export class AjesFilterUnavailable extends Error{};export class AjesInputError extends Error{};',
  './ajes-client':'export const readAjesModelDirectory=()=>{throw Error("unexpected models");};export const readAjesMakeDirectory=()=>{throw Error("unexpected makes");};export class AjesUnavailable extends Error{};',
  './ajes-result-filter':'export const ajesResultFilter=()=>{throw Error("unexpected filter");};',
  './storage':'export const publicOffer=x=>x;',
  './market-page':'export const sortCatalogRows=x=>x;',
  './live-business-pricing':'export const applyActiveBusinessPricingBatch=async x=>x;',
  './collection-controls':'export const assertCollectionEnabled=()=>{throw Error("unexpected owner setting");};',
  './japan-preview-parameters':'export const japanPreviewParameters=()=>null;',
  './rates':'export const convertToRub=()=>{throw Error("unexpected rates");};',
  './editorial':'export const readCatalogEditorial=()=>{throw Error("unexpected editorial");};',
  './saved-calculation-previews':'export const hasSavedPreviewEntriesForMarket=()=>{throw Error("unexpected saved prices");};',
  '../encyclopedia/calculation-evidence':'export const hasEncyclopediaCalculationEvidence=()=>false;',
 });
 for(const market of ['china','korea','uae']){
  const params={market,powerTo:'160',make:'Toyota'};
  for(const call of [()=>api.readAjesCountSummary(JSON.stringify(params)),()=>api.readAjesMakes(JSON.stringify(params)),()=>api.readAjesDirectory(params),()=>api.readAjesCatalogPage(params)])await assert.rejects(call(),/market_not_supported/);
 }
});

test('detail, metadata and recommendations cannot revive retired AJ IDs from shared caches',async()=>{
 const api=await fixture('apps/web/lib/catalog/offer-page-data.ts',{
  'react':'export const cache=x=>x;',
  'next/cache':'export const unstable_cache=fn=>fn;',
  './management-knowledge':'export const attachManagementKnowledge=()=>{throw Error("must not read knowledge");};',
  './collection-controls':'export class CollectionDisabledError extends Error{};',
  './editorial':'export const applyCatalogEditorial=()=>{};export const editorialHidden=()=>{};export const readCatalogEditorial=()=>{throw Error("must not read editorial");};',
  './storage':'const fail=()=>{throw Error("must not read stored offer");};export const getOfferWithoutEditorial=fail,getOfferFromCurrentShard=fail,getOfferFromCurrentProjection=fail,isJapanCatalogOfferId=fail;',
 });
 for(const id of ['ajes-china-old-car','ajes-korea-old-car']){
  assert.equal(await api.getOfferForPage(id),null);
  assert.equal(await api.getOfferDetailRecord(id),null);
  assert.deepEqual(await api.readOfferDetailForPage(id),{offer:null,unavailable:false});
 }
 assert.equal(retiredAjesOffer('nonstandard-id','ajes_korea_feed'),true);
 assert.equal(retiredAjesOffer('paid-offer','encar_direct'),false);
 assert.equal(retiredAjesOffer('ajes-stats-auction','ajes_japan_feed'),false);
});

test('retired Korea AJ report URL returns a private 410 without supplier dependencies',async()=>{
 const api=await fixture('apps/web/app/api/catalog/korea-report/route.ts',{
  'next/server':'export const NextResponse={json:(body,init)=>Response.json(body,init)};',
 });
 const response=await api.GET(new Request('https://avtocena.com/api/catalog/korea-report?id=ajes-korea-old-car&lot=42084912&kind=insurance'));
 assert.equal(response.status,410);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 assert.deepEqual(await response.json(),{error:'source_retired'});
});

test('old non-Japan source-model URLs retire before any directory request',async()=>{
 const api=await fixture('apps/web/app/api/catalog/source-models/route.ts',{
  'next/server':'export const NextResponse={json:(body,init)=>Response.json(body,init)};',
  '@/lib/catalog/ajes-catalog':'export const readAjesDirectory=()=>{throw Error("must not read directory");};',
 });
 for(const market of ['china','korea']){
  const response=await api.GET(new Request('https://avtocena.com/api/catalog/source-models?market='+market+'&make=Toyota'));
  assert.equal(response.status,410);assert.deepEqual(await response.json(),{error:'source_retired'});
 }
});

test('Korea recommendations and market count use the published catalog instead of AJ',async()=>{
 const seen:any[]=[];(globalThis as any).__ajRetiredRecommendations=seen;
 try{
  const api=await fixture('apps/web/app/api/catalog/recommendations/data.ts',{
   '@/lib/catalog/offer-page-data':'export const getOfferDetailRecord=async()=>({id:"paid-kia",market:"korea",make:"Kia",model:"Morning"});',
   '@/lib/catalog/storage':'export const publicOffer=x=>x;export const getUnavailableOffer=async()=>null;export const searchOffers=async q=>{globalThis.__ajRetiredRecommendations.push(q);return {items:[{id:"other-kia",market:"korea",make:"Kia",model:"Morning"}],total:46};};',
   '@/lib/catalog/ajes-public':'export const readAjesPublic=()=>{throw Error("must not use AJ");};',
   '@/lib/catalog/ajes-catalog':'export const readAjesCount=()=>{throw Error("must not count AJ");};',
   '@/lib/catalog/related-model-family':'export const readRelatedModelFamily=async()=>"Morning";',
   '@/lib/catalog/related-offer-selection':'export const isRenderableRelatedOffer=()=>true;export const selectRelatedOfferGroups=async p=>({stockModels:[],sameModel:p.modelRows,marketRows:p.marketRows,crossMarketGroups:[]});',
   '@/lib/catalog/green-corner':'export const readGreenCorner=()=>{throw Error("unselected Japan");};export const publicGreenOffer=x=>x;',
   '@/lib/catalog/green-corner-search':'export const filterGreenCorner=x=>x;',
   '@/lib/catalog/green-corner-contract':'export const isGreenCornerOffer=()=>false;',
   '@/lib/catalog/live-business-pricing':'export const applyActiveBusinessPricingBatch=async x=>x;',
   '@/lib/catalog/price-candidates':'export const priceCandidatesUntil=async x=>x;',
   '@/lib/catalog/presentation':'export const presentCatalogOffer=x=>x;',
   '@/lib/catalog/runtime-config':'export const PUBLIC_CATALOG_MARKETS=["korea","japan","china"];',
  });
  const result=await api.loadRelatedRecommendations({id:'paid-kia',markets:['korea']});
  assert.equal(seen.length,2);assert.ok(seen.every(q=>q.market==='korea'));
  assert.equal(result.partial,false);assert.equal(result.marketTotal,46);
  assert.equal(result.sameModel[0].id,'other-kia');assert.equal(result.marketRows[0].id,'other-kia');
 }finally{delete (globalThis as any).__ajRetiredRecommendations;}
});

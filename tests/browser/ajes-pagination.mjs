import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/ajes-pagination';fs.mkdirSync(out,{recursive:true});
// Next replaces public browser environment references in production.
// The isolated bundle receives an empty environment and no runner variables.
await build({entryPoints:['tests/browser/ajes-pagination-fixture.tsx'],bundle:true,format:'iife',jsx:'automatic',define:{'process.env':'{}','process.env.NODE_ENV':'"development"'},tsconfig:'apps/web/tsconfig.json',outfile:`${out}/app.js`,plugins:[{name:'stubs',setup(b){
 b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'nav'}));
 b.onLoad({filter:/.*/,namespace:'nav'},()=>({contents:"export const usePathname=()=>'/cars';export const useSearchParams=()=>new URLSearchParams();export const useRouter=()=>({prefetch(){},push(href){location.href=href;}});"}));
 b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'stub'}));
 b.onLoad({filter:/link/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link({prefetch,children,...props}){return React.createElement('a',props,children)}",resolveDir:process.cwd()}));
 b.onResolve({filter:/(?:catalog|green-corner)-load-more-action$/},()=>({path:'action',namespace:'stub'}));
 b.onLoad({filter:/action/,namespace:'stub'},()=>({resolveDir:process.cwd(),contents:`import {loadMoreCatalog as actual,JapanCatalogRefreshRequired} from ${JSON.stringify(path.resolve('apps/web/components/catalog/catalog-load-more-action.tsx'))};export {JapanCatalogRefreshRequired};export async function loadMoreCatalog(query,page,after){window.calls=(window.calls||[]).concat([{query,page,after}]);if(query.fixture==='refill')return actual(query,page,after);return {page,total:null,ids:Array(24).fill('car'),cards:'Следующие 24 автомобиля',hasMore:page<3,nextCursor:query.market==='china'?(page===2?'12.16':null):undefined}};export const loadMoreGreenCorner=loadMoreCatalog;`}));
 b.onResolve({filter:/\.css$/},()=>({path:'css',namespace:'fixture-css'}));
 b.onLoad({filter:/.*/,namespace:'fixture-css'},()=>({contents:'export default {};'}));
}}]});
// Actual Japanese catalog caller/helper and server component, with only local
// source/pricing/metadata transports. No provider or production request is made.
class FixtureUnavailable extends Error {constructor(reason){super(reason);this.reason=reason;}}
const fixture={queries:[],counts:0,sequence:0,mode:'normal',changed:false,editorialRevision:'fixture-1',snapshot:null,Unavailable:FixtureUnavailable,
 read:async(query,options={})=>{
  fixture.queries.push({...query});
  if(options.evidenceSnapshot){
   assert.equal(options.evidenceSnapshot,fixture.snapshot,'all source pages in one visitor read use one evidence snapshot');
   assert(Object.isFrozen(options.evidenceSnapshot));
  }
  assert.equal(query.pageSize,24,'every local source read preserves the 24-row provider contract');
  const sourceReceipt={version:1,requestId:'12345678-1234-4234-8234-'+String(++fixture.sequence).padStart(12,'0'),
   queryHash:createHash('sha256').update(JSON.stringify(query)).digest('hex'),table:'stats',kind:'list',page:query.page,pageSize:24,
   startedAt:'2026-11-26T10:00:00.000Z',finishedAt:'2026-11-26T10:00:00.001Z',stage:'supplier',supplierAttempted:true,
   outcome:'fresh',observedAt:'2026-11-26T10:00:00.000Z'};
  if(fixture.mode==='failure'&&query.page===2)throw Object.assign(new FixtureUnavailable('request_timeout'),
   {sourceReceipt:{...sourceReceipt,outcome:'unavailable',reason:'request_timeout'}});
  const emptyKnown=fixture.mode==='empty-known';
  const count=emptyKnown?(query.page<=9?24:0):query.page===1?23:query.page===2?24:query.page===3?2:0;
  const items=Array.from({length:count},(_,index)=>{
   const i=fixture.changed&&query.page===2?count-1-index:index,id='ajes-stats-refill-'+query.page+'-'+i;
   const localUpdated=options.evidenceSnapshot?.editorial.revision==='fixture-2'&&query.page===1&&i===0;
   return {id,sourceId:'ajes_japan_feed',sourceOfferId:'refill-'+query.page+'-'+i,market:'japan',
    offerType:'auction',status:'sold',catalogKind:'auction_result',auctionResult:'sold',auctionPriceKind:'hammer',
    make:'TOYOTA',model:'TEST',year:2022,mileageKm:50000,engineCc:1500,fuel:'petrol',drive:'fwd',bodyType:'hatchback',
    sourcePrice:500000,sourceCurrency:'JPY',priceMode:'auction_start',catalogPricingMode:'seller',sellerPriceRub:300000,
    calculationSnapshot:{currencyRate:{currency:'JPY',sourcePrice:500000,effectiveRate:0.6,rateSource:'cbr',rateDate:'2026-11-26',sourcePriceRub:300000}},
    totalRub:null,calculationStatus:'needs_data',images:[],firstSeenAt:'2026-11-26T10:00:00.000Z',updatedAt:'2026-11-26T10:00:00.000Z',
    ...(localUpdated?{powerHp:150,powerDataSource:'manual',powerDataConfidence:'verified',publicSpecificationVerified:true}:(emptyKnown?query.page===9:i%3)
     ?{japanSupplierPower:{offerId:id,hp:150,unit:'hp',source:'ajes_pw'}}:{japanPowerUnknown:true}),
    operational:{semanticEvidence:{
     engineCc:{status:'exact',value:1500,source:'ajes:stats:refill-'+query.page+'-'+i+':ENG_V',rawValues:['1500']},
     fuel:{status:'exact',value:'petrol',source:'ajes:stats:refill-'+query.page+'-'+i+':TIME',rawValues:['P']},
    }}};
  });
  return {items,page:query.page,pageSize:24,received:emptyKnown?count:query.page<3?24:count,partial:false,stale:false,observedAt:'2026-11-26T10:00:00.000Z',sourceReceipt};
 }};
globalThis.__japanRefillFixture=fixture;
const serverStubs={
 'server-only':'',
 'next/headers':"export const headers=async()=>new Map([['x-real-ip','127.0.0.1']]);export const cookies=()=>{throw Error('unexpected_cookies_in_japan_fixture');};",
 './ajes-runtime':"export const ajesClient={read:async()=>{globalThis.__japanRefillFixture.counts++;throw Error('unexpected aggregate');}};",
 './ajes-public':"export const cappedAjesQuery=async q=>q;export const readAjesPublic=(q,options)=>globalThis.__japanRefillFixture.read(q,options);export const readAjesPublicEvidenceSnapshot=async()=>{const fixture=globalThis.__japanRefillFixture;if(fixture.snapshot?.editorial.revision!==fixture.editorialRevision)fixture.snapshot=Object.freeze({editorial:Object.freeze({revision:fixture.editorialRevision,entries:Object.freeze({})}),calculationIndex:null});return fixture.snapshot;};",
 './ajes-client':"export const readAjesModelDirectory=async()=>({models:[]});export const readAjesMakeDirectory=async()=>({makes:[]});export const AjesUnavailable=globalThis.__japanRefillFixture.Unavailable;",
 './storage':"export const publicOffer=x=>x;const unused=()=>{throw Error('unexpected_non_japan_fixture_dependency');};export const catalogMakeFilterValues=unused;export const catalogSearchProjectionMatches=unused;export const projectionCanRenderCard=unused;export const offerPath=unused;export const catalogSearchProjectionComparator=unused;export const facetsForPreparedChinaCompatibilityRows=unused;export const orderPreparedChinaCompatibilityRows=unused;export const compilePreparedChinaModelScope=unused;export const preparedChinaModelIndexedPrice=unused;export const compilePreparedChinaCompatibilityPredicate=unused;export const preparedChinaModelPublicItem=unused;export const selectPreparedChinaCompatibilityRows=unused;export const getOfferWithoutEditorial=unused;export const getOfferFromCurrentShard=unused;export const getOfferFromCurrentProjection=unused;export const isJapanCatalogOfferId=unused;export const catalogGenerationId=unused;",
 './market-page':"export const sortCatalogRows=x=>x;const unused=()=>{throw Error('unexpected_non_japan_fixture_dependency');};export const balanceBusinessRows=unused;export const businessOrder=unused;export const MARKET_DIVERSITY_WINDOW_PAGES=undefined;export const MARKET_PAGE_SIZE=undefined;",
 './live-business-pricing':"export const applyActiveBusinessPricingBatch=async rows=>rows;",
 './collection-controls':"export const assertCollectionEnabled=async()=>{};export class CollectionDisabledError extends Error{};",
 './japan-preview-parameters':"export const japanPreviewParameters=()=>{throw Error('not attested');};",
 '../encyclopedia/calculation-evidence':"export const hasEncyclopediaCalculationEvidence=()=>false;",
};
const uiStubs={
 CatalogSidebar:"import React from 'react';export const CatalogSidebar=p=>React.createElement('section',null,p.header,p.children);",
 CatalogLoadMore:"import React from 'react';export function CatalogLoadMore(p){globalThis.__japanRefillPageProps=p;return React.createElement('div',{id:'root'});}",
 DealerBrowsingContext:"import React from 'react';export const DealerLink=({children,...p})=>React.createElement('a',p,children);",
 CatalogSelectionContext:"export const CatalogResultCountUpdate=()=>null;",
};
for(const name of ['PublicHeader','CatalogCard','CatalogFilters','BrandLogoRail','JapanSectionTabs','CatalogMarketFlag','MarketResultCount','CatalogCountLabel'])uiStubs[name]='export const '+name+'=()=>null;';
// Exercise the real card admission and power labels at the JSON boundary.
// Only ancillary controls and browser contexts are inert during static render.
const cardStubs={
 CatalogSelectionContext:'export const useCatalogView=()=>"grid";export const useCatalogLoadedCount=()=>null;export const useCatalogResultCount=()=>null;export const CatalogResultCountUpdate=()=>null;',
 DealerBrowsingContext:'export const useDealerBrowsing=()=>null;',
 useSavedCalculationPreview:'export const useSavedCalculationPreview=()=>undefined;',
 FavoriteToggle:'export const FavoriteToggle=()=>null;',
 CatalogCover:'export const CatalogCover=()=>null;',
 CatalogPrice:'export const CatalogPrice=()=>null;',
 IntentPrefetchLink:'import React from "react";export const IntentPrefetchLink=({children,eager,...props})=>React.createElement("a",props,children);',
 'RecyclingPower.module.css':'export default {};',
};
await build({stdin:{contents:"import React from 'react';\nimport {renderToStaticMarkup} from 'react-dom/server';\nimport {AjesCatalog} from './apps/web/components/catalog/AjesCatalog';\nimport {CatalogCard as ActualCatalogCard} from './apps/web/components/catalog/CatalogCard';\nexport function renderCard(offer){return renderToStaticMarkup(React.createElement(ActualCatalogCard,{offer,compact:true,dense:true}));}\nimport {readAjesCatalogPage} from './apps/web/lib/catalog/ajes-catalog';\nexport {AjesInputError} from './apps/web/lib/catalog/ajes-query';\nexport {ajesErrorResponse} from './apps/web/lib/catalog/ajes-error-response';\nfunction withoutOptionalAsync(node){\n if(Array.isArray(node))return node.map(withoutOptionalAsync);\n if(!React.isValidElement(node))return node;\n if(typeof node.type==='function'&&node.type.constructor.name==='AsyncFunction')return null;\n const props={...node.props};\n for(const key of ['children','header','filters'])if(key in props)props[key]=withoutOptionalAsync(props[key]);\n return React.cloneElement(node,props);\n}\nexport async function render(params){\n globalThis.__japanRefillPageProps=undefined;\n const html=renderToStaticMarkup(withoutOptionalAsync(await AjesCatalog({params})));\n const {initialCards,...props}=globalThis.__japanRefillPageProps;\n return {html,initial:{props,items:initialCards.map(card=>card.props.offer)}};\n}\nexport const read=params=>readAjesCatalogPage(params,undefined,{includeCount:false});\n",resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'cjs',jsx:'automatic',tsconfig:'apps/web/tsconfig.json',define:{'process.env.AVTOCENA_RELEASE_SHA':JSON.stringify('1'.repeat(40))},outfile:out+'/server.cjs',external:['react','react/jsx-runtime','react-dom/server'],plugins:[{name:'local-japan-caller',setup(b){
 b.onResolve({filter:/.*/},args=>{
  const name=args.path.split('/').pop();
  if(args.importer.endsWith('/AjesCatalog.tsx')&&name in uiStubs)return {path:name,namespace:'japan-ui-fixture'};
  if(name in cardStubs)return {path:name,namespace:'japan-card-fixture'};
  if(args.path in serverStubs)return {path:args.path,namespace:'japan-source-fixture'};
 });
 b.onLoad({filter:/.*/,namespace:'japan-source-fixture'},args=>({contents:serverStubs[args.path]}));
 b.onLoad({filter:/.*/,namespace:'japan-ui-fixture'},args=>({contents:uiStubs[args.path],resolveDir:process.cwd()}));
 b.onLoad({filter:/.*/,namespace:'japan-card-fixture'},args=>({contents:cardStubs[args.path],resolveDir:process.cwd()}));
}}]});
// The standalone fixture uses installed React outside Next's server renderer.
// Adapt only request memoization, as the native caller fixtures do; the browser
// bundle and the actual catalog/filter/pagination modules stay unchanged.
const require=createRequire(import.meta.url),serverModule={exports:{}};
const react=require('react');
const fixtureRequire=id=>id==='react'?{...react,cache:fn=>fn}:require(id);
new Function('require','module','exports',fs.readFileSync(path.resolve(out+'/server.cjs'),'utf8'))(fixtureRequire,serverModule,serverModule.exports);
const actual=serverModule.exports;
const boundaryQuery={market:'japan',fixture:'refill',fuel:'petrol',city:'Новокузнецк',powerTo:'160'};
const boundaryFirst=await actual.render(boundaryQuery);
const boundaryNext=await actual.read({...boundaryQuery,page:'2',after:boundaryFirst.initial.props.initialNextCursor});
const boundarySamples=[boundaryFirst.initial.items.find(row=>row.japanSupplierPower),boundaryNext.items.find(row=>row.japanPowerUnknown)];
assert.equal(boundaryFirst.initial.items.length,boundaryFirst.initial.props.initialCount);
for(const [index,offer] of boundarySamples.entries()){
 assert(offer,'the card boundary must sample an actual known and unknown result');
 const transported=JSON.parse(JSON.stringify(offer));assert.equal(transported.id,offer.id);
 const html=actual.renderCard(offer);assert.equal(actual.renderCard(transported),html,'JSON transport preserves the actual rendered card');
 assert.equal((html.match(/<article\b/g)||[]).length,1,'a counted offer must render an actual card');
 assert(html.includes(offer.id));
 assert.match(html,index===0?/data-japan-supplier-power="true"/:/data-japan-power-unknown="true"/);
}
console.log('PAGINATION_FIXTURE_RENDER_BOUNDARY '+JSON.stringify({passed:true,rows:2,known:1,unknown:1,jsonTransport:true}));
fixture.queries.length=0;
const responses=[];
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://fixture');
 try{
  if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(out+'/app.js'));return;}
  if(url.pathname.startsWith('/api/')){
   res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
   if(url.pathname==='/api/catalog/search'&&url.searchParams.get('fixture')==='refill'){
    const params={...Object.fromEntries(url.searchParams),market:'japan'};
    try{const data=await actual.read(params);responses.push({query:params,data});res.end(JSON.stringify({ok:true,...data}));}
    catch(error){const mapped=actual.ajesErrorResponse(error);responses.push({query:params,status:mapped.status,data:mapped.body});res.statusCode=mapped.status;res.end(JSON.stringify(mapped.body));}
   }else res.end(JSON.stringify({ok:false}));
   return;
  }
  const params=Object.fromEntries(url.searchParams);
  if(params.fixture==='refill'){
   params.market='japan';
   fixture.mode=params.case==='failure'?'failure':params.case==='empty-known'?'empty-known':'normal';
   const value=await actual.render(params);
   res.setHeader('Content-Type','text/html; charset=utf-8');
   res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+value.html+'<script>window.__japanRefillInitial='+JSON.stringify(value.initial).replace(/</g,'\\u003c')+'</script><script src="/app.js"></script>');
   return;
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>');
 }catch(error){console.error('local_japan_fixture_failed',error);res.statusCode=500;res.end('fixture_failed');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
const report={version:2,kind:'japan-pagination24-browser-v2',passed:false,caseCount:0,widths:[390,1440],checks:{}};
let blockedExternal=0,activePage,activeWidth,fixturePhase='legacy_initial',activeErrors=[],activeConsole=[];
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});
  activePage=page;activeWidth=width;fixturePhase='legacy_initial';
  const errors=[],consoleErrors=[];activeErrors=errors;activeConsole=consoleErrors;
  page.on('pageerror',error=>{if(errors.length<8){const text=String(error.stack||error.message).slice(0,1600);errors.push(text);console.error('PAGINATION_FIXTURE_PAGEERROR '+JSON.stringify({width,phase:fixturePhase,message:text}));}});
  page.on('console',message=>{if(message.type()==='error'&&consoleErrors.length<8){const text=message.text().slice(0,1000);consoleErrors.push(text);console.error('PAGINATION_FIXTURE_CONSOLE '+JSON.stringify({width,phase:fixturePhase,message:text}));}});
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();blockedExternal++;return route.abort();});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const href=await page.getByRole('link',{name:'Страница 2',exact:true}).getAttribute('href');
  assert.equal(new URL(href,'http://local').searchParams.get('after'),'6.20');
  await page.getByRole('button',{name:'Показать ещё',exact:true}).click();
  await page.getByText('Показано 48',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>window.calls[0].after),'6.20');
  assert.equal(new URL(await page.getByRole('link',{name:'Страница 3',exact:true}).getAttribute('href'),'http://local').searchParams.get('after'),'12.16');
  assert.equal(new URL(await page.getByRole('link',{name:'Страница 2',exact:true}).getAttribute('href'),'http://local').searchParams.get('after'),'6.20');
  await page.getByRole('button',{name:'Показать ещё',exact:true}).click();
  await page.getByText('Вы посмотрели все доступные предложения').waitFor();
  assert.equal(await page.getByRole('button',{name:'Показать ещё',exact:true}).count(),0);
  assert.equal(await page.locator('[data-catalog-batch]').count(),3);
  assert.deepEqual(errors,[]);
  fixturePhase='legacy_europe';
  await page.goto(`http://127.0.0.1:${server.address().port}/?market=europe`);
  assert.ok(await page.getByRole('link',{name:'Страница 15',exact:true}).isVisible());
  assert.ok(!(await page.getByRole('link',{name:'Страница 2',exact:true}).getAttribute('href')).includes('after='));
  for(const market of ['korea','japan']){
   fixturePhase='legacy_late_'+market;
   await page.goto(`http://127.0.0.1:${server.address().port}/?market=${market}&late=1`);
   const total=market==='korea'?89027:615568,last=Math.ceil(total/24);
   assert.equal(await page.getByRole('link',{name:'Страница '+last,exact:true}).count(),0);
   await page.getByRole('button',{name:'Получить количество',exact:true}).click();
   await page.getByRole('link',{name:'Страница '+last,exact:true}).waitFor();
   for(const n of [1,2,3,4,5,last])assert.equal(await page.getByRole('link',{name:'Страница '+n,exact:true}).count(),1);
   const href=new URL(await page.getByRole('link',{name:'Страница 3',exact:true}).getAttribute('href'),'http://local');
   assert.equal(href.searchParams.get('city'),'Новокузнецк');assert.equal(href.searchParams.get('after'),null);
   await page.getByRole('button',{name:'Показать ещё',exact:true}).click();
   await page.getByText('Показано 48',{exact:false}).waitFor();
   assert.equal(await page.getByRole('link',{name:'Страница '+last,exact:true}).count(),1,'unknown append total must preserve the independently resolved aggregate');
   assert.equal(await page.getByText('Количество уточняется',{exact:true}).count(),0);
   await page.getByRole('button',{name:'Показать ещё',exact:true}).click();
   await page.getByText('Показано 72',{exact:false}).waitFor();
   assert.deepEqual(await page.evaluate(()=>window.calls.map(x=>x.page)),[2,3]);
   await page.getByRole('button',{name:'Другой фильтр',exact:true}).click();
   await page.getByText('Количество уточняется',{exact:true}).waitFor();
   const resetLoaded=page.locator('p[role="status"]').filter({hasText:/^Показано\s+24\s*$/});
   await resetLoaded.waitFor({state:'visible'});
   assert.equal(await resetLoaded.count(),1,'the unknown new selection must retain its actual 24 displayed rows');
   assert.equal(await page.getByRole('link',{name:'Страница '+last,exact:true}).count(),0,'old-query count must never apply to new filters');
  }
  await runJapanCases(page,width);
  assert.deepEqual(errors,[]);
  await page.close();activePage=undefined;
 }
 assert.equal(fixture.counts,0,'the local Japanese list fixture never invokes an aggregate');
 assert.equal(blockedExternal,0);assert.equal(report.caseCount,12);
 report.checks={refill24:true,numberedContinuation:true,appendNoDuplicatesOrGaps:true,finiteExhaustion:true,unknownPowerPreserved:true,failureHonesty:true,cursorBinding:true,warningRemoved:true,sourcePageSize24:true,neighborPaginationPreserved:true,noExternalRequests:true,knownBeforeUnknown:true,boundedKnownContinuation:true,evidenceEpochReset:true};
 report.passed=true;
}catch(error){
 process.exitCode=1;console.error(error);
 // Diagnostics describe this locally served fixture only. Keep them separate
 // from the exact acceptance-report schema and never collect cookies/storage.
 let timeout,dom=null;
 try{
  if(activePage&&!activePage.isClosed())dom=await Promise.race([
   activePage.evaluate(()=>({readyState:document.readyState,rootPresent:Boolean(document.getElementById('root')),
    rootHtml:(document.getElementById('root')?.innerHTML||'').slice(0,8192),
    bodyText:(document.body?.innerText||'').slice(0,2048)})),
   new Promise(resolve=>{timeout=setTimeout(()=>resolve(null),2000);}),
  ]);
 }catch{}finally{clearTimeout(timeout);}
 console.error('PAGINATION_FIXTURE_FAILURE '+JSON.stringify({phase:fixturePhase,width:activeWidth,
  pageErrors:activeErrors,consoleErrors:activeConsole,dom}));
}
finally{
 await browser.close();await new Promise(r=>server.close(r));delete globalThis.__japanRefillFixture;delete globalThis.__japanRefillPageProps;
 if(process.env.JAPAN_PAGINATION24_REPORT)fs.writeFileSync(process.env.JAPAN_PAGINATION24_REPORT,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}

async function runJapanCases(page,width){
 fixture.editorialRevision='fixture-1';
 const cardIds=()=>page.locator('#root article').evaluateAll(cards=>cards.map(card=>{
  const href=card.querySelector('a[href*="/cars/offer/"]').href;
  return decodeURIComponent(new URL(href).pathname.split('/')[3]);
 }));
 const waitCards=count=>page.waitForFunction(n=>document.querySelectorAll('#root article').length===n,count);
 const warningAbsent=async()=>{
  assert.equal(await page.locator('[data-japan-power-summary-page]').count(),0);
  assert.equal(await page.getByText(/Отбор не подтверждает/).count(),0);
  assert.equal(await page.getByText(/Страница 1: Мощность/).count(),0);
 };
 const ssrEvidence=async(pageNumber,after='')=>{
  const raw=await page.locator('main.ac-ajes-catalog').getAttribute('data-japan-source-receipts');
  assert.equal(typeof raw,'string');assert(Buffer.byteLength(raw)<=8192);
  const value=JSON.parse(raw);assert.equal(value.version,1);assert.equal(value.page,pageNumber);
  assert.equal(value.afterSha256,createHash('sha256').update(after).digest('hex'));
  assert.equal(value.omitted,0);assert(value.receipts.length<=8);
  assert(value.receipts.every(row=>row.stage==='supplier'&&row.supplierAttempted===true));
  return value;
 };
 const expected=[...Array.from({length:23},(_,i)=>'ajes-stats-refill-1-'+i),...Array.from({length:24},(_,i)=>'ajes-stats-refill-2-'+i),'ajes-stats-refill-3-0','ajes-stats-refill-3-1'];
 const known=id=>Number(id.split('-').at(-1))%3!==0;
 const powerExpected=[...expected.filter(known),...expected.filter(id=>!known(id))];
 const orderedPower=async()=>{
  const kinds=await page.locator('#root article').evaluateAll(cards=>cards.map(card=>card.querySelector('[data-japan-power-unknown]')?'unknown':'known'));
  let unknown=false;for(const kind of kinds){if(kind==='unknown')unknown=true;else assert.equal(unknown,false,'known cards must never follow an unknown card');}
  return kinds;
 };
 for(const power of [false,true]){
  fixturePhase=power?'japan_power':'japan_plain';
  fixture.changed=false;fixture.queries.length=0;responses.length=0;
  const query=new URLSearchParams({fixture:'refill',fuel:'petrol',city:'Новокузнецк',...(power?{powerTo:'160'}:{})});
  await page.goto(origin+'/cars/japan?'+query);await waitCards(24);await warningAbsent();
  assert.deepEqual((await ssrEvidence(1)).receipts.map(row=>row.page),[1,2]);
  const order=power?powerExpected:expected;
  const first=await cardIds();assert.deepEqual(first,order.slice(0,24));
  if(power){assert.equal(await page.locator('#root [data-japan-power-unknown]').count(),0);await orderedPower();}
  else assert.ok(await page.locator('#root [data-japan-power-unknown]').count()>0,'actual cards retain their unknown-power labels');
  assert.deepEqual(fixture.queries.map(q=>q.page),[1,2]);
  const nextHref=await page.getByRole('link',{name:'Страница 2',exact:true}).getAttribute('href');
  const nextUrl=new URL(nextHref,origin),cursor=nextUrl.searchParams.get('after');
  assert.match(cursor,power?/^j2\.k\.2\.9\.2\.[a-f0-9]{64}\.[a-f0-9]{64}\.[a-f0-9]{64}$/:/^j1\.2\.1\.2\.[a-f0-9]{64}\.[a-f0-9]{64}$/);
  assert.equal(nextUrl.searchParams.get('city'),'Новокузнецк');assert.equal(nextUrl.searchParams.get('fuel'),'petrol');
  assert.equal(nextUrl.searchParams.get('powerTo'),power?'160':null);
  await page.getByRole('link',{name:'Страница 2',exact:true}).click();await waitCards(24);await warningAbsent();
  assert.equal(new URL(page.url()).searchParams.get('after'),cursor);
  assert.deepEqual((await ssrEvidence(2,cursor)).receipts.map(row=>row.page),power?[2,3,1,2]:[2,3]);
  const second=await cardIds();assert.deepEqual(second,order.slice(24,48));
  if(power)assert.deepEqual(await orderedPower(),[...Array(8).fill('known'),...Array(16).fill('unknown')]);
  assert.equal(new Set([...first,...second]).size,48);
  const secondNextHref=await page.getByRole('link',{name:'Страница 3',exact:true}).getAttribute('href');
  const secondCursor=new URL(secondNextHref,origin).searchParams.get('after');assert.match(secondCursor,power?/^j2\.u\.3\.0\.3\.[a-f0-9]{64}\.[a-f0-9]{64}\.-$/:/^j1\.3\.1\.3\./);
  const previous=await page.getByRole('link',{name:'Предыдущая страница',exact:true}).getAttribute('href');
  assert.equal(new URL(previous,origin).searchParams.get('page'),'1');assert.equal(new URL(previous,origin).searchParams.get('after'),null);
  await page.getByRole('button',{name:'Показать ещё',exact:true}).click();await waitCards(25);
  assert.equal(await page.evaluate(()=>window.calls[0].after),secondCursor);
  assert.deepEqual(await cardIds(),order.slice(24));
  assert.deepEqual([...first,...await cardIds()],order);
  if(power){assert.deepEqual(await orderedPower(),[...Array(8).fill('known'),...Array(17).fill('unknown')]);assert.equal(new Set([...first,...await cardIds()]).size,49);}
  assert.equal(await page.getByRole('button',{name:'Показать ещё',exact:true}).count(),0);
  assert.equal(await page.getByRole('link',{name:'Следующая страница',exact:true}).count(),0);
  assert.equal(await page.getByRole('link',{name:'Страница 4',exact:true}).count(),0);
  // AJ fuel predicates can omit locally corrected matching cars. Exhausted
  // provider pages cannot certify the complete user selection in that scope.
  const result=responses.at(-1);assert.equal(result.data.items.length,1);assert.equal(result.data.hasMore,false);assert.equal(result.data.nextCursor,null);
  assert.equal(result.data.partial,true,'an unproved fuel source scope must not claim a complete selection');
  await page.getByText('Показаны сохранённые автомобили. Полный список пока недоступен.',{exact:true}).waitFor();
  assert.equal(await page.getByText('Вы посмотрели все доступные предложения',{exact:true}).count(),0);
  assert.equal(result.data.total,null,'a later finite page is not a fabricated global count');
  assert.deepEqual(fixture.queries.map(q=>q.page),power?[1,2,2,3,1,2,3]:[1,2,2,3,3]);
  assert.ok(fixture.queries.every(q=>q.pageSize===24));
  const sourceQueries=fixture.queries.map(({page,...q})=>JSON.stringify(q));
  assert.ok(sourceQueries.every(q=>q===sourceQueries[0]),'continuation changes only the source page');
  report.caseCount++;
 }
 // A source-supported selection separately proves that exhausted visitor pages
 // end normally. This is a bounded offline fixture, never a live AJ total.
 fixturePhase='japan_supported_scope_exhaustion';
 fixture.changed=false;fixture.queries.length=0;responses.length=0;
 await page.goto(origin+'/cars/japan?fixture=refill&city='+encodeURIComponent('Новокузнецк'));
 await waitCards(24);
 await page.getByRole('link',{name:'Страница 2',exact:true}).click();await waitCards(24);
 await page.getByRole('button',{name:'Показать ещё',exact:true}).click();await waitCards(25);
 const supported=responses.at(-1);
 assert.equal(supported.data.partial,false,'a proven source scope must not inherit unproved-filter state');
 assert.equal(supported.data.hasMore,false);assert.equal(supported.data.nextCursor,null);
 await page.getByText('Вы посмотрели все доступные предложения',{exact:true}).waitFor();
 assert.equal(await page.getByText('Показаны сохранённые автомобили. Полный список пока недоступен.',{exact:true}).count(),0);
 assert.deepEqual(fixture.queries.map(query=>query.page),[1,2,2,3,3]);
 assert.deepEqual(await cardIds(),expected.slice(24));

 fixturePhase='japan_failure_recovery';
 fixture.changed=false;fixture.queries.length=0;responses.length=0;
 await page.goto(origin+'/cars/japan?fixture=refill&case=failure&fuel=petrol&city='+encodeURIComponent('Новокузнецк'));
 await waitCards(23);await warningAbsent();
 const failureEvidence=await ssrEvidence(1);
 assert.equal(failureEvidence.receipts.at(-1).page,2);
 assert.equal(failureEvidence.receipts.at(-1).outcome,'unavailable');
 assert.equal(failureEvidence.receipts.at(-1).reason,'request_timeout');
 await page.getByText('Показана часть автомобилей. Полный список пока недоступен.',{exact:true}).waitFor();
 const before=await cardIds();
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 await page.getByRole('button',{name:'Показать ещё',exact:true}).click();
 await page.getByRole('alert').waitFor();assert.deepEqual(await cardIds(),before);
 assert.equal(await page.getByText('Вы посмотрели все доступные предложения',{exact:true}).count(),0);
 const restart=await page.getByRole('link',{name:'Открыть первую страницу',exact:true}).getAttribute('href');
 const restartQuery=new URL(restart,origin).searchParams;
 assert.equal(restartQuery.get('after'),null);assert.equal(restartQuery.get('fuel'),'petrol');assert.equal(restartQuery.get('city'),'Новокузнецк');
 assert.deepEqual(fixture.queries.map(q=>q.page),[1,2,2],'failure retries the exact failed source offset and never skips it');
 fixture.mode='normal';
 await page.getByRole('button',{name:'Показать ещё',exact:true}).click();await waitCards(47);
 assert.deepEqual(await cardIds(),expected.slice(0,47),'successful continuation resumes at the failed offset without a duplicate or a gap');
 // The tab has a saved old 23-card visit. A fresh server page with 24 must
 // replace it in the same mounted component, not resurrect that old visit.
 const instance=await page.locator('#root [data-catalog-batch]').first().evaluateHandle(element=>element.parentElement);
 await page.evaluate(async()=>{
  const params=new URLSearchParams(location.search);params.set('market','japan');params.set('page','1');params.delete('after');
  const result=await fetch('/api/catalog/search?'+params).then(response=>response.json());
  window.__japanRefillReplace(result);
 });
 await waitCards(24);assert.deepEqual(await cardIds(),expected.slice(0,24),'new initialPageKey excludes the saved 23-card membership');
 assert.equal(await instance.evaluate(node=>node.isConnected&&node===document.querySelector('#root [data-catalog-batch]').parentElement),true,'same-query replacement must preserve the mounted CatalogLoadMore root');
 await instance.dispose();
 assert.deepEqual(fixture.queries.map(q=>q.page),[1,2,2,2,1,2]);
 report.caseCount++;

 fixturePhase='japan_membership_change';
 fixture.changed=false;fixture.queries.length=0;responses.length=0;
 await page.goto(origin+'/cars/japan?fixture=refill&fuel=petrol&city='+encodeURIComponent('Новокузнецк'));
 await waitCards(24);
 const original=await cardIds();fixture.changed=true;
 await page.getByRole('button',{name:'Показать ещё',exact:true}).click();await page.getByRole('alert').waitFor();
 assert.deepEqual(await cardIds(),original,'changed accepted membership cannot silently append a shifted continuation');
 assert.deepEqual(fixture.queries.map(q=>q.page),[1,2,2]);
 assert.equal(await page.locator('[data-catalog-batch]').count(),1);
 assert.equal(new URL(await page.getByRole('link',{name:'Открыть первую страницу',exact:true}).getAttribute('href'),origin).searchParams.has('after'),false);
 fixture.changed=false;report.caseCount++;

 fixturePhase='japan_empty_known_continuation';
 fixture.queries.length=0;responses.length=0;
 await page.goto(origin+'/cars/japan?fixture=refill&case=empty-known&powerTo=160&fuel=petrol&city='+encodeURIComponent('Новокузнецк'));
 await page.getByRole('link',{name:'Страница 2',exact:true}).waitFor();
 assert.equal(await page.locator('#root article').count(),0);
 assert.equal(await page.getByText('Вы посмотрели все доступные предложения',{exact:true}).count(),0);
 assert.equal(await page.getByText(/По выбранным параметрам автомобили не найдены/).count(),0);
 await page.getByText('Показана часть автомобилей. Полный список пока недоступен.',{exact:true}).waitFor();
 assert.deepEqual(fixture.queries.map(query=>query.page),[1,2,3,4,5,6,7,8],'an empty known phase consumes only the bounded visitor budget');
 assert.deepEqual((await ssrEvidence(1)).receipts.map(row=>row.page),[1,2,3,4,5,6,7,8]);
 const emptyCursor=new URL(await page.getByRole('link',{name:'Страница 2',exact:true}).getAttribute('href'),origin).searchParams.get('after');
 assert.match(emptyCursor,/^j2\.k\.9\.0\.2\.[a-f0-9]{64}\.[a-f0-9]{64}\.-$/);
 await page.getByRole('button',{name:'Показать ещё',exact:true}).click();await waitCards(24);
 assert.equal(await page.evaluate(()=>window.calls[0].after),emptyCursor);
 const laterKnown=Array.from({length:24},(_,i)=>'ajes-stats-refill-9-'+i);
 assert.deepEqual(await cardIds(),laterKnown);assert.deepEqual(await orderedPower(),Array(24).fill('known'));
 assert.deepEqual(fixture.queries.map(query=>query.page),[1,2,3,4,5,6,7,8,9]);
 const untilEnd=new URL(await page.getByRole('link',{name:'Страница 3',exact:true}).getAttribute('href'),origin).searchParams.get('after');
 assert.match(untilEnd,/^j2\.k\.10\.0\.3\.[a-f0-9]{64}\.[a-f0-9]{64}\.-$/);
 await page.getByRole('button',{name:'Показать ещё',exact:true}).click();await waitCards(48);
 assert.deepEqual(await cardIds(),[...laterKnown,...Array.from({length:24},(_,i)=>'ajes-stats-refill-1-'+i)]);
 assert.deepEqual(await orderedPower(),[...Array(24).fill('known'),...Array(24).fill('unknown')]);
 assert.deepEqual(fixture.queries.map(query=>query.page),[1,2,3,4,5,6,7,8,9,10,1],'unknown rows start only after a fresh known-pass end');
 assert.equal(new Set(await cardIds()).size,48);
 assert.equal(await page.getByText('Вы посмотрели все доступные предложения',{exact:true}).count(),0);
 assert.equal(responses.at(-1).data.total,null);await warningAbsent();report.caseCount++;

 fixturePhase='japan_evidence_epoch_reset';
 fixture.editorialRevision='fixture-1';fixture.queries.length=0;responses.length=0;
 await page.goto(origin+'/cars/japan?fixture=refill&powerTo=160&fuel=petrol&city='+encodeURIComponent('Новокузнецк'));
 await waitCards(24);const oldRows=await cardIds();assert.deepEqual(oldRows,powerExpected.slice(0,24));
 const selectedParams=url=>[...url.searchParams].filter(([key])=>key!=='page'&&key!=='after').sort(([a,av],[b,bv])=>a.localeCompare(b)||av.localeCompare(bv));
 const selectedUrl=new URL(page.url());selectedUrl.searchParams.set('market','japan');
 const expectedSelection=selectedParams(selectedUrl);
 const oldNext=new URL(await page.getByRole('link',{name:'Страница 2',exact:true}).getAttribute('href'),origin);
 assert.deepEqual(selectedParams(oldNext),expectedSelection,'the original continuation preserves every selected query parameter');
 const oldCursor=oldNext.searchParams.get('after');assert.match(oldCursor,/^j2\.k\./);
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 fixture.editorialRevision='fixture-2';
 await page.getByRole('button',{name:'Показать ещё',exact:true}).click();
 await page.getByRole('alert').waitFor();
 assert.equal((await page.getByRole('alert').innerText()).trim(),'Данные подбора обновились. Откройте первую страницу — выбранные фильтры сохранены.');
 assert.deepEqual(await cardIds(),oldRows,'epoch rejection must preserve the visitor’s existing cards');
 assert.deepEqual(fixture.queries.map(query=>query.page),[1,2],'an expired evidence epoch is rejected before any source read');
 assert.equal(responses.at(-1).status,409);
 assert.deepEqual(responses.at(-1).data,{ok:false,error:'japan_cursor_refresh_required'});
 assert.equal(await page.locator('#root [data-catalog-batch]').count(),1);
 assert.equal(await page.locator('#root nav.ac-pagination').count(),0);
 assert.equal(await page.getByRole('button',{name:'Показать ещё',exact:true}).count(),0);
 const reset=page.getByRole('link',{name:'Открыть первую страницу',exact:true});
 const resetUrl=new URL(await reset.getAttribute('href'),origin);
 assert.equal(resetUrl.searchParams.get('after'),null);assert.equal(resetUrl.searchParams.get('page'),'1');
 assert.deepEqual(selectedParams(resetUrl),expectedSelection,'the reset link preserves every selected query parameter');
 for(const [key,value] of [['fuel','petrol'],['powerTo','160'],['city','Новокузнецк']])assert.equal(resetUrl.searchParams.get(key),value);
 await reset.click();await waitCards(24);
 assert.deepEqual(selectedParams(new URL(page.url())),expectedSelection,'the reopened page preserves every selected query parameter');
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('#root article a[href*="/cars/offer/"]')).some(link=>link.href.includes('ajes-stats-refill-1-0')));
 const updatedKnown=id=>known(id)||id==='ajes-stats-refill-1-0';
 const updatedOrder=[...expected.filter(updatedKnown),...expected.filter(id=>!updatedKnown(id))];
 assert.deepEqual(await cardIds(),updatedOrder.slice(0,24));await orderedPower();
 const renewed=new URL(await page.getByRole('link',{name:'Страница 2',exact:true}).getAttribute('href'),origin);
 const newCursor=renewed.searchParams.get('after');assert.match(newCursor,/^j2\.k\./);
 assert.notEqual(newCursor.split('.')[6],oldCursor.split('.')[6],'new evidence must mint a different opaque epoch');
 assert.notEqual(newCursor.split('.')[5],oldCursor.split('.')[5],'new evidence must rotate the bound cursor query hash');
 assert.deepEqual(selectedParams(renewed),expectedSelection,'the selected query stays unchanged');
 for(const [key,value] of [['fuel','petrol'],['powerTo','160'],['city','Новокузнецк']])assert.equal(renewed.searchParams.get(key),value);
 assert.deepEqual(fixture.queries.map(query=>query.page),[1,2,1,2]);
 assert.equal(await page.getByRole('alert').count(),0);await warningAbsent();
 fixture.editorialRevision='fixture-1';report.caseCount++;
}


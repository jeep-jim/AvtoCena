import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import path from 'node:path';
import {createRequire} from 'node:module';
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
 b.onLoad({filter:/action/,namespace:'stub'},()=>({resolveDir:process.cwd(),contents:`import {loadMoreCatalog as actual} from ${JSON.stringify(path.resolve('apps/web/components/catalog/catalog-load-more-action.tsx'))};export async function loadMoreCatalog(query,page,after){window.calls=(window.calls||[]).concat([{query,page,after}]);if(query.fixture==='refill')return actual(query,page,after);return {page,total:null,ids:Array(24).fill('car'),cards:'Следующие 24 автомобиля',hasMore:page<3,nextCursor:query.market==='china'?(page===2?'12.16':null):undefined}};export const loadMoreGreenCorner=loadMoreCatalog;`}));
 b.onResolve({filter:/\.css$/},()=>({path:'css',namespace:'fixture-css'}));
 b.onLoad({filter:/.*/,namespace:'fixture-css'},()=>({contents:'export default {};'}));
}}]});
// Actual Japanese catalog caller/helper and server component, with only local
// source/pricing/metadata transports. No provider or production request is made.
class FixtureUnavailable extends Error {constructor(reason){super(reason);this.reason=reason;}}
const fixture={queries:[],counts:0,mode:'normal',changed:false,Unavailable:FixtureUnavailable,
 read:async query=>{
  fixture.queries.push({...query});
  assert.equal(query.pageSize,24,'every local source read preserves the 24-row provider contract');
  if(fixture.mode==='failure'&&query.page===2)throw new FixtureUnavailable('request_timeout');
  const count=query.page===1?23:query.page===2?24:query.page===3?2:0;
  const items=Array.from({length:count},(_,index)=>{
   const i=fixture.changed&&query.page===2?count-1-index:index,id='ajes-stats-refill-'+query.page+'-'+i;
   return {id,sourceId:'ajes_japan_feed',sourceOfferId:'refill-'+query.page+'-'+i,market:'japan',
    offerType:'auction',status:'sold',catalogKind:'auction_result',auctionResult:'sold',auctionPriceKind:'hammer',
    make:'TOYOTA',model:'TEST',year:2022,mileageKm:50000,engineCc:1500,fuel:'petrol',drive:'fwd',bodyType:'hatchback',
    sourcePrice:500000,sourceCurrency:'JPY',priceMode:'auction_start',catalogPricingMode:'seller',sellerPriceRub:300000,
    totalRub:null,calculationStatus:'needs_data',images:[],firstSeenAt:'2026-11-26T10:00:00.000Z',updatedAt:'2026-11-26T10:00:00.000Z',
    ...(i%3?{japanSupplierPower:{offerId:id,hp:150,unit:'hp',source:'ajes_pw'}}:{japanPowerUnknown:true}),operational:{}};
  });
  return {items,page:query.page,pageSize:24,received:query.page<3?24:count,partial:false,stale:false,observedAt:'2026-11-26T10:00:00.000Z'};
 }};
globalThis.__japanRefillFixture=fixture;
const serverStubs={
 'server-only':'',
 'next/headers':"export const headers=async()=>new Map([['x-real-ip','127.0.0.1']]);",
 './ajes-runtime':"export const ajesClient={read:async()=>{globalThis.__japanRefillFixture.counts++;throw Error('unexpected aggregate');}};",
 './ajes-public':"export const cappedAjesQuery=async q=>q;export const readAjesPublic=q=>globalThis.__japanRefillFixture.read(q);",
 './ajes-client':"export const readAjesModelDirectory=async()=>({models:[]});export const readAjesMakeDirectory=async()=>({makes:[]});export const AjesUnavailable=globalThis.__japanRefillFixture.Unavailable;",
 './storage':"export const publicOffer=x=>x;",
 './market-page':"export const sortCatalogRows=x=>x;",
 './live-business-pricing':"export const applyActiveBusinessPricingBatch=async rows=>rows;",
 './collection-controls':"export const assertCollectionEnabled=async()=>{};",
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
await build({stdin:{contents:"import React from 'react';\nimport {renderToStaticMarkup} from 'react-dom/server';\nimport {AjesCatalog} from './apps/web/components/catalog/AjesCatalog';\nimport {readAjesCatalogPage} from './apps/web/lib/catalog/ajes-catalog';\nexport {AjesInputError} from './apps/web/lib/catalog/ajes-query';\nfunction withoutOptionalAsync(node){\n if(Array.isArray(node))return node.map(withoutOptionalAsync);\n if(!React.isValidElement(node))return node;\n if(typeof node.type==='function'&&node.type.constructor.name==='AsyncFunction')return null;\n const props={...node.props};\n for(const key of ['children','header','filters'])if(key in props)props[key]=withoutOptionalAsync(props[key]);\n return React.cloneElement(node,props);\n}\nexport async function render(params){\n globalThis.__japanRefillPageProps=undefined;\n const html=renderToStaticMarkup(withoutOptionalAsync(await AjesCatalog({params})));\n const {initialCards,...props}=globalThis.__japanRefillPageProps;\n return {html,initial:{props,items:initialCards.map(card=>card.props.offer)}};\n}\nexport const read=params=>readAjesCatalogPage(params,undefined,{includeCount:false});\n",resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'cjs',jsx:'automatic',tsconfig:'apps/web/tsconfig.json',outfile:out+'/server.cjs',external:['react','react/jsx-runtime','react-dom/server'],plugins:[{name:'local-japan-caller',setup(b){
 b.onResolve({filter:/.*/},args=>{
  const name=args.path.split('/').pop();
  if(args.importer.endsWith('/AjesCatalog.tsx')&&name in uiStubs)return {path:name,namespace:'japan-ui-fixture'};
  if(args.path in serverStubs)return {path:args.path,namespace:'japan-source-fixture'};
 });
 b.onLoad({filter:/.*/,namespace:'japan-source-fixture'},args=>({contents:serverStubs[args.path]}));
 b.onLoad({filter:/.*/,namespace:'japan-ui-fixture'},args=>({contents:uiStubs[args.path],resolveDir:process.cwd()}));
}}]});
// The standalone fixture uses installed React outside Next's server renderer.
// Adapt only request memoization, as the native caller fixtures do; the browser
// bundle and the actual catalog/filter/pagination modules stay unchanged.
const require=createRequire(import.meta.url),serverModule={exports:{}};
const react=require('react');
const fixtureRequire=id=>id==='react'?{...react,cache:fn=>fn}:require(id);
new Function('require','module','exports',fs.readFileSync(path.resolve(out+'/server.cjs'),'utf8'))(fixtureRequire,serverModule,serverModule.exports);
const actual=serverModule.exports;
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
    catch(error){res.statusCode=error instanceof actual.AjesInputError?400:503;res.end(JSON.stringify({ok:false}));}
   }else res.end(JSON.stringify({ok:false}));
   return;
  }
  const params=Object.fromEntries(url.searchParams);
  if(params.fixture==='refill'){
   params.market='japan';
   fixture.mode=params.case==='failure'?'failure':'normal';
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
const report={version:1,kind:'japan-pagination24-browser-v1',passed:false,caseCount:0,widths:[390,1440],checks:{}};
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
   assert.equal(await page.getByRole('link',{name:'Страница '+last,exact:true}).count(),0,'old-query count must never apply to new filters');
  }
  await runJapanCases(page,width);
  assert.deepEqual(errors,[]);
  await page.close();activePage=undefined;
 }
 assert.equal(fixture.counts,0,'the local Japanese list fixture never invokes an aggregate');
 assert.equal(blockedExternal,0);assert.equal(report.caseCount,8);
 report.checks={refill24:true,numberedContinuation:true,appendNoDuplicatesOrGaps:true,finiteExhaustion:true,unknownPowerPreserved:true,failureHonesty:true,cursorBinding:true,warningRemoved:true,sourcePageSize24:true,neighborPaginationPreserved:true,noExternalRequests:true};
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
 const expected=[...Array.from({length:23},(_,i)=>'ajes-stats-refill-1-'+i),...Array.from({length:24},(_,i)=>'ajes-stats-refill-2-'+i),'ajes-stats-refill-3-0','ajes-stats-refill-3-1'];
 for(const power of [false,true]){
  fixturePhase=power?'japan_power':'japan_plain';
  fixture.changed=false;fixture.queries.length=0;responses.length=0;
  const query=new URLSearchParams({fixture:'refill',fuel:'petrol',city:'Новокузнецк',...(power?{powerTo:'160'}:{})});
  await page.goto(origin+'/cars/japan?'+query);await waitCards(24);await warningAbsent();
  const first=await cardIds();assert.deepEqual(first,expected.slice(0,24));
  assert.ok(await page.locator('#root [data-japan-power-unknown]').count()>0,'actual cards retain their unknown-power labels');
  assert.deepEqual(fixture.queries.map(q=>q.page),[1,2]);
  const nextHref=await page.getByRole('link',{name:'Страница 2',exact:true}).getAttribute('href');
  const nextUrl=new URL(nextHref,origin),cursor=nextUrl.searchParams.get('after');
  assert.match(cursor,/^j1\.2\.1\.2\.[a-f0-9]{64}\.[a-f0-9]{64}$/);
  assert.equal(nextUrl.searchParams.get('city'),'Новокузнецк');assert.equal(nextUrl.searchParams.get('fuel'),'petrol');
  assert.equal(nextUrl.searchParams.get('powerTo'),power?'160':null);
  await page.getByRole('link',{name:'Страница 2',exact:true}).click();await waitCards(24);await warningAbsent();
  assert.equal(new URL(page.url()).searchParams.get('after'),cursor);
  const second=await cardIds();assert.deepEqual(second,expected.slice(24,48));
  assert.equal(new Set([...first,...second]).size,48);
  const secondNextHref=await page.getByRole('link',{name:'Страница 3',exact:true}).getAttribute('href');
  const secondCursor=new URL(secondNextHref,origin).searchParams.get('after');assert.match(secondCursor,/^j1\.3\.1\.3\./);
  const previous=await page.getByRole('link',{name:'Предыдущая страница',exact:true}).getAttribute('href');
  assert.equal(new URL(previous,origin).searchParams.get('page'),'1');assert.equal(new URL(previous,origin).searchParams.get('after'),null);
  await page.getByRole('button',{name:'Показать ещё',exact:true}).click();await waitCards(25);
  assert.equal(await page.evaluate(()=>window.calls[0].after),secondCursor);
  assert.deepEqual(await cardIds(),expected.slice(24));
  assert.deepEqual([...first,...await cardIds()],expected);
  assert.equal(await page.getByRole('button',{name:'Показать ещё',exact:true}).count(),0);
  assert.equal(await page.getByRole('link',{name:'Следующая страница',exact:true}).count(),0);
  assert.equal(await page.getByRole('link',{name:'Страница 4',exact:true}).count(),0);
  await page.getByText('Вы посмотрели все доступные предложения',{exact:true}).waitFor();
  const result=responses.at(-1);assert.equal(result.data.items.length,1);assert.equal(result.data.hasMore,false);assert.equal(result.data.nextCursor,null);
  assert.equal(result.data.total,null,'a later finite page is not a fabricated global count');
  assert.deepEqual(fixture.queries.map(q=>q.page),[1,2,2,3,3]);
  assert.ok(fixture.queries.every(q=>q.pageSize===24));
  const sourceQueries=fixture.queries.map(({page,...q})=>JSON.stringify(q));
  assert.ok(sourceQueries.every(q=>q===sourceQueries[0]),'continuation changes only the source page');
  report.caseCount++;
 }
 fixturePhase='japan_failure_recovery';
 fixture.changed=false;fixture.queries.length=0;responses.length=0;
 await page.goto(origin+'/cars/japan?fixture=refill&case=failure&powerTo=160&fuel=petrol&city='+encodeURIComponent('Новокузнецк'));
 await waitCards(23);await warningAbsent();
 await page.getByText('Показана часть автомобилей. Полный список пока недоступен.',{exact:true}).waitFor();
 const before=await cardIds();
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 await page.getByRole('button',{name:'Показать ещё',exact:true}).click();
 await page.getByRole('alert').waitFor();assert.deepEqual(await cardIds(),before);
 assert.equal(await page.getByText('Вы посмотрели все доступные предложения',{exact:true}).count(),0);
 const restart=await page.getByRole('link',{name:'Открыть первую страницу',exact:true}).getAttribute('href');
 const restartQuery=new URL(restart,origin).searchParams;
 assert.equal(restartQuery.get('after'),null);assert.equal(restartQuery.get('powerTo'),'160');assert.equal(restartQuery.get('city'),'Новокузнецк');
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
 await page.goto(origin+'/cars/japan?fixture=refill&powerTo=160&fuel=petrol&city='+encodeURIComponent('Новокузнецк'));
 await waitCards(24);
 const original=await cardIds();fixture.changed=true;
 await page.getByRole('button',{name:'Показать ещё',exact:true}).click();await page.getByRole('alert').waitFor();
 assert.deepEqual(await cardIds(),original,'changed accepted membership cannot silently append a shifted continuation');
 assert.deepEqual(fixture.queries.map(q=>q.page),[1,2,2]);
 assert.equal(await page.locator('[data-catalog-batch]').count(),1);
 assert.equal(new URL(await page.getByRole('link',{name:'Открыть первую страницу',exact:true}).getAttribute('href'),origin).searchParams.has('after'),false);
 fixture.changed=false;report.caseCount++;
}

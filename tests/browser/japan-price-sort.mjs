import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {runJapanPriceSortBrowser, selectJapanPriceSort, verifyJapanPriceSortVisible}
  from '../../scripts/catalog-next/japan-price-sort-browser.mjs';
import {verifyJapanPage, verifyJapanFullPage, verifyJapanPowerPage, verifyJapanVisibleVehiclePolicy,
  japanPageReadEvidence, readJapanSsrPageEvidence}
  from '../../scripts/catalog-next/japan-browser-acceptance.mjs';
import {JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY, JAPAN_SOURCE_COUNT_POLICY,
  japanSourceBoundedIncrementalRequired, japanSourceCountRequired, japanSourcePriceOrderRequired,
  japanSourcePriceOrderAcceptancePassed}
  from '../../scripts/catalog-next/japan-stability-code-scope.mjs';
import {japanExactCountQueryHash} from '../../scripts/catalog-next/japan-exact-count-browser.mjs';
import {runJapanSourcePriceOrderBrowser, japanSourcePriceOrderRequirement, japanSourcePriceCountApi}
  from '../../scripts/catalog-next/japan-source-price-order-browser.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ORIGIN = 'https://avtocena.com', CITY = 'Новокузнецк';
const need = (value, code) => { if (!value) throw Error('japan_price_sort_fixture_' + code); };
const hash = value => createHash('sha256').update(value).digest('hex');
const LOCAL_BRAND_LOGO_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNoaGj4DwAFhAKAjM1mJgAAAABJRU5ErkJggg==', 'base64');
const require = createRequire(import.meta.url);
const runtimeFiles = {
  CatalogFilters: 'apps/web/components/catalog/CatalogFilters.tsx',
  CatalogLoadMore: 'apps/web/components/catalog/CatalogLoadMore.tsx',
  CatalogCard: 'apps/web/components/catalog/CatalogCard.tsx',
  JapanCatalogCount: 'apps/web/components/catalog/JapanCatalogCount.tsx',
  CatalogSelectionContext: 'apps/web/components/catalog/CatalogSelectionContext.tsx',
  CatalogSidebar: 'apps/web/components/catalog/CatalogSidebar.tsx',
};
const extraFiles = ['apps/web/components/catalog/CatalogSortSelect.tsx',
  'apps/web/components/catalog/catalog-load-more-action.tsx', 'apps/web/lib/catalog/ajes-count-display.ts',
  'apps/web/lib/catalog/catalog-sort.ts', 'apps/web/lib/catalog/card-city-delivery.ts',
  'apps/web/lib/catalog/calculated-price.ts', 'apps/web/tailwind.config.ts'];
// Public layout imports, in their source order. Component CSS (including CSS
// module class names) is supplied by esbuild's separate generated CSS bundle.
const layoutStyles = ['apps/web/app/select-controls.css', 'apps/web/app/globals.css',
  'apps/web/app/catalog-ui.css', 'apps/web/app/public-polish.css', 'apps/web/app/public-typography.css',
  'apps/web/app/flat-ui.css', 'apps/web/app/public-regression-fixes.css',
  'apps/web/app/public-price-sheet-fix.css', 'apps/web/app/catalog-filter-compact.css'];

const fixtureSource = `
import React,{useEffect,useState} from 'react';
import {hydrateRoot} from 'react-dom/client';
import {CatalogFilters} from 'runtime:CatalogFilters';
import {CatalogLoadMore} from 'runtime:CatalogLoadMore';
import {CatalogCard} from 'runtime:CatalogCard';
import {JapanCatalogCount} from 'runtime:JapanCatalogCount';
import {CatalogSidebar} from 'runtime:CatalogSidebar';
import {CatalogResultCountUpdate} from 'runtime:CatalogSelectionContext';
export function PriceSortFixture({initial,result,remount=false,sourcePriceOrder=false}){
 const [current,setCurrent]=useState({initial,result}),[late,setLate]=useState(null);
 const query=current.initial,rows=current.result.items,key=JSON.stringify(query);
 useEffect(()=>{
  const fixture=window.__japanPriceSort;
  fixture.replace=(next)=>setCurrent(next);fixture.late=(next)=>setLate(next);fixture.ready=true;
 },[]);
 return <main className="ac-catalog-page ac-page-copy ac-ajes-catalog min-h-screen text-[var(--ac-text)]"
  data-japan-source-receipts={sourcePriceOrder?JSON.stringify(current.result.ssrEvidence):undefined}>
  <section className="ac-catalog-shell mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-10">
   <CatalogSidebar resultScope="ajes:japan:false"
    header={<h1 className="text-[30px] font-black leading-none tracking-[-0.04em] sm:text-4xl md:text-6xl">Авто из Японии под заказ</h1>}
    filters={<CatalogFilters key={remount?key:'preserved'} initial={query} auctionResults facets={{makes:[],models:[],bodyTypes:[],transmissions:[],fuels:['petrol'],drives:[]}}/>}>
   {late&&<CatalogResultCountUpdate {...late}/>}
   <h2>Япония <JapanCatalogCount queryKey={key} summary={current.result.countSummary} initialCount={rows.length}
    request={sourcePriceOrder?query:undefined}/></h2>
   <CatalogLoadMore key={key} query={query} resultQueryKey={key} initialPage={current.result.page}
    initialTotal={current.result.total} initialCount={rows.length} initialHasMore={current.result.hasMore}
    initialNextCursor={current.result.nextCursor} initialPageKey={JSON.stringify([key,rows.map(row=>row.id)])}
    initialCards={rows.map(offer=><CatalogCard key={offer.id} offer={offer} compact dense/>)}/>
   </CatalogSidebar>
  </section>
 </main>;
}
if(typeof window!=='undefined'){
 const fixture={calls:[],errors:[],ready:false,sequence:0,replace:()=>{},late:()=>{},async navigate(href){
  const sequence=++fixture.sequence;fixture.calls.push(href);history.pushState(null,'',href);
  const query={...Object.fromEntries(new URL(href,location.origin).searchParams),market:'japan'};
  const response=await fetch('/api/catalog/search?'+new URLSearchParams({...query,page:'1',pageSize:'24'}));
  const result=await response.json();
  if(sequence===fixture.sequence&&response.ok)fixture.replace({initial:query,result});
 }};
 window.__japanPriceSort=fixture;
 hydrateRoot(document.getElementById('root'),<PriceSortFixture {...window.__japanPriceSortInitial}/>,
  {onRecoverableError:error=>fixture.errors.push(String(error))});
}
`;

export async function prepare(runtimeRoot, plan) {
  need(path.isAbsolute(runtimeRoot || '') && runtimeRoot !== ROOT.replace(/\/$/, ''), 'runtime_root');
  const [{build}, {default: postcss}, {default: tailwindcss}] = await Promise.all([
    import('esbuild'), import('postcss'), import('tailwindcss')]);
  const git = args => execFileSync('git', ['-C', runtimeRoot, ...args], {encoding: 'utf8', timeout: 30_000}).trim();
  need(git(['rev-parse', 'HEAD']) === plan.runtimeSha && git(['rev-parse', 'HEAD^{tree}']) === plan.runtimeTree, 'runtime_binding');
  const sources = {};
  const verifySource = async file => {
    const raw = await fs.readFile(path.join(runtimeRoot, file));
    const committed = execFileSync('git', ['-C', runtimeRoot, 'show', plan.runtimeSha + ':' + file], {timeout: 30_000});
    need(raw.equals(committed), 'runtime_component_changed'); sources[file] = hash(raw);
  };
  for (const file of [...Object.values(runtimeFiles), ...extraFiles, ...layoutStyles]) await verifySource(file);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'japan-price-sort-'));
  const transport = {name: 'exact-runtime-price-sort-components', setup(builder) {
    builder.onResolve({filter: /^fixture:price-sort$/}, () => ({path: 'price-sort', namespace: 'fixture'}));
    builder.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: fixtureSource, loader: 'tsx', resolveDir: runtimeRoot}));
    builder.onResolve({filter: /^runtime:/}, args => {
      const file = runtimeFiles[args.path.slice('runtime:'.length)]; need(file, 'component_scope'); return {path: path.join(runtimeRoot, file)};
    });
    builder.onResolve({filter: /^next\/(navigation|link|image)$/}, args => ({path: args.path, namespace: 'next-fixture'}));
    builder.onLoad({filter: /.*/, namespace: 'next-fixture'}, args => ({loader: 'js', resolveDir: runtimeRoot,
      contents: args.path.endsWith('navigation')
        ? `const router={push(href){void window.__japanPriceSort.navigate(href)},replace(href){history.replaceState(null,'',href)},prefetch(){},refresh(){}};export const useRouter=()=>router;export const usePathname=()=>typeof location==='undefined'?'/cars/japan':location.pathname;export const useSearchParams=()=>new URLSearchParams(typeof location==='undefined'?'':location.search);`
        : args.path.endsWith('image')
          ? `import React from 'react';export default function Image({priority,unoptimized,fill,loader,...props}){return React.createElement('img',props)}`
          : `import React from 'react';export default function Link({children,prefetch,...props}){return React.createElement('a',props,children)}`,
    }));
  }};
  try {
    const common = {absWorkingDir: runtimeRoot, bundle: true, jsx: 'automatic', logLevel: 'silent', metafile: true,
      tsconfig: path.join(runtimeRoot, 'apps/web/tsconfig.json'),
      define: {'process.env.NODE_ENV': '"production"', 'process.env': '{}'}, plugins: [transport]};
    const browserBuild = await build({...common, stdin: {contents: "import 'fixture:price-sort';", resolveDir: runtimeRoot},
      platform: 'browser', format: 'iife', outfile: path.join(temporary, 'fixture.js')});
    await build({...common, stdin: {contents: "import React from 'react';import {renderToString} from 'react-dom/server';import {PriceSortFixture} from 'fixture:price-sort';export const render=(props)=>renderToString(React.createElement(PriceSortFixture,props));", resolveDir: runtimeRoot, loader: 'tsx'},
      platform: 'node', format: 'cjs', outfile: path.join(temporary, 'render.cjs')});
    // Verify every runtime application dependency actually included by esbuild,
    // not just a hand-picked list of entry components.
    for (const file of Object.keys(browserBuild.metafile.inputs).filter(file => file.startsWith('apps/') || file.startsWith('packages/')))
      if (!(file in sources)) await verifySource(file);
    const {render} = require(path.join(temporary, 'render.cjs'));
    const renderMarkup = props => render(props).replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g,
      (_all, open, css, close) => open + css.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&') + close);
    const componentCssPath = Object.values(browserBuild.metafile.outputs).find(output => output.entryPoint)?.cssBundle;
    need(componentCssPath, 'component_css_bundle');
    const componentCss = await fs.readFile(path.resolve(runtimeRoot, componentCssPath), 'utf8');
    const layoutCss = await Promise.all(layoutStyles.map(file => fs.readFile(path.join(runtimeRoot, file), 'utf8')));
    const tailwindConfig = require('tailwindcss/loadConfig')(path.join(runtimeRoot, 'apps/web/tailwind.config.ts'));
    const css = await postcss([tailwindcss({...tailwindConfig, content: [
      ...Object.keys(sources).filter(file => file.endsWith('.tsx')).map(file => path.join(runtimeRoot, file)),
      {raw: fixtureSource, extension: 'tsx'},
    ]})]).process([...layoutCss, componentCss].join('\n'), {from: undefined});
    return {temporary, sources, renderMarkup, javascript: await fs.readFile(path.join(temporary, 'fixture.js')),
      css: css.css, styles: {sourceFiles: Object.keys(sources).filter(file => file.endsWith('.css')),
        componentBundleSha256: hash(componentCss), servedCssSha256: hash(css.css)},
    };
  } catch (error) { await fs.rm(temporary, {recursive: true, force: true}); throw error; }
}

export function fixtureResult(query, now) {
  const page = Number(query.page || 1), sort = query.sort || '';
  need([1, 2, 3].includes(page) && ['', 'totalRub', 'totalRubDesc'].includes(sort) && query.market === 'japan'
    && query.city === CITY && (!query.powerTo || query.powerTo === '160'), 'data_query');
  const pageRows = Array.from({length: 24}, (_,index) => {
    const id = 'ajes-stats-sort-' + page + '-' + index;
    // First two city prices reverse their base order: 950k +20k <900k +120k.
    const base = index === 0 ? 950_000 : index === 1 ? 900_000 : 1_050_000 + (23 - index) * 1000;
    return {id,sourceId:'ajes_japan_feed',sourceOfferId:'sort-'+page+'-'+index,market:'japan',
      offerType:'auction',status:'sold',catalogKind:'auction_result',auctionResult:'sold',auctionPriceKind:'hammer',
      make:'TOYOTA',model:'TEST',year:2022,mileageKm:50000,engineCc:1500,fuel:'petrol',drive:'fwd',bodyType:'hatchback',
      sourcePrice:500000,sourceCurrency:'JPY',priceMode:'auction_start',catalogPricingMode:'seller',sellerPriceRub:300000,
      calculationSnapshot:{currencyRate:{currency:'JPY',sourcePrice:500000,effectiveRate:0.6,rateSource:'cbr',rateDate:now.slice(0,10),sourcePriceRub:300000}},
      totalRub:null,calculationStatus:'needs_data',images:[],firstSeenAt:now,updatedAt:now,
      japanDeliveredPreview:{totalRub:base,engineCc:1500,powerHp:150,deliveryPricingBasis:{subtotalRub:base,deliveryRub:index===0?100000:0,percents:[]}},
      japanSupplierPower:{offerId:id,hp:150,unit:'hp',source:'ajes_pw'},
      operational:{semanticEvidence:{engineCc:{status:'exact',value:1500,source:'ajes:stats:sort:ENG_V',rawValues:['1500']},fuel:{status:'exact',value:'petrol',source:'ajes:stats:sort:TIME',rawValues:['P']}}}};
  });
  if (sort) pageRows.sort((a,b) => {
    const amount = row => row.japanDeliveredPreview.totalRub - row.japanDeliveredPreview.deliveryPricingBasis.deliveryRub;
    return (sort === 'totalRubDesc' ? -1 : 1) * (amount(a) - amount(b));
  });
  const queryHash = hash(JSON.stringify([sort, CITY, query.powerTo || '']));
  const nextCursor = 'j2.k.' + (page + 1) + '.0.' + (page + 1) + '.' + queryHash + '.' + '2'.repeat(64) + '.-';
  return {ok:true,page,pageSize:24,items:pageRows,received:24,total:null,hasMore:true,nextCursor,
    stale:false,partial:false,interrupted:false,scanLimited:false,observedAt:now,generationId:now,countSummary:null,
    powerFilterSummary:{shown:24,localPower:0,supplierPower:24,unknownPower:0}};
}

/** The controlled successor transport has one source-price sequence across
 * pages. Its RUB estimates deliberately disagree and unknown power interleaves,
 * so the old page-local/lane sort cannot accidentally satisfy the new proof. */
export function sourcePriceFixtureResult(query, now) {
  const base = fixtureResult(query, now), power = query.powerTo === '160';
  if (query.countOnly === '1') {
    const total = power ? 800 : 1000;
    return {ok: true, total: null, items: [], countIncomplete: true,
      countSummary: {total, stale: false, observedAt: now, upperBound: true, precision: 'source-upper-bound',
        selectionScope: 'source-candidates', sourceScopeComplete: true,
        sourceCountProof: {version: 1, kind: 'japan-source-count', predicateVersion: 'japan-source-candidates-v1',
          requestedQueryHash: japanExactCountQueryHash(query), sourceQueryHash: hash('controlled source PW:' + power),
          evidenceEpoch: hash('controlled source price epoch'), sourceTotal: total, sourceObservedAt: now,
          sourceScopeComplete: true, directoryComplete: true}}};
  }
  const page = Number(query.page || 1), sort = query.sort || '';
  let items = base.items;
  if (sort) items = Array.from({length: 24}, (_, index) => {
    const rank = sort === 'totalRubDesc' ? 72 - ((page - 1) * 24 + index) : (page - 1) * 24 + index + 1;
    const id = 'ajes-stats-sort-' + (Math.floor((rank - 1) / 24) + 1) + '-' + ((rank - 1) % 24);
    const price = rank * 10000 + 0.25, row = {...base.items[index], id,
      japanAuctionPriceJpy: price, japanCatalogPriceOrder: 'auction',
      operational: {...base.items[index].operational, raw: {finalPriceJpy: price}}};
    if (rank % 5 === 0) { delete row.japanSupplierPower; row.japanPowerUnknown = true; }
    else row.japanSupplierPower = {...row.japanSupplierPower, offerId: id};
    return row;
  });
  const queryHash = hash(JSON.stringify([sort, CITY, query.powerTo || '']));
  const receipt = {version: 1, requestId: '00000000-0000-4000-8000-' + String(page).padStart(12, '0'),
    queryHash, table: 'stats', kind: 'list', page, pageSize: 24, startedAt: now, finishedAt: now,
    stage: 'storage', supplierAttempted: false, outcome: 'fresh', observedAt: now};
  return {...base, items, reads: 1, sourceReceipts: [receipt],
    nextCursor: sort ? 'j1.' + (page + 1) + '.0.' + (page + 1) + '.' + queryHash + '.-' : base.nextCursor,
    powerFilterSummary: {shown: 24, localPower: 0,
      supplierPower: items.filter(row => row.japanSupplierPower).length,
      unknownPower: items.filter(row => row.japanPowerUnknown).length},
    ssrEvidence: {version: 1, page, afterSha256: hash(query.after || ''), receipts: [receipt], omitted: 0}};
}

/** Model coverage is shared by two explicit profiles. Their count contracts
 * stay distinct, and neither environment flag can relabel another plan. */
export function checkedJapanPriceSortFixtureCountAcceptance(plan, {modelCoverageRequired, sourceCountRequired} = {}) {
  need([undefined, '0', '1'].includes(modelCoverageRequired)
    && [undefined, '0', '1'].includes(sourceCountRequired), 'count_acceptance_plan');
  const sourceBounded = japanSourceBoundedIncrementalRequired(plan), sourceCount = japanSourceCountRequired(plan);
  need((modelCoverageRequired === '1') === (sourceBounded || sourceCount)
    && (sourceCountRequired === '1') === sourceCount, 'count_acceptance_plan');
  return sourceCount ? JAPAN_SOURCE_COUNT_POLICY : sourceBounded ? JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY : undefined;
}

async function main() {
  const report = {version:1,kind:'japan-price-sort-browser-v1',passed:false,
    scope:'Exact runtime filter, count, card and append components; controlled local list transport; selected-city rendered prices',
    runtimeSha:null,runtimeTree:null,productionRequests:0,supplierRequests:0,forbiddenTransportAttempts:0,cases:[]};
  let fixture,browser,server,active;
  try {
    need(process.argv.length === 2, 'arguments');
    const plan = JSON.parse(await fs.readFile(path.join(ROOT,'.github/operations/catalog-next/china-code-serving-plan.json'),'utf8'));
    const countAcceptance = checkedJapanPriceSortFixtureCountAcceptance(plan,
      {modelCoverageRequired: process.env.CATALOG_JAPAN_MODEL_COVERAGE_REQUIRED,
        sourceCountRequired: process.env.CATALOG_JAPAN_SOURCE_COUNT_REQUIRED});
    const sourcePriceOrder = japanSourcePriceOrderRequirement(process.env.CATALOG_JAPAN_SOURCE_PRICE_ORDER_REQUIRED);
    need(sourcePriceOrder === japanSourcePriceOrderRequired(plan)
      && (!sourcePriceOrder || countAcceptance === JAPAN_SOURCE_COUNT_POLICY), 'source_price_plan');
    if (countAcceptance !== undefined) report.countAcceptance = countAcceptance;
    if (sourcePriceOrder) {
      report.japanSourcePriceOrderRequired = true;
      report.scope = 'Exact runtime components; controlled source JPY order across append, independent bounded counts and unchanged RUB estimates';
    }
    const resultFor = sourcePriceOrder ? sourcePriceFixtureResult : fixtureResult;
    fixture = await prepare(process.env.PHOTO_RUNTIME_ROOT, plan);
    Object.assign(report,{runtimeSha:plan.runtimeSha,runtimeTree:plan.runtimeTree,componentSha256:fixture.sources,styles:fixture.styles,
      controllerHelperSha256:hash(await fs.readFile(path.join(ROOT,'scripts/catalog-next/japan-price-sort-browser.mjs')))});
    if (sourcePriceOrder) report.sourcePriceHelperSha256 = hash(await fs.readFile(path.join(ROOT,'scripts/catalog-next/japan-source-price-order-browser.mjs')));
    need(path.isAbsolute(process.env.PLAYWRIGHT_MODULE || '') && path.isAbsolute(process.env.CHROME_BIN || ''), 'browser_environment');
    const pkg = JSON.parse(await fs.readFile(path.join(path.dirname(process.env.PLAYWRIGHT_MODULE),'package.json'),'utf8'));
    report.playwrightVersion = pkg.version;
    server = http.createServer(async(request,response) => {
      try {
        const url = new URL(request.url,ORIGIN);
        if(url.pathname==='/fixture.js'){response.writeHead(200,{'Content-Type':'application/javascript'});response.end(fixture.javascript);return;}
        if(url.pathname==='/fixture.css'){response.writeHead(200,{'Content-Type':'text/css'});response.end(fixture.css);return;}
        if(url.pathname==='/api/catalog/search'){
          const query=Object.fromEntries(url.searchParams);active.requests.push({...query});
          if(active.failAppend && Number(query.page)===3){response.writeHead(503,{'Content-Type':'application/json'});response.end('{"ok":false}');return;}
          if(active.holdNext && query.sort==='totalRubDesc' && Number(query.page)===1){active.held=true;await active.releaseWait;}
          response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(resultFor(query,active.now)));return;
        }
        if(url.pathname==='/api/catalog/brand-counts'){
          response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({counts:{TOYOTA:100},modelCounts:{TOYOTA:1},stale:false,generationId:active.now}));return;
        }
        if(url.pathname==='/api/catalog/source-models'){
          response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({version:1,models:[['TOYOTA','TEST',[],100]],stale:false}));return;
        }
        if(url.pathname==='/api/catalog/saved-previews'){
          const ids=(url.searchParams.get('ids')||'').split(',');
          need(ids.length>0&&ids.length<=50&&ids.every(id=>/^ajes-stats-sort-[123]-\d{1,2}$/.test(id)),'saved_preview_scope');
          response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({previews:Object.fromEntries(ids.map(id=>[id,null]))}));return;
        }
        if(url.pathname==='/api/catalog/rates'){
          response.writeHead(200,{'Content-Type':'application/json'});response.end('{"rates":[]}');return;
        }
        if(url.pathname.startsWith('/brand-logos/')){
          // Both source/model profiles' actual logo fallback must not be
          // activated by an invalid empty fixture image. Keep the same local
          // image path; no proxy or external transport is admitted.
          if(countAcceptance!==undefined){response.writeHead(200,{'Content-Type':'image/png'});response.end(LOCAL_BRAND_LOGO_PNG);}
          else{response.writeHead(204);response.end();}
          return;
        }
        need(url.pathname==='/cars/japan' && url.searchParams.size===1 && url.searchParams.get('city')===CITY,'document_scope');
        const initial={city:CITY,market:'japan'},result=resultFor(initial,active.now),props={initial,result,remount:active.remount,sourcePriceOrder};
        response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
        response.end('<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root">'
          +fixture.renderMarkup(props)+'</div><script>window.__japanPriceSortInitial='+JSON.stringify(props).replace(/</g,'\\u003c')
          +'</script><script async src="/fixture.js"></script></body></html>');
      }catch(error){active && (active.serverError=error.message);response.writeHead(400);response.end();}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const loopback='http://127.0.0.1:'+server.address().port;
    const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox','--disable-background-networking']});
    report.browserVersion=browser.version();
    for(const remount of [false,true]){
      active={remount,now:new Date().toISOString(),requests:[],failAppend:false,holdNext:false,held:false};
      active.releaseWait=new Promise(resolve=>{active.release=resolve;});
      const state=active,context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ru-RU',serviceWorkers:'block'});
      const errors=[],result={checks:{},screenshots:[],...(sourcePriceOrder?
        {countAcceptance,japanSourcePriceOrderRequired:true,japanPriceSortRequired:true}:{})};let currentPage;
      await context.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url());
        const allowed=request.method()==='GET'&&url.origin===ORIGIN&&(url.pathname==='/cars/japan'
          ||['/fixture.js','/fixture.css','/api/catalog/search','/api/catalog/brand-counts','/api/catalog/source-models','/api/catalog/saved-previews','/api/catalog/rates'].includes(url.pathname)
          ||url.pathname.startsWith('/brand-logos/'));
        if(!allowed){report.forbiddenTransportAttempts++;await route.abort('blockedbyclient');return;}
        let response;
        try{response=await route.fetch({url:loopback+url.pathname+url.search,maxRedirects:0,timeout:30_000});await route.fulfill({response});}
        finally{if(response)await response.dispose().catch(()=>{});}
      });
      try{
        // Keep the one actual page open for the failure and query-bound count
        // checks after the production acceptance helper's completed journey.
        const wrapped={newPage:async()=>{
          currentPage=await context.newPage();currentPage.on('pageerror',error=>errors.push(String(error.message)));
          const realClose=currentPage.close.bind(currentPage);currentPage.fixtureClose=realClose;
          return new Proxy(currentPage,{get(target,key){if(key==='close')return async()=>{};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
        }};
        const pages=await (sourcePriceOrder?runJapanSourcePriceOrderBrowser:runJapanPriceSortBrowser)({context:wrapped,report:result,countAcceptance,
          read:async api=>{const query=Object.fromEntries(new URL(api,ORIGIN).searchParams);return {status:200,data:resultFor(query,state.now)};},
          capture:async()=>{},onStage:stage=>{result.stage=stage;},onPage:()=>{},
          verifyPage:verifyJapanPage,verifyFullPage:verifyJapanFullPage,
          pageReadEvidence:japanPageReadEvidence,readSsrPageEvidence:readJapanSsrPageEvidence,
          verifyPowerPage:verifyJapanPowerPage,verifyVehiclePolicy:verifyJapanVisibleVehiclePolicy});
        need(result.japanPriceSortPassed && result.japanCountDisplayPassed,'complete_journey');
        if(sourcePriceOrder){result.checkedAt=new Date().toISOString();need(japanSourcePriceOrderAcceptancePassed(result),'source_price_proof');}
        const visibleOptions=sort=>({countAcceptance,...(sourcePriceOrder?
          {auctionDatabaseLabel:true,query:japanSourcePriceCountApi({power:true,countOnly:false})}:{sort})});
        const page=currentPage,prior=sourcePriceOrder
          ?[...resultFor({market:'japan',city:CITY,powerTo:'160',sort:'totalRub'},state.now).items,...pages.at(-1).items]
          :[...pages[2].items,...pages[3].items];
        result.stage='fixture_failed_append_retains_count';
        state.failAppend=true;
        const failed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/catalog/search'&&new URL(response.url()).searchParams.get('page')==='3');
        await page.locator('main.ac-ajes-catalog').getByRole('button',{name:'Показать ещё',exact:true}).click();
        need((await failed).status()===503,'failed_append_transport');
        await page.locator('main.ac-ajes-catalog [role="alert"]').waitFor({state:'visible',timeout:5000});
        const retained=await verifyJapanPriceSortVisible(page,prior,{total:null,hasMore:true},visibleOptions());
        need(retained.loaded===48,'failed_append_keeps_count');
        // Hold the next real filter response, proving cards/count persist while
        // the new draft is pending. Then a 24-row query must not inherit 48.
        result.stage='fixture_pending_query_retains_count';
        state.holdNext=true;
        const selection=selectJapanPriceSort(page,'totalRubDesc',{}, {sourcePriceOrder}).then(()=>({ok:true}),error=>({error}));
        await page.waitForFunction(()=>window.__japanPriceSort.calls.some(href=>new URL(href,location.origin).searchParams.get('sort')==='totalRubDesc')
          &&document.querySelector('form.ac-catalog-filter-panel[aria-busy="true"]'),undefined,{timeout:5000});
        need(await page.locator('[data-japan-loaded-count="48"]').count()===1
          &&await page.locator('main.ac-ajes-catalog article').count()===48,'pending_preserves_cards_count');
        state.release();const selected=await selection;if(selected.error)throw selected.error;
        const current=resultFor({market:'japan',city:CITY,powerTo:'160',sort:'totalRubDesc'},state.now);
        const reset=await verifyJapanPriceSortVisible(page,current.items,current,visibleOptions('totalRubDesc'));
        need(reset.loaded===24,'query_resets_loaded_count');
        result.stage='fixture_late_old_aggregate';
        await page.evaluate(({key})=>window.__japanPriceSort.late({queryKey:key,text:'999999',total:999999}),
          {key:JSON.stringify({city:CITY,powerTo:'160',sort:'totalRub',market:'japan'})});
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const afterLate=await verifyJapanPriceSortVisible(page,current.items,current,visibleOptions('totalRubDesc'));
        need(afterLate.loaded===24 && !afterLate.exact,'old_aggregate_ignored');
        need(errors.length===0 && (await page.evaluate(()=>window.__japanPriceSort.errors)).length===0 && !state.serverError,'javascript');
        report.cases.push({name:remount?'remounted_controls':'preserved_controls',passed:true,
          sequence:result.checks.priceSort.directions,powerSelectedThroughUi:true,countChecks:result.checks.countDisplay,
          ...(sourcePriceOrder?{sourcePriceOrderAcrossPages:true,rawJpyIncludingFractions:true,
            unknownPowerInterleaves:true,deliveredRubNotUsedForOrder:true}:{displayedCityPriceOrder:true,cityReversesBaseOrder:true}),
          failedAppendKeeps48:true,pendingKeeps48:true,
          changedQueryRestartsAt24:true,lateOldAggregateIgnored:true,pageErrors:0,requests:state.requests.length,
          helperChecks:result.checks.priceSort});
      }catch(error){
        report.failure={case:remount?'remounted_controls':'preserved_controls',stage:result.stage,
          progress:result.checks.priceSortProgress};
        if(currentPage&&!currentPage.isClosed())report.failure.controls=await currentPage.evaluate(()=>{
          const describe=node=>node?{tag:node.tagName.toLowerCase(),className:String(node.className).slice(0,240),
            name:node.getAttribute('name'),ariaLabel:node.getAttribute('aria-label')?.slice(0,160)}:null;
          const inspect=selector=>{
            const element=document.querySelector(selector);if(!element)return null;
            const rect=element.getBoundingClientRect(),style=getComputedStyle(element);
            return {element:describe(element),rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
              style:{position:style.position,right:style.right,display:style.display,pointerEvents:style.pointerEvents},
              hit:describe(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2))};
          };
          return {power:inspect('form.ac-catalog-filter-panel input[name="powerTo"][value="160"]'),
            help:inspect('form.ac-catalog-filter-panel .ac-power-help'),
            sort:inspect('form.ac-catalog-filter-panel .ac-sidebar-sort button[aria-label^="Сортировка: "]')};
        }).catch(()=>({unavailable:true}));
        throw error;
      }finally{state.release();await context.close();}
    }
    need(report.cases.length===2&&report.cases.every(value=>value.passed)&&report.forbiddenTransportAttempts===0,'complete');
    report.passed=true;
  }catch(error){
    const message=String(error?.message||'');
    report.error={code:/^japan_(?:price_sort_fixture|browser)[a-z_]+$/.test(message)?message:'japan_price_sort_fixture_failed',
      message:message.length<=8000?message:message.slice(0,6000)+'\n[bounded call log omitted]\n'+message.slice(-2000),
      messageTruncated:message.length>8000,serverCode:active?.serverError};process.exitCode=1;}
  finally{
    if(browser)await browser.close().catch(()=>{});
    if(server)await new Promise(resolve=>server.close(resolve));
    if(fixture)await fs.rm(fixture.temporary,{recursive:true,force:true});
    const output=process.env.JAPAN_PRICE_SORT_REPORT;
    if(output){need(path.isAbsolute(output),'report_path');await fs.writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}
    console.log(JSON.stringify(report));
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();


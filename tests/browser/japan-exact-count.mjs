import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import {runJapanPriceSortBrowser, selectJapanPriceSort, verifyJapanPriceSortVisible, japanPriceSortApi}
  from '../../scripts/catalog-next/japan-price-sort-browser.mjs';
import {verifyJapanPage, verifyJapanFullPage, verifyJapanPowerPage, verifyJapanVisibleVehiclePolicy}
  from '../../scripts/catalog-next/japan-browser-acceptance.mjs';

import {runJapanExactCountBrowser, runJapanModelCoverageBrowser, japanExactCountQueryHash,
  verifyJapanFiniteSelection, JAPAN_SOURCE_BOUNDED_COUNT_ACCEPTANCE}
  from '../../scripts/catalog-next/japan-exact-count-browser.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ORIGIN = 'https://avtocena.com', CITY = 'Новокузнецк';
// A local, decodable 1x1 RGBA image for the fixture's existing brand-logo paths.
// An empty HTTP204 is an image error and triggers the real component's API fallback.
const LOCAL_BRAND_LOGO_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNoaGj4DwAFhAKAjM1mJgAAAABJRU5ErkJggg==','base64');
const need = (value, code) => { if (!value) throw Error('japan_exact_count_fixture_' + code); };
const hash = value => createHash('sha256').update(value).digest('hex');
const require = createRequire(import.meta.url);
const runtimeFiles = {
  CatalogFilters: 'apps/web/components/catalog/CatalogFilters.tsx',
  CatalogLoadMore: 'apps/web/components/catalog/CatalogLoadMore.tsx',
  CatalogCard: 'apps/web/components/catalog/CatalogCard.tsx',
  JapanCatalogCount: 'apps/web/components/catalog/JapanCatalogCount.tsx',
  CatalogSelectionContext: 'apps/web/components/catalog/CatalogSelectionContext.tsx',
  CatalogSidebar: 'apps/web/components/catalog/CatalogSidebar.tsx',
  CatalogRoutes: 'apps/web/lib/catalog/catalog-routes.ts',
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
import {catalogRouteParams} from 'runtime:CatalogRoutes';
import {CatalogResultCountUpdate} from 'runtime:CatalogSelectionContext';
export function ExactCountFixture({initial,result,remount=false}){
 const [current,setCurrent]=useState({initial,result}),[late,setLate]=useState(null);
 const query=current.initial,rows=current.result.items,key=JSON.stringify(query);
 const models=[...new Map(rows.map(row=>[JSON.stringify([row.make,row.model]),{make:row.make,model:row.model,total:0}])).values()];
 useEffect(()=>{
  const fixture=window.__japanExactCount;
  fixture.replace=(next)=>{fixture.current=next;setCurrent(next);};fixture.current=current;fixture.late=(next)=>setLate(next);fixture.ready=true;
 },[]);
 return <main className="ac-catalog-page ac-page-copy ac-ajes-catalog min-h-screen text-[var(--ac-text)]">
  <section className="ac-catalog-shell mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-10">
   <CatalogSidebar resultScope="ajes:japan:false"
    header={<h1 className="text-[30px] font-black leading-none tracking-[-0.04em] sm:text-4xl md:text-6xl">Авто из Японии под заказ</h1>}
    filters={<CatalogFilters key={remount?key:'preserved'} initial={query} auctionResults facets={{makes:[],models,bodyTypes:[],transmissions:[],fuels:['petrol'],drives:[]}}/>}>
   {late&&<CatalogResultCountUpdate {...late}/>}
   <CatalogResultCountUpdate queryKey={key} summary={current.result.countSummary} total={current.result.total??undefined} text={current.result.total===null?'':String(current.result.total)}/>
   <h2>Япония <JapanCatalogCount queryKey={key} summary={current.result.countSummary} initialCount={rows.length}/></h2>
   <CatalogLoadMore key={key} query={query} resultQueryKey={key} initialPage={current.result.page}
    initialTotal={current.result.total} initialCount={rows.length} initialHasMore={current.result.hasMore}
    initialNextCursor={current.result.nextCursor} initialPageKey={JSON.stringify([key,rows.map(row=>row.id)])}
    initialCards={rows.map(offer=><CatalogCard key={offer.id} offer={offer} compact dense/>)}/>
   </CatalogSidebar>
  </section>
 </main>;
}
if(typeof window!=='undefined'){
 const fixture={calls:[],errors:[],ready:false,sequence:0,delayedModelResponses:0,completedModelDelays:0,
  cardFallbackOptionsBeforeDirectory:0,replace:()=>{},late:()=>{},async navigate(href){
  const sequence=++fixture.sequence;fixture.calls.push(href);history.pushState(null,'',href);
  const url=new URL(href,location.origin);
  const query={...Object.fromEntries(url.searchParams),...catalogRouteParams(url.pathname),market:'japan'};
  const response=await fetch('/api/catalog/search?'+new URLSearchParams({...query,page:'1',pageSize:'24'}));
  const result=await response.json();
  if(sequence===fixture.sequence&&response.ok)fixture.replace({initial:query,result});
 }};
 window.__japanExactCount=fixture;
 if(window.__japanExactCountInitial.modelCoverage){
  const read=window.fetch.bind(window);
  window.fetch=async(...args)=>{
   const response=await read(...args);
   if(new URL(args[0]?.url||String(args[0]),location.origin).pathname==='/api/catalog/source-models'){
    // Playwright has observed the response, but the real loader has not yet
    // consumed it. Actual card facets must not satisfy directory readiness.
    fixture.delayedModelResponses++;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    fixture.cardFallbackOptionsBeforeDirectory=[...document.querySelectorAll('button[data-model-value][data-model-make]')]
      .filter(node=>node.getClientRects().length>0).length;
    await new Promise(resolve=>setTimeout(resolve,250));
    fixture.completedModelDelays++;
   }
   return response;
  };
 }
 hydrateRoot(document.getElementById('root'),<ExactCountFixture {...window.__japanExactCountInitial}/>,
  {onRecoverableError:error=>fixture.errors.push(String(error))});
}
`;

export async function prepare(runtimeRoot, plan) {
  need(path.isAbsolute(runtimeRoot || '') && runtimeRoot !== ROOT.replace(/\/$/, ''), 'runtime_root');
  const git = args => execFileSync('git', ['-C', runtimeRoot, ...args], {encoding: 'utf8', timeout: 30_000}).trim();
  need(git(['rev-parse', 'HEAD']) === plan.runtimeSha && git(['rev-parse', 'HEAD^{tree}']) === plan.runtimeTree, 'runtime_binding');
  const sources = {};
  const verifySource = async file => {
    const raw = await fs.readFile(path.join(runtimeRoot, file));
    const committed = execFileSync('git', ['-C', runtimeRoot, 'show', plan.runtimeSha + ':' + file], {timeout: 30_000});
    need(raw.equals(committed), 'runtime_component_changed'); sources[file] = hash(raw);
  };
  for (const file of [...Object.values(runtimeFiles), ...extraFiles, ...layoutStyles]) await verifySource(file);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'japan-exact-count-'));
  const transport = {name: 'exact-runtime-exact-count-components', setup(builder) {
    builder.onResolve({filter: /^fixture:exact-count$/}, () => ({path: 'exact-count', namespace: 'fixture'}));
    builder.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: fixtureSource, loader: 'tsx', resolveDir: runtimeRoot}));
    builder.onResolve({filter: /^runtime:/}, args => {
      const file = runtimeFiles[args.path.slice('runtime:'.length)]; need(file, 'component_scope'); return {path: path.join(runtimeRoot, file)};
    });
    builder.onResolve({filter: /^next\/(navigation|link|image)$/}, args => ({path: args.path, namespace: 'next-fixture'}));
    builder.onLoad({filter: /.*/, namespace: 'next-fixture'}, args => ({loader: 'js', resolveDir: runtimeRoot,
      contents: args.path.endsWith('navigation')
        ? `const router={push(href){void window.__japanExactCount.navigate(href)},replace(href){history.replaceState(null,'',href)},prefetch(){},refresh(){}};export const useRouter=()=>router;export const usePathname=()=>typeof location==='undefined'?'/cars/japan':location.pathname;export const useSearchParams=()=>new URLSearchParams(typeof location==='undefined'?'':location.search);`
        : args.path.endsWith('image')
          ? `import React from 'react';export default function Image({priority,unoptimized,fill,loader,...props}){return React.createElement('img',props)}`
          : `import React from 'react';export default function Link({children,prefetch,...props}){return React.createElement('a',props,children)}`,
    }));
  }};
  try {
    const common = {absWorkingDir: runtimeRoot, bundle: true, jsx: 'automatic', logLevel: 'silent', metafile: true,
      tsconfig: path.join(runtimeRoot, 'apps/web/tsconfig.json'),
      define: {'process.env.NODE_ENV': '"production"', 'process.env': '{}'}, plugins: [transport]};
    const browserBuild = await build({...common, stdin: {contents: "import 'fixture:exact-count';", resolveDir: runtimeRoot},
      platform: 'browser', format: 'iife', outfile: path.join(temporary, 'fixture.js')});
    await build({...common, stdin: {contents: "import React from 'react';import {renderToString} from 'react-dom/server';import {ExactCountFixture} from 'fixture:exact-count';export const render=(props)=>renderToString(React.createElement(ExactCountFixture,props));", resolveDir: runtimeRoot, loader: 'tsx'},
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

const familyNames = ['A4 AVANT', 'A4 ALLROAD', 'A-4', 'A 4', 'Ａ４', 'A4L',
  ...Array.from({length: 24}, (_, index) => 'A4 EDITION ' + String(index + 1).padStart(2, '0'))];
const otherNames = ['A40', 'RS4', ...Array.from({length: 62}, (_, index) => 'A5 SERIES ' + String(index + 1).padStart(2, '0'))];
export const EXACT_FIXTURE_IDS = Object.freeze(Array.from({length: 73}, (_, index) => 'ajes-stats-exact-' + index));
export const BUDGET_FIXTURE_IDS = Object.freeze([0, 1, ...Array.from({length: 36}, (_, index) => index + 14)]
  .map(index => 'ajes-stats-exact-' + index));

export function fixtureRows(now) {
  return Array.from({length: 147}, (_, index) => {
    const id = 'ajes-stats-exact-' + index, unknown = index >= 50 && index < 73;
    const power = index < 50 ? 150 : 210;
    const base = index === 0 ? 950_000 : index === 1 ? 900_000 : 1_050_000 + (147 - index) * 1000;
    return {id,sourceId:'ajes_japan_feed',sourceOfferId:'exact-'+index,market:'japan',
      offerType:'auction',status:'sold',catalogKind:'auction_result',auctionResult:'sold',auctionPriceKind:'hammer',
      make:'AUDI',model:index<83?familyNames[index%familyNames.length]:otherNames[index-83],
      year:2022,mileageKm:50000,engineCc:1500,fuel:'petrol',transmission:'automatic',drive:'fwd',bodyType:'sedan',
      sourcePrice:500000,sourceCurrency:'JPY',priceMode:'auction_start',catalogPricingMode:'seller',sellerPriceRub:300000,
      calculationSnapshot:{currencyRate:{currency:'JPY',sourcePrice:500000,effectiveRate:0.6,rateSource:'cbr',rateDate:now.slice(0,10),sourcePriceRub:300000}},
      totalRub:null,calculationStatus:'needs_data',images:[],firstSeenAt:now,updatedAt:now,
      japanDeliveredPreview:unknown?null:{totalRub:base,engineCc:1500,powerHp:power,
        deliveryPricingBasis:{subtotalRub:base,deliveryRub:index===0?100000:0,percents:[]}},
      ...(unknown?{japanPowerUnknown:true}:{japanSupplierPower:{offerId:id,hp:power,unit:'hp',source:'ajes_pw'}}),
      operational:{semanticEvidence:{engineCc:{status:'exact',value:1500,source:'ajes:stats:exact:ENG_V',rawValues:['1500']},
        fuel:{status:'exact',value:'petrol',source:'ajes:stats:exact:TIME',rawValues:['P']}}}};
  });
}

export function fixtureDirectory(now) {
  const counts = new Map();
  for (const row of fixtureRows(now)) counts.set(row.model, (counts.get(row.model) || 0) + 1);
  return {version:1,brands:[],stale:false,models:[...counts].map(([model,total])=>['AUDI',model,[],total])};
}

/** This finite controlled source has 73 admitted power-filtered rows. Its
 * expected ID set is independent of the pagination/sort implementation below.
 * Positive v1 proofs here are UI-contract mocks. They do not establish backend
 * census acceptance or impersonate the production zero-v2 producer, whose
 * positive-source path remains closed without a coherent source contract. */
export function fixtureResult(query, now) {
  const page=Number(query.page||1),sort=query.sort||'';
  need(Number.isSafeInteger(page)&&page>0&&['','totalRub','totalRubDesc'].includes(sort)
    &&query.market==='japan'&&query.city===CITY&&(!query.make||['AUDI','Audi'].includes(query.make))
    &&(!query.model||query.model==='A4')&&(!query.powerTo||query.powerTo==='160'),'data_query');
  const budget=query.budgetTo||query.budget;
  need(!budget||/^[1-9]\d{0,7}$/.test(budget)&&Number(budget)<=30_000_000,'data_budget');
  const source=fixtureRows(now).filter(row=>!query.model||familyNames.includes(row.model));
  let selected=query.powerTo?source.filter(row=>row.japanPowerUnknown||row.japanSupplierPower.hp<=160):source;
  // The controlled source has one explicit delivery basis: the actual runtime
  // component adds 120000 for this city. Its two inversion rows exercise a
  // different already-included delivery amount. No source/engine formula is
  // replaced; the fixture's known price set is an independent UI oracle.
  if(budget)selected=selected.filter(row=>row.japanDeliveredPreview
    &&row.japanDeliveredPreview.totalRub-row.japanDeliveredPreview.deliveryPricingBasis.deliveryRub+120_000<=Number(budget));
  if(query.powerTo)selected=[...selected.filter(row=>!row.japanPowerUnknown),...selected.filter(row=>row.japanPowerUnknown)];
  const total=selected.length,offset=(page-1)*24;
  need(offset<total||total===0&&page===1,'data_page');
  const items=selected.slice(offset,offset+24),hasMore=offset+items.length<total;
  if(sort)items.sort((a,b)=>{
    if(Boolean(a.japanPowerUnknown)!==Boolean(b.japanPowerUnknown))return a.japanPowerUnknown?1:-1;
    const amount=row=>row.japanDeliveredPreview?row.japanDeliveredPreview.totalRub-row.japanDeliveredPreview.deliveryPricingBasis.deliveryRub:null;
    const left=amount(a),right=amount(b);
    if(left===null||right===null)return left===right?0:left===null?1:-1;
    return (sort==='totalRubDesc'?-1:1)*(left-right);
  });
  const requestedQueryHash=japanExactCountQueryHash(query),evidenceEpoch=hash('finite-fixture-exact-count-evidence-v1');
  const cursorQuery=hash(JSON.stringify([requestedQueryHash,sort]));
  const nextUnknown=hasMore&&selected[offset+items.length].japanPowerUnknown===true;
  const unknownShown=selected.slice(0,offset+items.length).filter(row=>row.japanPowerUnknown).length;
  const skip=nextUnknown?unknownShown%24:0,sourcePage=nextUnknown?Math.floor(unknownShown/24)+1:page+1;
  const membership=skip?hash(JSON.stringify(selected.filter(row=>row.japanPowerUnknown).slice(0,24).map(row=>row.id))):'-';
  const nextCursor=hasMore?`j2.${nextUnknown?'u':'k'}.${sourcePage}.${skip}.${page+1}.${cursorQuery}.${evidenceEpoch}.${membership}`:null;
  const grouped=new Map();for(const row of source)grouped.set(row.model,(grouped.get(row.model)||0)+1);
  const proof={version:1,kind:'japan-admitted-census',predicateVersion:'japan-admitted-census-v1',complete:true,
    requestedQueryHash,queryHash:hash(JSON.stringify([requestedQueryHash,'finite-source-resolution'])),evidenceEpoch,
    sourceObservedAt:now,sourceCompletedAt:now,sourceTotal:source.length,sourceDistinctTotal:source.length,groupedTotal:source.length,
    baseAdmittedTotal:total,admittedTotal:total,groupCount:grouped.size,pages:1,
    sourceQueryHash:hash(JSON.stringify(source.map(row=>row.id))),coverageHash:hash(JSON.stringify([...grouped].sort())),
    correctionCount:0,correctionDelta:0,knownTotal:selected.filter(row=>!row.japanPowerUnknown).length,
    unknownTotal:selected.filter(row=>row.japanPowerUnknown).length};
  return {ok:true,page,pageSize:24,items,received:items.length,total,hasMore,nextCursor,
    stale:false,partial:false,interrupted:false,scanLimited:false,observedAt:now,generationId:now,
    countSummary:{total,upperBound:false,stale:false,observedAt:now,countProof:proof},
    ...(query.powerTo?{powerFilterSummary:{shown:items.length,localPower:0,
      supplierPower:items.filter(row=>!row.japanPowerUnknown).length,unknownPower:items.filter(row=>row.japanPowerUnknown).length}}:{})};
}

/** One displayed identity is canonically cased by the public offer path while
 * the source directory preserves its literal name. Its exact option pair is
 * therefore backed by a visible card, but is absent from the directory. */
export function modelCoverageFixtureResult(query, now) {
  const result = fixtureResult(query, now);
  return {...result, total: null, countSummary: null,
    items: result.items.map(row => row.id === EXACT_FIXTURE_IDS[0] ? {...row, make: 'Audi'} : row)};
}

/** Record only bounded public call-site fields. Every denied attempt still
 * increments the guard, even after the diagnostic sample is full. */
export function recordForbiddenFixtureRequest(report,{caseName,stage,method,url,resourceType}) {
  report.forbiddenTransportAttempts++;
  const entries=report.forbiddenRequests??=[];
  if(entries.length>=16){report.forbiddenRequestDiagnosticsOmitted=(report.forbiddenRequestDiagnosticsOmitted||0)+1;return;}
  let originCategory='invalid',hostname='',pathname='';
  try {
    const parsed=new URL(url);
    if(parsed.protocol==='https:'||parsed.protocol==='http:'){
      originCategory=parsed.origin===ORIGIN?'fixture_origin':'external_http';
      hostname=parsed.hostname.slice(0,253);pathname=parsed.pathname.slice(0,320);
    }else originCategory='non_http';
  }catch{}
  const bounded=(value,limit)=>String(value||'unknown').replace(/[\u0000-\u001f\u007f]/g,'_').slice(0,limit);
  entries.push({case:bounded(caseName,40),stage:bounded(stage,120),method:bounded(method,16),
    originCategory,hostname,pathname,resourceType:bounded(resourceType,32)});
}

export function createExactCountFixtureHandler({fixture,getActive}) {
  return async(request,response)=>{
    const active=getActive();let url,stage='route';
    // Arguments, including rendered/serialized bodies, are evaluated before
    // this function commits the success status. A guard/SSR failure stays HTTP400.
    const send=(status,headers,body)=>{response.writeHead(status,headers);response.end(body);};
      try {
        url=new URL(request.url,ORIGIN);
        if(url.pathname==='/fixture.js'){send(200,{'Content-Type':'application/javascript'},fixture.javascript);return;}
        if(url.pathname==='/fixture.css'){send(200,{'Content-Type':'text/css'},fixture.css);return;}
        if(url.pathname==='/api/catalog/search'){
          stage='search_payload';
          const query=Object.fromEntries(url.searchParams);active.requests.push({...query});
          if(Number(query.page)>1){const prior=fixtureResult({...query,page:String(Number(query.page)-1)},active.now);need(query.after===prior.nextCursor,'emitted_cursor');}
          if(active.failAppend&&Number(query.page)===3){send(503,{'Content-Type':'application/json'},'{"ok":false}');return;}
          if(active.holdNext&&query.sort==='totalRubDesc'&&Number(query.page)===1){active.held=true;await active.releaseWait;}
          const result=active.modelCoverage?modelCoverageFixtureResult(query,active.now):fixtureResult(query,active.now);
          send(200,{'Content-Type':'application/json','Cache-Control':'no-store'},JSON.stringify(result));return;
        }
        if(url.pathname==='/api/catalog/brand-counts'){
          stage='brand_payload';
          send(200,{'Content-Type':'application/json'},JSON.stringify({counts:{AUDI:147},modelCounts:{AUDI:fixtureDirectory(active.now).models.length},stale:false,generationId:active.now}));return;
        }
        if(url.pathname==='/api/catalog/source-models'){
          stage='model_payload';
          need(url.searchParams.get('market')==='japan'&&['AUDI','Audi'].includes(url.searchParams.get('make')),'model_scope');
          send(200,{'Content-Type':'application/json'},JSON.stringify(fixtureDirectory(active.now)));return;
        }
        if(url.pathname==='/api/catalog/saved-previews'){
          stage='preview_payload';
          const ids=(url.searchParams.get('ids')||'').split(',');
          need(ids.length>0&&ids.length<=50&&ids.every(id=>/^ajes-stats-exact-\d{1,3}$/.test(id)),'saved_preview_scope');
          send(200,{'Content-Type':'application/json'},JSON.stringify({previews:Object.fromEntries(ids.map(id=>[id,null]))}));return;
        }
        if(url.pathname==='/api/catalog/rates'){
          send(200,{'Content-Type':'application/json'},'{"rates":[]}');return;
        }
        if(url.pathname.startsWith('/brand-logos/')){send(200,{'Content-Type':'image/png'},LOCAL_BRAND_LOGO_PNG);return;}
        stage='document_scope';
        need(url.pathname==='/cars/japan'&&url.searchParams.get('city')===CITY
          &&(url.searchParams.size===1||active.recoverCount&&url.searchParams.size===2&&url.searchParams.get('powerTo')==='160'),'document_scope');
        const initial={city:CITY,market:'japan',...(active.recoverCount?{powerTo:'160'}:{})};
        const result=active.modelCoverage?modelCoverageFixtureResult(initial,active.now):fixtureResult(initial,active.now);
        if(active.recoverCount){result.total=null;result.countSummary=null;}
        const props={initial,result,remount:active.remount,modelCoverage:active.modelCoverage===true};
        stage='document_render';
        const body='<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root">'
          +fixture.renderMarkup(props)+'</div><script>window.__japanExactCountInitial='+JSON.stringify(props).replace(/</g,'\\u003c')
          +'</script><script async src="/fixture.js"></script></body></html>';
        send(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'},body);
      }catch(error){
        const message=String(error?.message||'unknown_server_error');
        const code=/^[a-z][a-z0-9_]{0,159}$/.test(message)?message:'unexpected_server_error';
        const safeKeys=['market','city','make','model','powerTo','sort','page','pageSize','marketPage','budget','budgetTo'];
        const failure={stage,path:['/cars/japan','/api/catalog/search','/api/catalog/brand-counts','/api/catalog/source-models',
          '/api/catalog/saved-previews','/api/catalog/rates'].includes(url?.pathname)?url.pathname:'other',code,
          query:Object.fromEntries([...(url?.searchParams||[])].filter(([key])=>safeKeys.includes(key)).map(([key,value])=>[key,value.slice(0,160)])),
          ...(url?.searchParams.has('after')?{afterSha256:hash(url.searchParams.get('after'))}:{}),
          ...(code===message?{}:{message:message.replace(/https?:\/\/[^\s]+/g,'[url]').slice(0,500)})};
        if(active){active.serverError??=code;active.serverFailure??=failure;}
        if(response.writableEnded||response.destroyed)return;
        if(!response.headersSent)response.writeHead(400,{'Content-Type':'application/json'});
        response.end(JSON.stringify({ok:false,error:code}));
      }
  };
}

async function main() {
  const report={version:1,kind:'japan-exact-count-browser-v1',passed:false,
    scope:'Exact runtime UI components and styles; finite controlled v1 count-proof mocks; no live source or backend census acceptance',
    countProofContract:'controlled-ui-mock-v1',liveSourceAccepted:false,backendCensusAccepted:false,
    runtimeSha:null,runtimeTree:null,productionRequests:0,supplierRequests:0,forbiddenTransportAttempts:0,
    forbiddenRequests:[],forbiddenRequestDiagnosticsOmitted:0,cases:[]};
  let fixture,browser,server,active;
  try {
    need(process.argv.length===2,'arguments');
    const plan=JSON.parse(await fs.readFile(path.join(ROOT,'.github/operations/catalog-next/china-code-serving-plan.json'),'utf8'));
    fixture=await prepare(process.env.PHOTO_RUNTIME_ROOT,plan);
    const helperFiles=['scripts/catalog-next/japan-exact-count-browser.mjs','scripts/catalog-next/japan-price-sort-browser.mjs',
      'scripts/catalog-next/japan-browser-acceptance.mjs'];
    Object.assign(report,{runtimeSha:plan.runtimeSha,runtimeTree:plan.runtimeTree,componentSha256:fixture.sources,styles:fixture.styles,
      helperSha256:Object.fromEntries(await Promise.all(helperFiles.map(async file=>[file,hash(await fs.readFile(path.join(ROOT,file)))])))});
    need(path.isAbsolute(process.env.PLAYWRIGHT_MODULE||'')&&path.isAbsolute(process.env.CHROME_BIN||''),'browser_environment');
    report.playwrightVersion=JSON.parse(await fs.readFile(path.join(path.dirname(process.env.PLAYWRIGHT_MODULE),'package.json'),'utf8')).version;
    server=http.createServer(createExactCountFixtureHandler({fixture,getActive:()=>active}));
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const loopback='http://127.0.0.1:'+server.address().port;
    const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox','--disable-background-networking']});
    report.browserVersion=browser.version();
    for(const remount of [false,true]) {
      active={remount,now:new Date().toISOString(),requests:[],failAppend:false,holdNext:false,held:false};
      active.releaseWait=new Promise(resolve=>{active.release=resolve;});
      const state=active,context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ru-RU',serviceWorkers:'block'});
      const errors=[],result={checks:{},screenshots:[]};let currentPage;
      await context.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url());
        const allowed=request.method()==='GET'&&url.origin===ORIGIN&&(url.pathname==='/cars/japan'
          ||['/fixture.js','/fixture.css','/api/catalog/search','/api/catalog/brand-counts','/api/catalog/source-models','/api/catalog/saved-previews','/api/catalog/rates'].includes(url.pathname)
          ||url.pathname.startsWith('/brand-logos/'));
        if(!allowed){
          recordForbiddenFixtureRequest(report,{caseName:remount?'remounted_controls':'preserved_controls',stage:result.stage,
            method:request.method(),url:url.href,resourceType:request.resourceType()});
          await route.abort('blockedbyclient');return;
        }
        let response;
        try{response=await route.fetch({url:loopback+url.pathname+url.search,maxRedirects:0,timeout:30_000});await route.fulfill({response});}
        finally{if(response)await response.dispose().catch(()=>{});}
      });
      try {
        const wrapped={newPage:async()=>{
          currentPage=await context.newPage();currentPage.on('pageerror',error=>errors.push(String(error.message)));
          return new Proxy(currentPage,{get(target,key){if(key==='close')return async()=>{};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
        }};
        const callbacks={context:wrapped,report:result,read:async api=>{
          const url=new URL(api,ORIGIN);
          const data=url.pathname==='/api/catalog/source-models'?fixtureDirectory(state.now)
            :(state.modelCoverage?modelCoverageFixtureResult:fixtureResult)(Object.fromEntries(url.searchParams),state.now);
          return {status:200,data};
        },capture:async()=>{},onStage:stage=>{result.stage=stage;},onPage:()=>{},
          verifyPage:verifyJapanPage,verifyFullPage:verifyJapanFullPage,verifyPowerPage:verifyJapanPowerPage,
          verifyVehiclePolicy:verifyJapanVisibleVehiclePolicy};
        const pages=await runJapanPriceSortBrowser({...callbacks,requireExactCount:true});
        need(result.japanPriceSortPassed&&result.japanCountDisplayPassed,'price_journey');
        const page=currentPage,prior=[...pages[2].items,...pages[3].items];
        result.stage='fixture_failed_append';state.failAppend=true;
        const failed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/catalog/search'&&new URL(response.url()).searchParams.get('page')==='3');
        await page.locator('main.ac-ajes-catalog').getByRole('button',{name:'Показать ещё',exact:true}).click();
        need((await failed).status()===503,'failed_append_transport');
        await page.locator('main.ac-ajes-catalog [role="alert"]').waitFor({state:'visible',timeout:5000});
        const retained=await verifyJapanPriceSortVisible(page,prior,pages[3],{requireExactCount:true,query:japanPriceSortApi('totalRub')});
        need(retained.loaded===48&&retained.exactProof.total===73,'failed_append_count');
        const oldKey=await page.evaluate(()=>JSON.stringify(window.__japanExactCount.current.initial));
        state.failAppend=false;state.holdNext=true;result.stage='fixture_pending_sort';
        const selection=selectJapanPriceSort(page,'totalRubDesc',{}).then(()=>({ok:true}),error=>({error}));
        await page.waitForFunction(()=>document.querySelector('form.ac-catalog-filter-panel[aria-busy="true"]'),undefined,{timeout:5000});
        need(await page.locator('[data-japan-loaded-count="48"] [data-catalog-market-count="73"]').count()===1
          &&await page.locator('main.ac-ajes-catalog article').count()===48,'pending_count');
        state.release();const selected=await selection;if(selected.error)throw selected.error;state.holdNext=false;
        const query={market:'japan',city:CITY,powerTo:'160',sort:'totalRubDesc'};
        const first=fixtureResult(query,state.now);
        const reset=await verifyJapanPriceSortVisible(page,first.items,first,{sort:'totalRubDesc',requireExactCount:true,query});
        need(reset.loaded===24&&reset.exactProof.total===73,'reset_count');
        const oldSummary={...pages[3].countSummary,total:999999,countProof:{...pages[3].countSummary.countProof,
          sourceTotal:999999,sourceDistinctTotal:999999,groupedTotal:999999,baseAdmittedTotal:999999,admittedTotal:999999,knownTotal:999999,unknownTotal:0}};
        await page.evaluate(({key,summary})=>window.__japanExactCount.late({queryKey:key,summary,text:'999999',total:999999}),{key:oldKey,summary:oldSummary});
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        await verifyJapanPriceSortVisible(page,first.items,first,{requireExactCount:true,query});
        result.stage='fixture_finite_exhaustion';
        const finite=[first];let loaded=[...first.items];
        while(finite.at(-1).hasMore){
          const nextPage=finite.length+1,after=finite.at(-1).nextCursor;
          need(nextPage<=Math.ceil(EXACT_FIXTURE_IDS.length/24),'finite_bound');
          const appended=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/catalog/search'
            &&new URL(response.url()).searchParams.get('page')===String(nextPage));
          await page.locator('main.ac-ajes-catalog').getByRole('button',{name:'Показать ещё',exact:true}).click();
          need((await appended).status()===200,'finite_http');
          const next=fixtureResult({...query,page:String(nextPage),after},state.now);finite.push(next);loaded.push(...next.items);
          await verifyJapanPriceSortVisible(page,loaded,next,{requireExactCount:true,query});
        }
        const finiteProof=verifyJapanFiniteSelection(finite,{expectedIds:EXACT_FIXTURE_IDS,query});
        need(await page.locator('main.ac-ajes-catalog').getByRole('button',{name:'Показать ещё',exact:true}).count()===0,'finite_no_more');
        need((await page.evaluate(()=>window.__japanExactCount.errors)).length===0,'finite_hydration');
        await page.close();
        const audiPages=await runJapanExactCountBrowser({...callbacks,verifyVisible:verifyJapanPriceSortVisible});
        need(result.japanExactCountPassed&&result.japanModelCoveragePassed&&result.checks.modelCoverage.sourcePairs>60,'exact_journey');
        const budgetQuery={market:'japan',city:CITY,make:'AUDI',model:'A4',powerTo:'160',budgetTo:'1303000'};
        const budgetPages=audiPages.filter(value=>value.countSummary.countProof.requestedQueryHash===japanExactCountQueryHash(budgetQuery));
        const budgetFinite=verifyJapanFiniteSelection(budgetPages,{expectedIds:BUDGET_FIXTURE_IDS,query:budgetQuery});
        need(budgetFinite.total===38&&budgetFinite.pageSizes.join(',')==='24,14','budget_finite');
        need((await currentPage.evaluate(()=>window.__japanExactCount.errors)).length===0,'model_hydration');
        const oldBudgetKey=await currentPage.evaluate(()=>JSON.stringify(window.__japanExactCount.current.initial));
        await currentPage.close();

        // Exercise the independent release branch with no positive aggregate
        // supplied to SSR, the real controls, or the explicit API verifier.
        state.modelCoverage=true;result.stage='fixture_incremental_models';
        const modelReport={checks:{},screenshots:[]};let positiveExactCountsSupplied=0;
        const modelPages=await runJapanModelCoverageBrowser({...callbacks,report:modelReport,
          read:async api=>{const value=await callbacks.read(api);
            if(Array.isArray(value.data.items)&&value.data.total!==null)positiveExactCountsSupplied++;
            return value;},verifyVisible:verifyJapanPriceSortVisible});
        const countsIncomplete=modelPages.length===2&&modelPages.every(value=>value.total===null&&value.countSummary===null);
        need(modelReport.countAcceptance===JAPAN_SOURCE_BOUNDED_COUNT_ACCEPTANCE
          &&modelReport.japanModelCoveragePassed===true&&modelReport.japanExactCountPassed===null
          &&positiveExactCountsSupplied===0&&countsIncomplete,'incremental_model_journey');
        const directoryWait=await currentPage.evaluate(()=>({delayedResponses:window.__japanExactCount.delayedModelResponses,
          completedDelays:window.__japanExactCount.completedModelDelays,
          cardFallbackOptionsBeforeDirectory:window.__japanExactCount.cardFallbackOptionsBeforeDirectory}));
        need(directoryWait.delayedResponses>0&&directoryWait.delayedResponses===directoryWait.completedDelays
          &&directoryWait.cardFallbackOptionsBeforeDirectory>0&&directoryWait.cardFallbackOptionsBeforeDirectory<=24
          &&modelReport.checks.modelCoverageProgress.directoryOptionsReady===true,'incremental_directory_wait');
        need(modelReport.checks.modelCoverage.cardBackedExtraPairs===1
          &&modelReport.checks.modelCoverage.optionPairs===modelReport.checks.modelCoverage.sourcePairs+1
          &&modelReport.checks.modelCoverage.uiEqualsDirectory===false,'incremental_card_union');
        need((await currentPage.evaluate(()=>window.__japanExactCount.errors)).length===0,'incremental_model_hydration');
        const incrementalModelCoverage={passed:true,countAcceptance:modelReport.countAcceptance,
          japanModelCoverageRequired:modelReport.japanModelCoverageRequired,
          japanModelCoveragePassed:modelReport.japanModelCoveragePassed,
          japanExactCountRequired:modelReport.japanExactCountRequired,japanExactCountPassed:modelReport.japanExactCountPassed,
          positiveExactCountsSupplied,countsIncomplete,directoryWait,modelCoverage:modelReport.checks.modelCoverage};
        await currentPage.close();state.modelCoverage=false;

        // A successful append must repair an initially unknown aggregate in
        // both heading and footer, using the real context and append action.
        result.stage='fixture_append_count_recovery';state.recoverCount=true;
        const recovery=await context.newPage();currentPage=recovery;
        recovery.on('pageerror',error=>errors.push(String(error.message)));
        await recovery.clock.install({time:new Date(state.now)});
        const recoveryQuery={city:CITY,market:'japan',powerTo:'160'};
        const recoveredResponse=await recovery.goto(ORIGIN+'/cars/japan?'+new URLSearchParams({city:CITY,powerTo:'160'}),{waitUntil:'domcontentloaded'});
        need(recoveredResponse.status()===200,'recovery_http');
        await recovery.waitForFunction(()=>window.__japanExactCount?.ready===true);
        const pending=recovery.locator('[data-japan-count-status="partial"][data-japan-loaded-count="24"]');
        await pending.waitFor({state:'visible',timeout:30_000});
        need(await pending.locator('[data-catalog-market-count]').count()===0
          &&(await pending.innerText()).trim()==='Количество уточняется','recovery_initial_unknown');
        const recoveryFirst=fixtureResult(recoveryQuery,state.now);
        const recoveryNext=fixtureResult({...recoveryQuery,page:'2',after:recoveryFirst.nextCursor},state.now);
        const recoveryAppend=recovery.waitForResponse(response=>new URL(response.url()).pathname==='/api/catalog/search'
          &&new URL(response.url()).searchParams.get('page')==='2');
        await recovery.locator('main.ac-ajes-catalog').getByRole('button',{name:'Показать ещё',exact:true}).click();
        need((await recoveryAppend).status()===200,'recovery_append_http');
        const recoveredRows=[...recoveryFirst.items,...recoveryNext.items];
        await verifyJapanPriceSortVisible(recovery,recoveredRows,recoveryNext,{requireExactCount:true,query:recoveryQuery});
        const oldBudgetSummary={...oldSummary,countProof:{...oldSummary.countProof,
          requestedQueryHash:japanExactCountQueryHash(budgetQuery),queryHash:audiPages.at(-1).countSummary.countProof.queryHash}};
        await recovery.evaluate(({key,summary})=>window.__japanExactCount.late({queryKey:key,summary,text:'999999',total:999999}),
          {key:oldBudgetKey,summary:oldBudgetSummary});
        await recovery.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        await verifyJapanPriceSortVisible(recovery,recoveredRows,recoveryNext,{requireExactCount:true,query:recoveryQuery});

        result.stage='fixture_count_expiry';
        await recovery.clock.fastForward(31*60_000);
        const expired=recovery.locator('[data-japan-count-status="stale"][data-japan-loaded-count="48"]');
        await expired.waitFor({state:'visible',timeout:30_000});
        need(/73.*данные на/u.test(await expired.innerText())
          &&await expired.getAttribute('data-japan-count-observed-at')===state.now
          &&await recovery.locator('main.ac-ajes-catalog [data-catalog-market-count]').count()===0,'expired_count_not_current');
        const expiredFooter=recovery.locator('main.ac-ajes-catalog').getByText(/^Показано\s+48(?:\s|$)/);
        need((await expiredFooter.innerText()).replace(/\s/g,'')==='Показано48','expired_footer_not_current');
        state.failAppend=true;
        const expiredFailure=recovery.waitForResponse(response=>new URL(response.url()).pathname==='/api/catalog/search'
          &&new URL(response.url()).searchParams.get('page')==='3');
        await recovery.locator('main.ac-ajes-catalog').getByRole('button',{name:'Показать ещё',exact:true}).click();
        need((await expiredFailure).status()===503,'expired_append_transport');
        await recovery.locator('main.ac-ajes-catalog [role="alert"]').waitFor({state:'visible',timeout:5000});
        need(await recovery.locator('main.ac-ajes-catalog article').count()===48
          &&await expired.count()===1&&/73.*данные на/u.test(await expired.innerText())
          &&await recovery.locator('main.ac-ajes-catalog [data-catalog-market-count]').count()===0,'expired_failure_retains_cards');
        need(errors.length===0&&!state.serverError&&(await currentPage.evaluate(()=>window.__japanExactCount.errors)).length===0,'javascript');
        report.cases.push({name:remount?'remounted_controls':'preserved_controls',passed:true,
          priceSortPassed:true,exactCountPassed:true,modelCoveragePassed:true,budgetExactCountPassed:true,priceCountTotal:73,
          failedAppendKeepsTotal:true,pendingKeepsTotal:true,queryLoadedCountResets:true,lateOldAggregateIgnored:true,
          appendRestoresExactCount:true,lateOtherQueryDoesNotEraseCount:true,
          expiredCountDated:true,expiredCountNotCurrent:true,expiredAppendKeepsCards:true,
          finite:finiteProof,budgetFinite,modelCoverage:result.checks.modelCoverage,incrementalModelCoverage,exactCount:result.checks.exactCount,
          priceSort:result.checks.priceSort,pageErrors:0,requests:state.requests.length});
      }catch(error){
        report.failure={case:remount?'remounted_controls':'preserved_controls',stage:result.stage,
          progress:result.checks.exactCountProgress||result.checks.priceSortProgress};
        if(currentPage&&!currentPage.isClosed())report.failure.visible=await currentPage.evaluate(()=>({
          cards:document.querySelectorAll('main.ac-ajes-catalog article').length,
          counts:[...document.querySelectorAll('[data-japan-count-status]')].map(node=>({status:node.getAttribute('data-japan-count-status'),loaded:node.getAttribute('data-japan-loaded-count'),text:node.textContent?.slice(0,160)})),
          models:document.querySelectorAll('button[data-model-value]').length,errors:window.__japanExactCount?.errors,
        })).catch(()=>({unavailable:true}));
        throw error;
      }finally{state.release();await context.close();}
    }
    need(report.cases.length===2&&report.cases.every(row=>row.passed)&&report.forbiddenTransportAttempts===0,'complete');report.passed=true;
  }catch(error){
    const message=String(error?.message||'');report.error={code:/^japan_[a-z_]+$/.test(message)?message:'japan_exact_count_fixture_failed',
      message:message.length<=8000?message:message.slice(0,6000)+'\n[bounded call log omitted]\n'+message.slice(-2000),messageTruncated:message.length>8000,
      serverCode:active?.serverError,serverFailure:active?.serverFailure};
    process.exitCode=1;
  }finally{
    if(browser)await browser.close().catch(()=>{});if(server)await new Promise(resolve=>server.close(resolve));
    if(fixture)await fs.rm(fixture.temporary,{recursive:true,force:true});
    if(process.env.JAPAN_EXACT_COUNT_REPORT){need(path.isAbsolute(process.env.JAPAN_EXACT_COUNT_REPORT),'report_path');
      await fs.writeFile(process.env.JAPAN_EXACT_COUNT_REPORT,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}
    console.log(JSON.stringify(report));
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();



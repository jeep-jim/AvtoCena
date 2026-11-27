import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);

async function route(){
 const stubs:Record<string,string>={
  'next/server':"export const NextResponse={json:(body,init)=>Response.json(body,init)};",
  '@/lib/catalog/ajes-client':"export class AjesUnavailable extends Error{constructor(reason){super(reason);this.reason=reason;}};",
  '@/lib/catalog/ajes-query':"export class AjesInputError extends Error{};",
  '@/lib/catalog/ajes-catalog':"import {AjesUnavailable} from '@/lib/catalog/ajes-client';export const readAjesDirectory=async()=>{const state=globalThis.__japanModelMetadata;state.reads++;if(state.failure)throw new AjesUnavailable(state.failure);return state.result;};",
 };
 const built=await build({entryPoints:['apps/web/app/api/catalog/source-models/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'model-metadata',setup(b){b.onResolve({filter:/.*/},args=>args.path in stubs?{path:args.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path]}));}}]});
 const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);return mod.exports;
}

test('source model metadata removes explicit buses and zero counts while keeping saved light-van names',async()=>{
 const state={reads:0,result:{stale:true,models:[
  {make:'TOYOTA',model:'HIACE BUS',total:2},{make:'MAZDA',model:'TITAN',total:4},{make:'NISSAN',model:'CIVILIAN',total:1},
  {make:'MAZDA',model:'AXELA',total:0},{make:'MAZDA',model:'DEMIO',total:-1},
  {make:'TOYOTA',model:'HIACE VAN',total:3},{make:'MAZDA',model:'BONGO VAN',total:2},{make:'TOYOTA',model:'HIACE COACH EDITION',total:1},
 ]}};(globalThis as any).__japanModelMetadata=state;
 try{
  const api=await route(),response=await api.GET(new Request('https://avtocena.com/api/catalog/source-models?market=japan'));
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{version:1,brands:[],stale:true,models:[['TOYOTA','HIACE VAN',[],3],['MAZDA','BONGO VAN',[],2],['TOYOTA','HIACE COACH EDITION',[],1]]});
  assert.equal(state.reads,1,'metadata filtering adds no source read');
 }finally{delete (globalThis as any).__japanModelMetadata;}
});

test('unavailable source model metadata keeps its fixed failure reason and does not claim an empty result',async()=>{
 const state={reads:0,failure:'visitor_restricted'};(globalThis as any).__japanModelMetadata=state;
 try{
  const api=await route(),response=await api.GET(new Request('https://avtocena.com/api/catalog/source-models?market=japan&make=MAZDA'));
  assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{error:'directory_unavailable',reason:'visitor_restricted'});assert.equal(state.reads,1);
 }finally{delete (globalThis as any).__japanModelMetadata;}
});

async function component(file:string,stubs:Record<string,string>={}){
 const out=await build({entryPoints:[file],bundle:true,platform:'node',format:'cjs',jsx:'automatic',write:false,packages:'external',tsconfig:'apps/web/tsconfig.json',plugins:[{name:'source-name-ui',setup(b){
  b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'fixture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path],resolveDir:process.cwd()}));
 }}]});
 const mod={exports:{} as any};new Function('require','module','exports',out.outputFiles[0].text)(require,mod,mod.exports);return mod.exports;
}

const railStubs={
 'next/link':"import {createElement} from 'react';export default ({children,prefetch,...props})=>createElement('a',props,children);",
 'next/navigation':"export const usePathname=()=>'/cars/japan';export const useSearchParams=()=>new URLSearchParams(globalThis.__japanSourceUi.query);export const useRouter=()=>globalThis.__japanSourceUi.router;",
 '@/components/ui/PublicSheet':"export const PublicSheet=({children})=>children;",
 '@/components/dealers/DealerBrowsingContext':"export const useDealerBrowsing=()=>null;",
 '@/lib/dealers/browsing-context':"export const dealerBrowsingHref=href=>href;",
};

test('actual Japanese brand rail links carry observed aliases, while China and Green keep their canonical selection',async()=>{
 (globalThis as any).__japanSourceUi={query:'market=japan&city=Test&powerTo=160',router:{refresh(){},replace(){},prefetch(){}}};
 try{
  const {BrandLogoRail}=await component('apps/web/components/catalog/BrandLogoRail.tsx',railStubs);
  const links=(query:string)=>{
   (globalThis as any).__japanSourceUi.query=query;
   const html=renderToStaticMarkup(createElement(BrandLogoRail,{initial:{},brands:['LANDROVER','LAND ROVER','BENZ','MERCEDES BENZ'],sourceDirectoryState:'ready'}));
   return [...html.matchAll(/href="([^"]+)"/g)].map(match=>new URL(match[1].replaceAll('&amp;','&'),'https://fixture.invalid')).filter(url=>url.pathname==='/cars');
  };
  const japan=links('market=japan&city=Test&powerTo=160');
  const selected=japan.map(url=>new Set((url.searchParams.get('make')||'').split(',')));
  assert.ok(selected.some(names=>names.size===2&&names.has('LANDROVER')&&names.has('LAND ROVER')));
  assert.ok(selected.some(names=>names.size===2&&names.has('BENZ')&&names.has('MERCEDES BENZ')));
  assert.ok(japan.every(url=>url.searchParams.get('city')==='Test'&&url.searchParams.get('powerTo')==='160'));
  for(const query of ['market=china','market=korea','market=japan&stock=green']){
   assert.deepEqual(new Set(links(query).map(url=>url.searchParams.get('make'))),new Set(['Land Rover','Mercedes-Benz']));
  }
 }finally{delete (globalThis as any).__japanSourceUi;}
});

test('Japanese rail loading and unavailable metadata cannot render a false not-found state',async()=>{
 (globalThis as any).__japanSourceUi={query:'market=japan',router:{refresh(){},replace(){},prefetch(){}}};
 try{
  const {BrandLogoRail}=await component('apps/web/components/catalog/BrandLogoRail.tsx',railStubs);
  const render=(state?:string,brands:string[]=[])=>renderToStaticMarkup(createElement(BrandLogoRail,{brands,sourceDirectoryState:state}));
  for(const state of ['loading','unavailable',undefined])assert.doesNotMatch(render(state),/Марка не найдена/);
  assert.match(render('loading'),/Загружаем марки/);
  assert.match(render('unavailable'),/Не удалось загрузить марки\. Повторить/);
  assert.match(render('unavailable',['BENZ']),/Не удалось загрузить марки\. Повторить/);
  assert.match(render('ready'),/Марка не найдена/);
  assert.doesNotMatch(render('ready',['BENZ']),/Не удалось загрузить|Марка не найдена/);
  (globalThis as any).__japanSourceUi.query='market=china';assert.match(render('unavailable'),/Марка не найдена/);
  // Execute the actual retry handler with inert hooks; no DOM, source or storage request.
  let refreshes=0;(globalThis as any).__japanSourceUi={query:'market=japan',router:{refresh(){refreshes++;}}};
  const inert={...railStubs,'next/link':"export default ()=>null;",react:"export const useMemo=fn=>fn();export const useEffect=()=>{};export const useState=value=>[value,()=>{}];export const useRef=value=>({current:value});export const useSyncExternalStore=(_subscribe,_read,server)=>server();export const useTransition=()=>[false,fn=>fn()];"};
  const retryApi=await component('apps/web/components/catalog/BrandLogoRail.tsx',inert);
  const shell=retryApi.BrandLogoRail({brands:[],sourceDirectoryState:'unavailable'}),tree=shell.type(shell.props);
  const buttons:any[]=[];const walk=(node:any)=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(walk);return;}if(node.type==='button')buttons.push(node);walk(node.props?.children);};walk(tree);
  const retry=buttons.find(button=>button.props.children==='Не удалось загрузить марки. Повторить');assert.ok(retry);retry.props.onClick();assert.equal(refreshes,1);
 }finally{delete (globalThis as any).__japanSourceUi;}
});

test('Japanese model options retain literal make/model spellings and typed inference never emits a display alias',async()=>{
 const {japanSourceModelOptions,japanTypedModelMake}=await component('apps/web/components/catalog/VehicleModelSearch.tsx');
 const raw=[
  {make:'BENZ',model:'B-CLASS',aliases:[]},{make:'MERCEDES BENZ',model:'B-CLASS',aliases:[]},
  {make:'LANDROVER',model:'RANGE  ROVER',aliases:[]},{make:'LAND ROVER',model:'RANGE ROVER',aliases:[]},
  {make:'TOYOTA',model:'COROLLA 2WD',aliases:[]},
 ];
 const options=japanSourceModelOptions([...raw,raw[0]]);
 assert.deepEqual(options.map((row:any)=>[row.make,row.model]),raw.map(row=>[row.make,row.model]));
 assert.equal(japanTypedModelMake('B-CLASS',options),'BENZ,MERCEDES BENZ');
 assert.equal(japanTypedModelMake('RANGE  ROVER',options),'LANDROVER');
 assert.equal(japanTypedModelMake('COROLLA 2WD',options),'TOYOTA');
 assert.equal(japanTypedModelMake('B-CLASS|COROLLA 2WD',options),'');
});

test('the actual catalog dispatch preserves Japanese source params before AJ, leaving China and Green display aliases unchanged',async()=>{
 const file='apps/web/components/catalog/CatalogContent.tsx',text=readFileSync(file,'utf8');
 const real=new Set(['react','@/lib/catalog/brands','@/lib/catalog/filter-selections','@/lib/catalog/catalog-sort','@/lib/catalog/engine-input','@/lib/catalog/runtime-config']);
 const stubs:Record<string,string>={};
 for(const match of text.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g)){
  if(real.has(match[2]))continue;
  stubs[match[2]]=match[1].split(',').map(name=>name.trim().split(/\s+as\s+/)[0]).filter(Boolean).map(name=>`export const ${name}=()=>{throw Error('unexpected fixture dependency');};`).join('\n');
 }
 Object.assign(stubs,{
  '@/lib/catalog/china-public-aggregate':"export const omitLegacyChinaAggregate=()=>false;export const withChinaAggregateAuthority=(_market,read)=>read();",
  '@/lib/catalog/prepared-china-http-fixture':"export const hasIndependentChinaHttpFixture=()=>true;export const readPreparedChinaCompatibility=async query=>{globalThis.__japanSourceUi.china=query;throw Object.assign(Error('captured'),{digest:'NEXT_FIXTURE_CAPTURE'});};export const readPreparedChinaHomeCards=()=>{};export class PreparedChinaFixtureUnavailable extends Error{};",
  '@/lib/catalog/ajes-market-selection':"export const usesAjesMarket=async market=>market==='japan';",
  './AjesCatalog':"export function AjesCatalog(){}",
  './GreenCornerCatalog':"export function GreenCornerCatalog(){}",
 });
 (globalThis as any).__japanSourceUi={};
 try{
  const {CatalogContent}=await component(file,stubs);
  const params={market:'japan',make:'BENZ,LANDROVER',brand:'BENZ',model:'SOURCE MODEL'};
  const result=await CatalogContent({params});assert.equal(result.type.name,'AjesCatalog');assert.equal(result.props.params.make,params.make);assert.equal(result.props.params.brand,'BENZ');
  const green=await CatalogContent({params:{...params,stock:'green'}});assert.equal(green.type.name,'GreenCornerCatalog');assert.equal(green.props.params.make,'Mercedes-Benz,Land Rover');
  await assert.rejects(CatalogContent({params:{...params,market:'china'}}),/captured/);
  assert.equal((globalThis as any).__japanSourceUi.china.make,'Mercedes-Benz,Land Rover');
  assert.equal(params.make,'BENZ,LANDROVER');
 }finally{delete (globalThis as any).__japanSourceUi;}
});

test('the streamed Japan rail keeps visible makes and reads whole inventory without claiming empty completeness',async()=>{
 const file='apps/web/components/catalog/AjesCatalog.tsx',text=readFileSync(file,'utf8'),stubs:Record<string,string>={};
 const real=new Set(['react','@/lib/catalog/ajes-access-policy','@/lib/catalog/ajes-count-display','@/lib/catalog/ajes-ssr-read-evidence']);
 for(const match of text.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g)){
  if(real.has(match[2]))continue;
  stubs[match[2]]=match[1].split(',').map(name=>name.trim().split(/\s+as\s+/)[0]).filter(Boolean).map(name=>`export function ${name}(){}`).join('\n');
 }
 stubs['@/lib/catalog/ajes-catalog']="export const readAjesCatalogPage=async query=>{globalThis.__japanRailMetadata.catalogReads.push({...query});return {page:1,items:[{id:'fixture',make:'BENZ',model:'B-CLASS'}],sourceReceipts:[]};};export const readAjesCountSummary=async()=>null;export class AjesFilterUnavailable extends Error{};export const readAjesMakes=async query=>{const s=globalThis.__japanRailMetadata;s.makeReads.push(JSON.parse(query));if(s.failure)throw Error('directory unavailable');return s.result;};";
 const state={result:{makes:[] as Array<{make:string;total:number}>,stale:true},failure:false,makeReads:[] as Array<Record<string,string>>,catalogReads:[] as Array<Record<string,string>>};
 (globalThis as any).__japanRailMetadata=state;
 const find=(node:any,name:string):any=>{if(!node||typeof node!=='object')return;if(node.type?.name===name)return node;for(const value of Object.values(Array.isArray(node)?node:node.props||{})){const match=find(value,name);if(match)return match;}};
 try{
  const params={market:'japan',city:'Новокузнецк',powerTo:'160',auctionGrade:'5',fuel:'petrol',transmission:'automatic'};
  const {AjesCatalog}=await component(file,stubs),tree=await AjesCatalog({params});
  assert.equal(find(tree,'BrandLogoRail').props.sourceDirectoryState,'loading');
  assert.deepEqual(find(tree,'BrandLogoRail').props.brands,['BENZ']);
  assert.deepEqual(state.catalogReads,[params],'the actual vehicle query retains every selected filter');
  const rail=find(tree,'AjesBrandRail');assert.ok(rail);
  for(const fixture of [
   {result:{makes:[],stale:true},brands:['BENZ'],status:'unavailable'},
   {result:{makes:[{make:'LANDROVER',total:1}],stale:true},brands:['LANDROVER','BENZ'],status:'unavailable'},
   {result:{makes:[],stale:false},brands:['BENZ'],status:'unavailable'},
   {result:{makes:[{make:'TOYOTA',total:0}],stale:false},brands:['BENZ'],status:'unavailable'},
   {result:{makes:[{make:'LANDROVER',total:1}],stale:false},brands:['LANDROVER','BENZ'],status:'ready'},
   {result:{makes:[{make:'LANDROVER',total:1},{make:'BENZ',total:2},{make:'TOYOTA',total:0}],stale:false},brands:['LANDROVER','BENZ'],status:'ready'},
  ]){
   state.result=fixture.result;const reads=state.makeReads.length,rendered=await rail.type(rail.props);
   assert.deepEqual(rendered.props.brands,fixture.brands);
   assert.equal(rendered.props.sourceDirectoryState,fixture.status);
   assert.equal(state.makeReads.length,reads+1,'one directory read per streamed rail');
   assert.deepEqual(state.makeReads.at(-1),{market:'japan',city:params.city},'navigation reads whole Japan inventory and retains the city');
  }
  state.failure=true;const failed=await rail.type(rail.props);
  assert.deepEqual(failed.props.brands,['BENZ']);assert.equal(failed.props.sourceDirectoryState,'unavailable');
  state.failure=false;state.result={makes:[{make:'LANDROVER',total:1}],stale:false};
  const selected={...params,make:'BENZ',model:'B-CLASS',page:'2',sort:'year:desc'};
  const selectedTree=await AjesCatalog({params:selected}),selectedRail=find(selectedTree,'AjesBrandRail');
  const rendered=await selectedRail.type(selectedRail.props);
  assert.deepEqual(state.catalogReads.at(-1),selected,'make/model/page selection still reaches the vehicle reader');
  assert.deepEqual(state.makeReads.at(-1),{market:'japan',city:params.city},'make/model/page selection does not narrow navigation metadata');
  assert.deepEqual(rendered.props.brands,['BENZ'],'the selected visible source make survives an independently populated directory');
  assert.equal(rendered.props.sourceDirectoryState,'ready');
  assert.deepEqual(rendered.props.initial,selected,'navigation metadata cannot rewrite selected URL values');
  assert.equal(state.catalogReads.length,2);assert.equal(state.makeReads.length,8);
 }finally{delete (globalThis as any).__japanRailMetadata;}
});

test('Japan overview and filtered homepage rails omit the long power summary while preserving cards and saved-result status',async()=>{
 const params={market:'japan',city:'Новокузнецк',powerTo:'160'};
 const items=[
  {id:'ajes-stats-known',market:'japan',japanSupplierPower:{offerId:'ajes-stats-known',hp:150,unit:'hp',source:'ajes_pw'}},
  {id:'ajes-stats-unknown',market:'japan',japanPowerUnknown:true},
 ];
 const count={total:2,upperBound:false,stale:false,observedAt:'2026-11-27T12:00:00.000Z'};
 const state={createElement,cards:[] as any[],loaded:{key:JSON.stringify(params),disabled:false,items,count,stale:true,partial:true,hasMore:true,observedAt:count.observedAt},hook:0};
 (globalThis as any).__japanRailCopy=state;
 const card="import {createElement} from 'react';export function CatalogCard({offer}){globalThis.__japanRailCopy.cards.push(offer);return createElement('article',{'data-offer-id':offer.id});}";
 const frame="import {createElement} from 'react';export const JapanRailFrame=({children})=>createElement('section',null,children);export const japanRailHref=()=>'/cars?market=japan&powerTo=160';export const japanSavedPreviewText=()=> 'Сохранённая подборка';";
 const loading="export const CatalogSectionLoading=()=>null;";
 const marketCount="export const MarketResultCount=({children})=>children;";
 const shared={
  '@/components/dealers/DealerBrowsingContext':"import {createElement} from 'react';export const DealerLink=({children,...props})=>createElement('a',props,children);",
  '@/lib/catalog/ajes-catalog':"export const readAjesCatalogPage=()=>{throw Error('unexpected source read');};export const readAjesCountSummary=()=>{throw Error('unexpected count read');};",
  '@/lib/catalog/collection-controls':"export const assertCollectionEnabled=()=>{throw Error('unexpected collection read');};export class CollectionDisabledError extends Error{};",
  '@/lib/catalog/storage':"export const publicOffer=offer=>offer;",
  './CatalogCard':card,'@/components/catalog/CatalogCard':card,
  './JapanRailFrame':frame,'@/components/catalog/JapanRailFrame':frame,
  './CatalogLoading':loading,'@/components/catalog/CatalogLoading':loading,
  './MarketResultCount':marketCount,'@/components/catalog/MarketResultCount':marketCount,
 };
 try{
  const {AjesRail}=await component('apps/web/components/catalog/AjesRail.tsx',shared);
  const overview=await AjesRail({params,prepared:Promise.resolve({...state.loaded,unavailable:false,unsupported:false,filteredByPage:true})});
  const overviewHtml=renderToStaticMarkup(overview);
  assert.doesNotMatch(overviewHtml,/Мощность по данным поставщика:|Мощность не указана:|Отбор не подтверждает право/);
  assert.match(overviewHtml,/Сохранённая подборка/);assert.deepEqual(state.cards,items);
  state.cards=[];
  const {HomeJapanFilteredRail}=await component('apps/web/components/home/HomeJapanFilteredRail.tsx',{
   ...shared,
   react:"export const createElement=(...args)=>globalThis.__japanRailCopy.createElement(...args);export const useEffect=()=>{};export const useState=()=>{const s=globalThis.__japanRailCopy;return [[s.loaded,'ready',0][s.hook++],()=>{}];};",
  });
  const homeHtml=renderToStaticMarkup(HomeJapanFilteredRail({params}));
  assert.doesNotMatch(homeHtml,/Мощность по данным поставщика:|Мощность не указана:|Отбор не подтверждает право/);
  assert.match(homeHtml,/Сохранённая подборка/);assert.deepEqual(state.cards,items,'individual card power facts pass through unchanged');
 }finally{delete (globalThis as any).__japanRailCopy;}
});

test('the actual Japan brand selector preserves visible source makes on empty, stale and failed metadata and retries instead of reusing it',async t=>{
 const hooks={slots:[] as any[],cursor:0,effects:[] as any[],effectCursor:0,pending:[] as Array<()=>void>};
 (globalThis as any).__japanBrandHooks=hooks;
 const documentBefore=Object.getOwnPropertyDescriptor(globalThis,'document'),windowBefore=Object.getOwnPropertyDescriptor(globalThis,'window');
 const events={addEventListener(){},removeEventListener(){}};
 Object.defineProperty(globalThis,'document',{configurable:true,value:events});Object.defineProperty(globalThis,'window',{configurable:true,value:events});
 t.after(()=>{
  for(const effect of hooks.effects)effect?.cleanup?.();delete (globalThis as any).__japanBrandHooks;
  for(const [key,descriptor] of [['document',documentBefore],['window',windowBefore]] as const){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete (globalThis as any)[key];}
 });
 let reads=0,status=200,expectedQuery='market=japan',payload:any={counts:{},modelCounts:{},stale:false};
 t.mock.method(globalThis,'fetch',async input=>{assert.equal(String(input),'/api/catalog/brand-counts?'+expectedQuery);reads++;return Response.json(payload,{status});});
 const {CatalogBrandMultiSelect}=await component('apps/web/components/catalog/CatalogBrandMultiSelect.tsx',{
  '@/components/catalog/BrandLogoRail':"export const BrandLogoVisual=()=>null;",
  react:"export const useMemo=fn=>fn();export const useRef=value=>({current:value});export const useState=initial=>{const s=globalThis.__japanBrandHooks,i=s.cursor++;if(!(i in s.slots))s.slots[i]=typeof initial==='function'?initial():initial;return [s.slots[i],value=>{s.slots[i]=typeof value==='function'?value(s.slots[i]):value;}];};export const useEffect=(fn,deps)=>{const s=globalThis.__japanBrandHooks,i=s.effectCursor++,previous=s.effects[i];if(!previous||JSON.stringify(previous.deps)!==JSON.stringify(deps))s.pending.push(()=>{previous?.cleanup?.();s.effects[i]={deps,cleanup:fn()};});};",
 });
 const props={value:'',options:[{value:'NISSAN',label:'NISSAN'}],contextQuery:'market=japan',onChange:()=>{}};
 const render=()=>{hooks.cursor=0;hooks.effectCursor=0;return CatalogBrandMultiSelect(props);};
 const settle=async()=>{render();for(const run of hooks.pending.splice(0))run();await new Promise(resolve=>setImmediate(resolve));return render();};
 const nodes=(node:any):any[]=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];
 const trigger=(tree:any)=>nodes(tree).find(node=>node.props?.['aria-label']==='Выбрать марки автомобилей');
 const retry=(tree:any)=>nodes(tree).find(node=>node.type==='button'&&node.props.children==='Не удалось загрузить марки. Повторить');
 const names=(tree:any)=>nodes(tree).flatMap(node=>node.props?.['data-facet-value']?[node.props['data-facet-value']]:[]);
 const directoryState=(tree:any)=>nodes(tree).find(node=>node.props?.['data-japan-source-directory-state'])?.props['data-japan-source-directory-state'];
 let tree=render();trigger(tree).props.onClick();tree=await settle();
 assert.deepEqual(names(tree),['NISSAN']);assert.equal(directoryState(tree),'unavailable');assert.ok(retry(tree));assert.equal(reads,1);
 for(const next of [
  {status:200,payload:{counts:{TOYOTA:0},modelCounts:{},stale:false},names:['NISSAN']},
  {status:200,payload:{counts:{TOYOTA:2},modelCounts:{},stale:true},names:['NISSAN','TOYOTA']},
  {status:503,payload:{error:'japan_counts_unavailable'},names:['NISSAN']},
 ]){
  status=next.status;payload=next.payload;const before=reads;
  retry(tree).props.onClick();tree=await settle();
  assert.equal(reads,before+1);assert.deepEqual(names(tree),next.names);assert.equal(directoryState(tree),'unavailable');assert.ok(retry(tree));
 }
 status=200;payload={counts:{BENZ:2},modelCounts:{},stale:false};const before=reads;
 retry(tree).props.onClick();tree=await settle();
 assert.equal(reads,before+1);assert.deepEqual(names(tree),['BENZ']);assert.equal(directoryState(tree),'ready');assert.equal(retry(tree),undefined);
 trigger(tree).props.onClick();tree=await settle();trigger(tree).props.onClick();tree=await settle();
 assert.equal(reads,before+1,'a complete positive directory keeps the existing cache');assert.deepEqual(names(tree),['BENZ']);
 for(const contextQuery of ['market=china','market=japan&stock=green']){
  expectedQuery=contextQuery;props.contextQuery=contextQuery;payload={counts:{},modelCounts:{}};tree=await settle();
  assert.deepEqual(names(tree),['NISSAN']);assert.equal(retry(tree),undefined);assert.equal(directoryState(tree),undefined,'neighbor controls do not acquire Japan metadata state');
 }
});

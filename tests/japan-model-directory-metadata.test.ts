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

test('the streamed Japan rail retains visible source makes on stale or failed metadata without claiming completeness',async()=>{
 const file='apps/web/components/catalog/AjesCatalog.tsx',text=readFileSync(file,'utf8'),stubs:Record<string,string>={};
 const real=new Set(['react','@/lib/catalog/ajes-access-policy','@/lib/catalog/ajes-count-display','@/lib/catalog/ajes-ssr-read-evidence']);
 for(const match of text.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g)){
  if(real.has(match[2]))continue;
  stubs[match[2]]=match[1].split(',').map(name=>name.trim().split(/\s+as\s+/)[0]).filter(Boolean).map(name=>`export function ${name}(){}`).join('\n');
 }
 stubs['@/lib/catalog/ajes-catalog']="export const readAjesCatalogPage=async()=>({page:1,items:[{id:'fixture',make:'BENZ',model:'B-CLASS'}],sourceReceipts:[]});export const readAjesCountSummary=async()=>null;export class AjesFilterUnavailable extends Error{};export const readAjesMakes=async()=>{const s=globalThis.__japanRailMetadata;if(s.failure)throw Error('directory unavailable');return s.result;};";
 (globalThis as any).__japanRailMetadata={result:{makes:[],stale:true}};
 const find=(node:any,name:string):any=>{if(!node||typeof node!=='object')return;if(node.type?.name===name)return node;for(const value of Object.values(Array.isArray(node)?node:node.props||{})){const match=find(value,name);if(match)return match;}};
 try{
  const {AjesCatalog}=await component(file,stubs),tree=await AjesCatalog({params:{market:'japan'}});
  assert.equal(find(tree,'BrandLogoRail').props.sourceDirectoryState,'loading');
  const rail=find(tree,'AjesBrandRail');assert.ok(rail);
  for(const result of [{makes:[],stale:true},{makes:[{make:'LANDROVER',total:1}],stale:true},{makes:[],stale:false}]){
   (globalThis as any).__japanRailMetadata={result};const rendered=await rail.type(rail.props);
   assert.deepEqual(rendered.props.brands,result.stale?[...result.makes.map(row=>row.make),'BENZ']:[]);
   assert.equal(rendered.props.sourceDirectoryState,result.stale?'unavailable':'ready');
  }
  (globalThis as any).__japanRailMetadata={failure:true};const failed=await rail.type(rail.props);
  assert.deepEqual(failed.props.brands,['BENZ']);assert.equal(failed.props.sourceDirectoryState,'unavailable');
 }finally{delete (globalThis as any).__japanRailMetadata;}
});

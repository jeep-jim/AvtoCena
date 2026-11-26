import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {createElement} from 'react';

const require=createRequire(import.meta.url);
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function nodes(tree:any){
 const output:any[]=[];
 function walk(value:any){if(Array.isArray(value))return value.forEach(walk);if(!value||typeof value!=='object')return;output.push(value);walk(value.props?.children);}
 walk(tree);return output;
}
async function fixture(t:any,entry:'home'|'preview'){
 const state={slots:[] as any[],cursor:0,effectCursor:0,effects:[] as any[],pending:[] as Array<()=>void>};
 (globalThis as any).__homeJapanHooks=state;t.after(()=>{for(const effect of state.effects)effect?.cleanup?.();delete (globalThis as any).__homeJapanHooks;});
 const mocks:Record<string,string>={
  'react':`export const memo=f=>f;export const useMemo=f=>f();export const useRef=v=>({current:v});export const useState=initial=>{const s=globalThis.__homeJapanHooks,i=s.cursor++;if(!(i in s.slots))s.slots[i]=typeof initial==='function'?initial():initial;return [s.slots[i],value=>{s.slots[i]=typeof value==='function'?value(s.slots[i]):value;}];};export const useEffect=(fn,deps)=>{const s=globalThis.__homeJapanHooks,i=s.effectCursor++,previous=s.effects[i];if(!previous||JSON.stringify(previous.deps)!==JSON.stringify(deps)){s.pending.push(()=>{previous?.cleanup?.();s.effects[i]={deps,cleanup:fn()};});}};`,
  'navigation':`export const useRouter=()=>({push:()=>{}});`,
  'useHomeCatalogCount':`export const useHomeCatalogCount=()=>({count:null,countError:false,countText:''});`,
  'attribution':`export const appendAttributionToSearchParams=()=>{};`,
  'brands':`export const canonicalCatalogBrand=x=>x;`,
  'presentation':`export const presentCatalogOffer=x=>({...x,makeLabel:x.make,modelLabel:x.model});`,
  'runtime-config':`export const PUBLIC_CATALOG_MARKETS=['china','japan','korea','uae','europe','georgia'];export const CATALOG_MARKET_LABELS={china:'Китай',japan:'Япония',korea:'Корея',uae:'ОАЭ',europe:'Европа',georgia:'Грузия'};`,
  'DealerBrowsingContext':`export const DealerLink='a';`,
  'link':`export default 'a';`,
 };
 for(const [file,exported] of Object.entries({GreenCornerRail:'GreenCornerRail',BrandLogoRail:'BrandLogoRail',CatalogCard:'CatalogCard',CatalogMarketFlag:'CatalogMarketFlag',CurrencyRatesStrip:'CurrencyRatesStrip',PublicLeadCaptureV2:'GenericLeadBanner',VehicleModelSearch:'VehicleModelSearch',SpecialRail:'SpecialRail',BuyerGallery:'BuyerGallery',CitySelector:'CitySelector',PublicHeader:'PublicHeader'}))mocks[file]=`export const ${exported}='${exported}';`;
 if(entry==='home')mocks.HomeJapanFilteredRail=`export const HomeJapanFilteredRail='HomeJapanFilteredRail';`;
 const path=entry==='home'?'apps/web/components/home/HomePageClient.tsx':'apps/web/components/home/HomeJapanFilteredRail.tsx';
 const source=await readFile(path,'utf8')+(entry==='home'?'\nexport {loadFuelOffers};':'');
 const out=await build({stdin:{contents:source,sourcefile:resolve(path),resolveDir:resolve('apps/web/components/home'),loader:'tsx'},bundle:true,platform:'node',format:'cjs',jsx:'automatic',write:false,packages:'external',loader:{'.css':'empty'},plugins:[{name:'home-japan-fixture',setup(b){
  b.onResolve({filter:/.*/},a=>{const name=a.path.split('/').at(-1)!;return mocks[a.path]||mocks[name]?{path:mocks[a.path]?a.path:name,namespace:'fixture'}:undefined;});
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path]}));
 }}]});
 const mod={exports:{} as any};new Function('require','module','exports',out.outputFiles[0].text)(require,mod,mod.exports);
 return {state,api:mod.exports,render:(component:any,props:any)=>{state.cursor=0;state.effectCursor=0;state.pending=[];return component(props);},effects:()=>{for(const run of state.pending)run();state.pending=[];}};
}

test('homepage keeps its existing server Japan slot while the shared catalog is loading or unavailable',async t=>{
 const f=await fixture(t,'home'),slot=createElement('section',{'data-japan-server-slot':true});
 for(const status of ['loading','error','ready']){
  f.state.slots[18]=status;
  const tree=f.render(f.api.default,{initialOffers:[],initialCity:'Казань',japanAuctions:slot});
  const values=nodes(tree);
  assert.equal(values.filter(node=>node.props?.['data-japan-server-slot']).length,1,status);
  assert.equal(values.filter(node=>node.type==='HomeJapanFilteredRail').length,0,'SSR/hydration does not add a duplicate preview fetch');
 }
});

test('homepage electric and make selections retain Japan through one filtered preview and preserve city',async t=>{
 const f=await fixture(t,'home'),slot=createElement('section',{'data-japan-server-slot':true});
 f.state.slots[9]=true;f.state.slots[12]='Nissan';f.state.slots[18]='ready';
 const values=nodes(f.render(f.api.default,{initialOffers:[],initialCity:'Новокузнецк',japanAuctions:slot}));
 const previews=values.filter(node=>node.type==='HomeJapanFilteredRail');
 assert.equal(previews.length,1);assert.deepEqual(previews[0].props.params,{city:'Новокузнецк',make:'Nissan',fuel:'electric'});
 assert.equal(values.filter(node=>node.props?.['data-japan-server-slot']).length,0);
});

test('homepage electric inventory loop never scans AJ Japan pages',async t=>{
 const f=await fixture(t,'home'),reads:Array<{market:string;page:number}>=[];
 t.mock.method(globalThis,'fetch',async input=>{
  const url=new URL(String(input),'https://avtocena.com'),market=url.searchParams.get('market')!,page=Number(url.searchParams.get('page'));
  assert.notEqual(market,'japan');reads.push({market,page});
  return new Response(JSON.stringify({ok:true,total:96,items:[{id:`${market}-${page}`,market}]}),{status:200});
 });
 const rows=await f.api.loadFuelOffers('electric',new AbortController().signal);
 assert.equal(reads.length,10);assert.equal(rows.length,10);
 for(const market of ['china','korea','uae','europe','georgia'])assert.deepEqual(reads.filter(row=>row.market===market).map(row=>row.page).sort(),[1,2]);
});

test('filtered Japan preview makes one user query, retains supplier count metadata, and never follows aggregate pages',async t=>{
 const f=await fixture(t,'preview'),urls:URL[]=[];
 const count={total:660813,stale:false,upperBound:false,observedAt:'2026-11-26T04:30:00Z'};
 t.mock.method(globalThis,'fetch',async(input,options)=>{
  urls.push(new URL(String(input),'https://avtocena.com'));assert(options?.signal);
  return new Response(JSON.stringify({ok:true,total:660813,items:Array.from({length:12},(_,i)=>({id:`jp-${i}`,market:'japan'})),countSummary:count,hasMore:true}),{status:200});
 });
 const result=await f.api.readHomeJapanPreview({city:'Казань',make:'Nissan',fuel:'electric',powerTo:'160',page:'99',after:'cursor'},new AbortController().signal);
 assert.equal(urls.length,1);assert.deepEqual(Object.fromEntries(urls[0].searchParams),{city:'Казань',make:'Nissan',fuel:'electric',powerTo:'160',page:'1',market:'japan',pageSize:'24'});
 assert.equal(result.items.length,6);assert.deepEqual(result.count,count);assert.equal(result.hasMore,true);
});

test('a changed Japanese preview aborts the obsolete request and retains previous cards with an honest notice',async t=>{
 const f=await fixture(t,'preview'),requests:Array<{signal:AbortSignal;resolve:(value:Response)=>void}>=[];
 t.mock.method(globalThis,'fetch',async(_input,options)=>new Promise<Response>(resolve=>requests.push({signal:options!.signal as AbortSignal,resolve})));
 const p={city:'Казань',fuel:'electric'};
 f.render(f.api.HomeJapanFilteredRail,{params:p});f.effects();assert.equal(requests.length,1);
 requests[0].resolve(new Response(JSON.stringify({ok:true,items:[{id:'original-japan-car'}],hasMore:true,stale:false,partial:false}),{status:200}));await turn();
 let tree=f.render(f.api.HomeJapanFilteredRail,{params:p});f.effects();assert.equal(requests.length,1,'unchanged render does not request again');
 assert.equal(nodes(tree).find(node=>node.type==='CatalogCard').props.offer.id,'original-japan-car');
 tree=f.render(f.api.HomeJapanFilteredRail,{params:{...p,make:'Nissan'}});f.effects();
 assert.equal(requests[0].signal.aborted,true);assert.equal(requests.length,2);
 assert.equal(nodes(tree).find(node=>node.type==='CatalogCard').props.offer.id,'original-japan-car');
 assert(nodes(tree).some(node=>String(node.props?.children).includes('Новые условия ещё не применены')));
 requests[1].resolve(new Response('{}',{status:503}));await turn();
 tree=f.render(f.api.HomeJapanFilteredRail,{params:{...p,make:'Nissan'}});
 assert(nodes(tree).some(node=>node.type==='button'&&node.props.children==='Повторить'));
 assert.equal(nodes(tree).find(node=>node.type==='CatalogCard').props.offer.id,'original-japan-car');
});

test('an explicitly disabled owner source hides a filtered Japanese preview without retrying',async t=>{
 const f=await fixture(t,'preview');let reads=0;
 t.mock.method(globalThis,'fetch',async()=>{reads++;return new Response(JSON.stringify({ok:false,error:'japan_search_unavailable',reason:'source_disabled'}),{status:503});});
 const props={params:{city:'Казань',fuel:'electric'}};
 f.render(f.api.HomeJapanFilteredRail,props);f.effects();await turn();
 assert.equal(f.render(f.api.HomeJapanFilteredRail,props),null);f.effects();
 assert.equal(reads,1);
});

test('a generic settings failure remains a visible unavailable preview, never an owner-disabled state',async t=>{
 const f=await fixture(t,'preview');
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({ok:false,error:'japan_search_unavailable',reason:'operation_failed'}),{status:503}));
 const props={params:{fuel:'electric'}};
 f.render(f.api.HomeJapanFilteredRail,props);f.effects();await turn();
 const tree=f.render(f.api.HomeJapanFilteredRail,props);
 assert(tree);assert.equal(tree.props.status,'unavailable');
 assert(nodes(tree).some(node=>node.type==='button'&&node.props.children==='Повторить'));
});

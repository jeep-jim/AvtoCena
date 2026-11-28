import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('ready cards do not wait for optional brand/model directories; exact selected controls survive',async t=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-11-28T00:15:00Z'));
 let calls=0;const never=new Promise(()=>{});
 let readyCount:any={total:1,stale:false,upperBound:false,observedAt:'2026-11-28T00:00:00Z'},countResult:any=never,readOptions:any,countKey='';
 let items:any[]=[{id:'car1',make:'Toyota',model:'COROLLA'}],pageFlags:Record<string,boolean>={};
 (globalThis as any).__ajesTest={readAjesCatalogPage:async(_q:any,_measure:any,options:any)=>{readOptions=options;return {countSummary:readyCount,page:1,total:items.length,items,hasMore:false,...pageFlags};},readAjesMakes:()=>{calls++;return never;},readAjesDirectory:()=>{calls++;return never;},readAjesCountSummary:(key:string)=>{calls++;countKey=key;return countResult;}};
 try{
  const built=await build({entryPoints:['apps/web/components/catalog/AjesCatalog.tsx'],bundle:true,platform:'node',format:'cjs',write:false,jsx:'automatic',external:['react','react/jsx-runtime'],plugins:[{name:'dependencies',setup(b){
   b.onResolve({filter:/.*/},args=>args.path==='node:crypto'?{path:args.path,external:true}:args.kind==='entry-point'||args.path==='react'||args.path==='react/jsx-runtime'?undefined:{path:args.path,namespace:'fixture'});
   b.onLoad({filter:/.*/,namespace:'fixture'},args=>{
    if(args.path.endsWith('/ajes-ssr-read-evidence'))return {contents:readFileSync('apps/web/lib/catalog/ajes-ssr-read-evidence.ts','utf8'),loader:'ts'};
    if(args.path.endsWith('/ajes-read-receipt'))return {contents:readFileSync('apps/web/lib/catalog/ajes-read-receipt.ts','utf8'),loader:'ts'};
    if(args.path.endsWith('/ajes-access-policy'))return {contents:readFileSync('apps/web/lib/catalog/ajes-access-policy.ts','utf8'),loader:'ts'};
    if(args.path.endsWith('/catalog-routes'))return {contents:readFileSync('apps/web/lib/catalog/catalog-routes.ts','utf8'),loader:'ts'};
    if(args.path.endsWith('/ajes-catalog'))return {contents:`export const {readAjesCatalogPage,readAjesMakes,readAjesDirectory,readAjesCountSummary}=globalThis.__ajesTest;export class AjesFilterUnavailable extends Error {}`};
    if(args.path.endsWith('/ajes-client'))return {contents:'export class AjesUnavailable extends Error {}'};
    if(args.path.endsWith('/ajes-query'))return {contents:'export class AjesInputError extends Error {};export class AjesCursorRefreshRequired extends AjesInputError {}'};
    if(args.path.endsWith('/ajes-count-display'))return {contents:readFileSync('apps/web/lib/catalog/ajes-count-display.ts','utf8'),loader:'ts'};
    if(args.path.endsWith('/count-format'))return {contents:readFileSync('apps/web/lib/catalog/count-format.ts','utf8'),loader:'ts'};
    if(args.path.endsWith('/japan-source-power'))return {contents:readFileSync('apps/web/lib/catalog/japan-source-power.ts','utf8'),loader:'ts'};
    if(args.path.endsWith('/powertrain-safety'))return {contents:readFileSync('apps/web/lib/catalog/powertrain-safety.ts','utf8'),loader:'ts'};
    if(args.path.endsWith('/japan-owner-specifications'))return {contents:'export const isOwnerStepwgnNonHybrid=()=>false;'};
    if(args.path.endsWith('/CatalogSelectionContext'))return {contents:'export const CatalogResultCountUpdate=props=>null;'};
    if(args.path.endsWith('/ajes-runtime'))return {contents:'export const readSavedAjesFacets=()=>new Promise(()=>{});'};
    const name=args.path.split('/').pop();const exported=name==='DealerBrowsingContext'?'DealerLink':name;
    return {contents:`export const ${exported}=props=>null;`};
   });
  }}]});
  const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);
  let timer:ReturnType<typeof setTimeout>;
  const root:any=await Promise.race([mod.exports.AjesCatalog({params:{market:'japan',make:'Toyota',city:'Новокузнецк'}}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ready cards blocked by directory')),300);})]).finally(()=>clearTimeout(timer!));
  assert.equal(calls,0,'metadata must begin in a separate streamed boundary, not ahead of list');
  assert.deepEqual(readOptions,{includeCount:false},'ready cards do not wait for the independent count; a complete single-LIST summary is still shared');
  const walk=(node:any):any[]=>!node||typeof node!=='object'?[]:[node,...Object.values(node.props||{}).flatMap(v=>Array.isArray(v)?v.flatMap(walk):walk(v))];
  const nodes=walk(root),filters=nodes.find(n=>n.props?.auctionResults);
  assert.ok(nodes.some(n=>n.props?.queryKey===JSON.stringify(filters.props.initial)&&n.props?.text==='1'),'ready aggregate is shared under the exact filter query');
  assert.equal(filters.props.initial.city,'Новокузнецк');assert.equal(filters.props.initial.make,'Toyota');
  assert.ok(filters.props.facets.makes.includes('Toyota'));assert.ok(nodes.some(n=>n.props?.initialCount===1));
  readyCount=null;
  items=[
   {id:'ajes-stats-local',market:'japan',make:'Toyota',model:'COROLLA',powerHp:150},
   {id:'ajes-stats-supplier',market:'japan',make:'Toyota',model:'COROLLA',japanSupplierPower:{offerId:'ajes-stats-supplier',hp:160,unit:'hp',source:'ajes_pw'}},
   {id:'ajes-stats-unknown',market:'japan',make:'Toyota',model:'COROLLA',japanPowerUnknown:true},
  ];
  const lateRoot=await mod.exports.AjesCatalog({params:{market:'japan',powerTo:'160',city:'Новокузнецк'}});
  assert.equal(calls,0,'late count does not precede ready cards');
  const lateNodes=walk(lateRoot),late=lateNodes.find(n=>n.type?.name==='AjesIndependentCount');assert.ok(late);
  assert.equal(lateNodes.some(n=>n.props?.['data-japan-power-summary-page']!==undefined),false,'the removed page warning must not be rendered');
  assert.ok(lateNodes.some(n=>n.type?.name==='JapanCatalogCount'&&n.props.initialCount===3),'the visible partial count includes the three actually loaded cars');
  assert.equal(lateNodes.find(n=>n.props?.initialCount===3)?.props.resultCountLabel,undefined,'no uncertain count label is passed to the footer');
  assert.ok(lateNodes.some(n=>n.props?.initialCount===3),'all three actual cards, including unknown power, remain visible');
  assert.ok(lateNodes.some(n=>n.props?.initialCards?.some?.((card:any)=>card.props.offer.japanPowerUnknown===true)));
  countResult=Promise.resolve({total:42,stale:false,upperBound:false,observedAt:'2026-11-28T00:00:00Z'});
  const counterNodes=walk(await late.type(late.props));
  assert.ok(counterNodes.some(n=>n.props?.text==='42'&&n.props?.total===42),'late aggregate includes the numeric pagination value');
  assert.ok(lateNodes.some(n=>n.props?.resultQueryKey===countKey),'pagination and independent aggregate use the identical query identity');
  assert.deepEqual(JSON.parse(countKey),lateNodes.find(n=>n.props?.auctionResults).props.initial);
  readyCount={total:0,stale:false,upperBound:true,observedAt:'2026-11-28T00:00:00Z'};
  const partialNodes=walk(await mod.exports.AjesCatalog({params:{market:'japan',powerTo:'160',sort:'totalRubDesc',city:'Новокузнецк'}}));
  assert.ok(partialNodes.some(n=>n.type?.name==='JapanCatalogCount'&&n.props.initialCount===3&&n.props.summary===readyCount));
  assert.equal(partialNodes.find(n=>n.props?.auctionResults).props.resultCount,undefined,'upper bound never reaches numeric filter total');
  items=[];
  for(const failure of ['partial','stale','interrupted']){
   pageFlags={hasMore:true,scanLimited:true,[failure]:true};
   const failedNodes=walk(await mod.exports.AjesCatalog({params:{market:'japan',powerTo:'160',sort:'totalRubDesc',city:'Новокузнецк'}}));
   assert.match(failedNodes.find(n=>n.props?.resultScope)?.props.resultError,/Не удалось обновить/,'empty failed selection activates retained results and retry');
  }
  pageFlags={hasMore:true,scanLimited:true};
  const scanning=walk(await mod.exports.AjesCatalog({params:{market:'japan',powerTo:'160',sort:'totalRubDesc',city:'Новокузнецк'}}));
  assert.equal(scanning.find(n=>n.props?.resultScope)?.props.resultError,undefined,'fresh scan continuation is not mislabelled as a source failure');
  assert.equal(scanning.find(n=>n.type?.name==='CatalogLoadMore')?.props.initialHasMore,true);
 }finally{delete (globalThis as any).__ajesTest;}
});

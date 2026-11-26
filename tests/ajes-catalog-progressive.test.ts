import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('ready cards do not wait for optional brand/model directories; exact selected controls survive',async()=>{
 let calls=0;const never=new Promise(()=>{});
 let readyCount:any={total:1},countResult:any=never,readOptions:any,countKey='';
 let items:any[]=[{id:'car1',make:'Toyota',model:'COROLLA'}];
 (globalThis as any).__ajesTest={readAjesCatalogPage:async(_q:any,_measure:any,options:any)=>{readOptions=options;return {countSummary:readyCount,page:1,total:items.length,items,hasMore:false};},readAjesMakes:()=>{calls++;return never;},readAjesDirectory:()=>{calls++;return never;},readAjesCountSummary:(key:string)=>{calls++;countKey=key;return countResult;}};
 try{
  const built=await build({entryPoints:['apps/web/components/catalog/AjesCatalog.tsx'],bundle:true,platform:'node',format:'cjs',write:false,jsx:'automatic',external:['react','react/jsx-runtime'],plugins:[{name:'dependencies',setup(b){
   b.onResolve({filter:/.*/},args=>args.kind==='entry-point'||args.path==='react'||args.path==='react/jsx-runtime'?undefined:{path:args.path,namespace:'fixture'});
   b.onLoad({filter:/.*/,namespace:'fixture'},args=>{
    if(args.path.endsWith('/ajes-access-policy'))return {contents:readFileSync('apps/web/lib/catalog/ajes-access-policy.ts','utf8'),loader:'ts'};
    if(args.path.endsWith('/catalog-routes'))return {contents:readFileSync('apps/web/lib/catalog/catalog-routes.ts','utf8'),loader:'ts'};
    if(args.path.endsWith('/ajes-catalog'))return {contents:`export const {readAjesCatalogPage,readAjesMakes,readAjesDirectory,readAjesCountSummary}=globalThis.__ajesTest;export class AjesFilterUnavailable extends Error {}`};
    if(args.path.endsWith('/ajes-client'))return {contents:'export class AjesUnavailable extends Error {}'};
    if(args.path.endsWith('/ajes-query'))return {contents:'export class AjesInputError extends Error {}'};
    if(args.path.endsWith('/ajes-count-display'))return {contents:'export const exactAjesCount=s=>s?.total;export const ajesCountText=s=>String(s?.total??"unknown");export const ajesPaginationCountText=ajesCountText;'};
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
  assert.equal(calls,0,'optional metadata must not precede the list');
  assert.deepEqual(readOptions,{includeCount:false});
  const walk=(node:any):any[]=>!node||typeof node!=='object'?[]:[node,...Object.values(node.props||{}).flatMap(v=>Array.isArray(v)?v.flatMap(walk):walk(v))];
  const nodes=walk(root),filters=nodes.find(n=>n.props?.auctionResults);
  const layout=nodes.find(n=>n.props?.resultScope==='ajes:japan:false');
  assert.ok(layout?.props.brandRail,'Japan uses the same single upper brand slot as the other public markets');
  assert.equal(nodes.filter(n=>n===layout.props.brandRail).length,1,'one brand rail is mounted');
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
  assert.equal(lateNodes.some(n=>n.props?.['data-japan-power-summary-page']!==undefined),false,'power provenance stays on the individual cards');
  assert.ok(lateNodes.some(n=>n.props?.initialCount===3),'all three eligible cards remain rendered');
  countResult=Promise.resolve({total:42});
  const counterNodes=walk(await late.type(late.props));
  assert.ok(counterNodes.some(n=>n.props?.text==='42'&&n.props?.total===42),'late aggregate includes the numeric pagination value');
  assert.ok(lateNodes.some(n=>n.props?.resultQueryKey===countKey),'pagination and independent aggregate use the identical query identity');
  assert.deepEqual(JSON.parse(countKey),lateNodes.find(n=>n.props?.auctionResults).props.initial);
 }finally{delete (globalThis as any).__ajesTest;}
});

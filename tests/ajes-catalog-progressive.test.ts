import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('ready cards do not wait for optional brand/model directories; exact selected controls survive',async()=>{
 let calls=0;const never=new Promise(()=>{});
 let readyCount:any={total:1},countResult:any=never,readOptions:any,countKey='',pageMetadata:any={};
 (globalThis as any).__ajesTest={readAjesCatalogPage:async(_q:any,_measure:any,options:any)=>{readOptions=options;return {countSummary:readyCount,page:1,total:1,items:[{id:'car1',make:'Toyota',model:'COROLLA'}],hasMore:false,...pageMetadata};},readAjesMakes:()=>{calls++;return never;},readAjesDirectory:()=>{calls++;return never;},readAjesCountSummary:(key:string)=>{calls++;countKey=key;return countResult;}};
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
    if(args.path.endsWith('/japan-source-power'))return {contents:'export const JAPAN_SOURCE_POWER_NOTICE="Предварительные значения; неизвестные сохранены";'};
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
  assert.deepEqual(readOptions,{includeCount:false});
  const walk=(node:any):any[]=>!node||typeof node!=='object'?[]:[node,...Object.values(node.props||{}).flatMap(v=>Array.isArray(v)?v.flatMap(walk):walk(v))];
  const nodes=walk(root),filters=nodes.find(n=>n.props?.auctionResults);
  assert.ok(nodes.some(n=>n.props?.queryKey===JSON.stringify(filters.props.initial)&&n.props?.text==='1'),'ready aggregate is shared under the exact filter query');
  assert.equal(filters.props.initial.city,'Новокузнецк');assert.equal(filters.props.initial.make,'Toyota');
  assert.ok(filters.props.facets.makes.includes('Toyota'));assert.ok(nodes.some(n=>n.props?.initialCount===1));
  readyCount=null;
  const lateRoot=await mod.exports.AjesCatalog({params:{market:'japan',fuel:'petrol',city:'Новокузнецк'}});
  assert.equal(calls,0,'late count does not precede ready cards');
  const lateNodes=walk(lateRoot),late=lateNodes.find(n=>n.type?.name==='AjesIndependentCount');assert.ok(late);
  countResult=Promise.resolve({total:42});
  const counterNodes=walk(await late.type(late.props));
  assert.ok(counterNodes.some(n=>n.props?.text==='42'&&n.props?.total===42),'late aggregate includes the numeric pagination value');
  assert.ok(lateNodes.some(n=>n.props?.resultQueryKey===countKey),'pagination and independent aggregate use the identical query identity');
  assert.deepEqual(JSON.parse(countKey),lateNodes.find(n=>n.props?.auctionResults).props.initial);
  readyCount={total:999999};pageMetadata={total:null,countIncomplete:true,powerIncomplete:true,powerUnknownCount:1,powerPreliminaryCount:0};
  const beforePower=calls;
  const powerRoot=await mod.exports.AjesCatalog({params:{market:'japan',powerTo:'160'}});
  const powerNodes=walk(powerRoot),powerUpdate=powerNodes.find(n=>n.props?.queryKey&&n.props?.text);
  assert.equal(powerUpdate.props.text,'Количество уточняется','the fixed header does not retain an initial-page shown count after load more');
  assert.equal(powerUpdate.props.total,undefined);
  assert.equal(powerNodes.some(n=>n.type?.name==='AjesIndependentCount'),false,'an unfiltered supplier count never replaces the power-filter status');
  assert.equal(calls,beforePower);
  assert.ok(powerNodes.some(n=>n.type==='p'&&n.props.role==='status'&&String(n.props.children).includes('В первой загруженной подборке')));
  assert.ok(powerNodes.some(n=>n.props?.initialCount===1&&n.props.initialTotal===null),'the unknown-power card still reaches load more');
 }finally{delete (globalThis as any).__ajesTest;}
});

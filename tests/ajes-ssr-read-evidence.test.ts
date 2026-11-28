import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {AjesCursorRefreshRequired} from '../apps/web/lib/catalog/ajes-query';
import {ajesSsrReadEvidence,AJES_SSR_READ_EVIDENCE_BYTES,AJES_SSR_READ_EVIDENCE_LIMIT,
  AJES_SSR_READ_EVIDENCE_ATTRIBUTE} from '../apps/web/lib/catalog/ajes-ssr-read-evidence';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const receipt=(index=1)=>({version:1,requestId:'12345678-1234-4234-8234-'+String(index).padStart(12,'0'),
  queryHash:'a'.repeat(64),table:'stats',kind:'list',page:index,pageSize:24,startedAt:'2026-11-27T06:42:50.000Z',
  finishedAt:'2026-11-27T06:42:51.000Z',stage:'supplier',supplierAttempted:true,outcome:'stale',
  reason:'invalid_response',observedAt:'2026-11-27T01:56:14.520Z'});
const parse=(value:string|undefined)=>{assert.equal(typeof value,'string');return JSON.parse(value!);};

test('SSR evidence is bound to visible page and exact after without serializing a query, URL or source body',()=>{
  const row=receipt(3),before=structuredClone(row),after='j1.2.3.2.'+'b'.repeat(64)+'.'+'c'.repeat(64);
  const value=parse(ajesSsrReadEvidence(2,after,[row]));
  assert.deepEqual(value,{version:1,page:2,afterSha256:hash(after),receipts:[row],omitted:0});
  assert.deepEqual(row,before);assert.equal(value.receipts[0].observedAt,before.observedAt);
  assert.equal(parse(ajesSsrReadEvidence('1',undefined,[])).afterSha256,hash(''));
  assert.equal(parse(ajesSsrReadEvidence(1,'',[])).afterSha256,hash(''));
  assert(!JSON.stringify(value).includes(after));
});

test('foreign fields, private text and accessors never cross the SSR boundary or execute',()=>{
  let invoked=false;
  const getter={...receipt()};Object.defineProperty(getter,'reason',{enumerable:true,get(){invoked=true;return 'PRIVATE_SECRET';}});
  const coercion={toString(){invoked=true;return 'PRIVATE_SECRET';}};
  const hidden={...receipt()};Object.defineProperty(hidden,'body',{value:'PRIVATE_SECRET'});
  const symbol={...receipt(),[Symbol('private')]: 'PRIVATE_SECRET'};
  const invalid=[{...receipt(),sql:'SELECT PRIVATE_SECRET'}, {...receipt(),clientIp:'203.0.113.1'},
    {...receipt(),endpoint:'https://private.invalid'}, {...receipt(),reason:'PRIVATE_SECRET'},
    {...receipt(),queryHash:coercion}, {...receipt(),toJSON(){invoked=true;return 'PRIVATE_SECRET';}}, getter,hidden,symbol];
  for(const row of invalid){
    const raw=ajesSsrReadEvidence(2,'private cursor',[row]),value=parse(raw);
    assert.deepEqual(value.receipts,[]);assert.equal(value.omitted,1);
    assert.doesNotMatch(raw!,/PRIVATE_SECRET|SELECT|203\.0\.113|private\.invalid|private cursor/);
  }
  const accessorArray:any[]=[];Object.defineProperty(accessorArray,'0',{get(){invoked=true;return receipt();},configurable:true});
  assert.equal(parse(ajesSsrReadEvidence(2,'',accessorArray)).omitted,1);assert.equal(invoked,false);
});

test('oversized input has a fixed projection budget and keeps the final failure with explicit omissions',()=>{
  const rows=Array.from({length:1000},(_,index)=>receipt(index+1));
  rows[999]={...rows[999],stage:'empty_verification'};
  const raw=ajesSsrReadEvidence(2,'',rows)!,value=parse(raw);
  assert.equal(value.receipts.length,AJES_SSR_READ_EVIDENCE_LIMIT);assert.equal(value.omitted,992);
  assert.deepEqual(value.receipts.map((row:any)=>row.page),[1,2,3,4,997,998,999,1000]);
  assert.equal(value.receipts.at(-1).stage,'empty_verification');assert(Buffer.byteLength(raw)<=AJES_SSR_READ_EVIDENCE_BYTES);
  assert.equal(parse(ajesSsrReadEvidence(2,'',[receipt(),receipt()])).omitted,1);
  assert.equal(parse(ajesSsrReadEvidence(2,'',[{...receipt(),reason:'x'.repeat(1000000)}])).omitted,1);
  assert.equal(ajesSsrReadEvidence(2,'x'.repeat(513),rows),undefined);
  assert.equal(ajesSsrReadEvidence(2,'',new Array(1_000_001)),undefined);
});

test('invalid binding and malformed finite fields produce no forged receipt',()=>{
  for(const page of [0,-1,1.5,1_000_001,'2private',{},null])assert.equal(ajesSsrReadEvidence(page,'',[]),undefined);
  for(const after of [null,{},1])assert.equal(ajesSsrReadEvidence(2,after,[]),undefined);
  assert.equal(ajesSsrReadEvidence(2,'',{}),undefined);
  for(const patch of [{page:0},{pageSize:501},{version:2},{requestId:'x'.repeat(36)},{queryHash:'z'.repeat(64)},
    {startedAt:'tomorrow'},{finishedAt:'2026-11-27T06:42:49.000Z'},{observedAt:'private'},
    {supplierAttempted:'true'},{outcome:'private'},{stage:'private'}]){
    assert.deepEqual(parse(ajesSsrReadEvidence(2,'',[{...receipt(),...patch}])).receipts,[]);
  }
  for(const [startedAt,finishedAt] of [['2026-11-27T06:42:50Z','2026-11-27T06:42:50.000Z'],
    ['2026-11-27T06:42:50.000Z','2026-11-27T06:42:50Z'],['2026-11-27T06:42:50Z','2026-11-27T06:42:50.001Z']]){
    assert.equal(parse(ajesSsrReadEvidence(2,'',[{...receipt(),startedAt,finishedAt}])).receipts.length,1);
  }
  assert.deepEqual(parse(ajesSsrReadEvidence(2,'',[{...receipt(),startedAt:'2026-11-27T06:42:50.500Z',
    finishedAt:'2026-11-27T06:42:50Z'}])).receipts,[]);
});

test('actual AjesCatalog renders only the annotation on Japan main and retains initial failure receipts',async()=>{
  class Unavailable extends Error {reason:string;constructor(reason:string){super(reason);this.reason=reason;}}
  const state:{value:any;error?:unknown;reads:number;Unavailable:typeof Unavailable;Refresh:typeof AjesCursorRefreshRequired}={value:null,reads:0,Unavailable,Refresh:AjesCursorRefreshRequired};
  (globalThis as any).__japanSsrEvidenceFixture=state;
  const require=createRequire(import.meta.url);
  const mocks:Record<string,string>={
    'ajes-catalog':"export class AjesFilterUnavailable extends Error{};export const readAjesCatalogPage=async()=>{const s=globalThis.__japanSsrEvidenceFixture;s.reads++;if(s.error)throw s.error;return s.value;};export const readAjesCountSummary=async()=>null;export const readAjesMakes=async()=>({makes:[]});",
    'ajes-client':"export const AjesUnavailable=globalThis.__japanSsrEvidenceFixture.Unavailable;",
    'ajes-query':'export class AjesInputError extends Error{};export const AjesCursorRefreshRequired=globalThis.__japanSsrEvidenceFixture.Refresh;',
    'DealerBrowsingContext':'export const DealerLink=()=>null;',
    'CatalogSelectionContext':'export const CatalogResultCountUpdate=()=>null;export const useCatalogLoadedCount=()=>null;export const useCatalogResultCount=()=>null;',
    'catalog-routes':"export const catalogSearchHeading=()=> 'Япония';",
  };
  for(const name of ['CatalogSidebar','CatalogLoadMore','PublicHeader','CatalogCard','CatalogFilters','BrandLogoRail',
    'JapanSectionTabs','CatalogMarketFlag','MarketResultCount','CatalogCountLabel'])mocks[name]=`export function ${name}(){return null;}`;
  try{
    const built=await build({entryPoints:['apps/web/components/catalog/AjesCatalog.tsx'],bundle:true,platform:'node',format:'cjs',
      write:false,jsx:'automatic',packages:'external',tsconfig:'apps/web/tsconfig.json',plugins:[{name:'ssr-evidence-fixture',setup(b){
        b.onResolve({filter:/.*/},args=>{const name=args.path.split('/').at(-1)!;return name in mocks?{path:name,namespace:'stub'}:undefined;});
        b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:mocks[args.path]}));
      }}]});
    const module={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,module,module.exports);
    state.value={items:[],page:2,total:null,countSummary:null,hasMore:false,stale:true,partial:true,sourceReceipts:[receipt(3)],
      body:'PRIVATE_WHOLE_RESULT',sql:'SELECT PRIVATE_WHOLE_RESULT',nextCursor:null};
    const params={market:'japan',page:'2',after:'2.3'};
    const tree=await module.exports.AjesCatalog({params});
    assert.equal(tree.type,'main');assert.deepEqual(parse(tree.props[AJES_SSR_READ_EVIDENCE_ATTRIBUTE]),
      {version:1,page:2,afterSha256:hash('2.3'),receipts:[receipt(3)],omitted:0});
    assert(!tree.props[AJES_SSR_READ_EVIDENCE_ATTRIBUTE].includes('PRIVATE_WHOLE_RESULT'));
    assert.equal((await module.exports.AjesCatalog({params,embedded:true})).props[AJES_SSR_READ_EVIDENCE_ATTRIBUTE],undefined);
    state.error=Object.assign(new Unavailable('invalid_response'),{sourceReceipt:{...receipt(3),outcome:'unavailable'},body:'PRIVATE_EXCEPTION'});
    const failed=await module.exports.AjesCatalog({params});
    assert.equal(parse(failed.props[AJES_SSR_READ_EVIDENCE_ATTRIBUTE]).receipts[0].outcome,'unavailable');
    assert(!failed.props[AJES_SSR_READ_EVIDENCE_ATTRIBUTE].includes('PRIVATE_EXCEPTION'));
    state.error=Error('PRIVATE_EXCEPTION');
    assert.deepEqual(parse((await module.exports.AjesCatalog({params})).props[AJES_SSR_READ_EVIDENCE_ATTRIBUTE]).receipts,[]);
    assert.equal(state.reads,4,'projection introduces no source, count or directory read');
    state.error=new AjesCursorRefreshRequired();
    for(const pagination of [{page:'1'},{page:'2',after:'obsolete-cursor'}]){
      const reset=await module.exports.AjesCatalog({params:{market:'japan',city:'Новокузнецк',fuel:'petrol',powerTo:'160',...pagination}});
      const nodes:any[]=[];const visit=(value:any)=>{if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object'){nodes.push(value);visit(value.props?.children);}};visit(reset);
      const restart=nodes.find(node=>node.props?.children==='Открыть первую страницу');assert.ok(restart,'a mid-read epoch change on page one also has a real restart link');
      const url=new URL(restart.props.href,'https://fixture.test');
      assert.equal(url.pathname,'/cars');assert.equal(url.searchParams.get('market'),'japan');
      assert.equal(url.searchParams.get('city'),'Новокузнецк');assert.equal(url.searchParams.get('fuel'),'petrol');assert.equal(url.searchParams.get('powerTo'),'160');
      assert.equal(url.searchParams.has('after'),false);assert.equal(url.searchParams.has('page'),false);
      assert.ok(nodes.some(node=>node.props?.resultError?.includes('выбранные фильтры сохранены')));
      assert.deepEqual(parse(reset.props[AJES_SSR_READ_EVIDENCE_ATTRIBUTE]).receipts,[]);
    }
    assert.equal(state.reads,6,'refresh UI adds no supplementary source read');
  }finally{delete (globalThis as any).__japanSsrEvidenceFixture;}
});

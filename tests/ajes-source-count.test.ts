import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {createAjesSourceCountSummary,isAjesSourceCountSummary,AJES_SOURCE_COUNT_FRESH_MS,AJES_SOURCE_COUNT_RETAINED_MS,AJES_SOURCE_COUNT_PREDICATE_VERSION} from '../apps/web/lib/catalog/ajes-source-count';

const observedAt='2026-11-28T08:00:00Z',observed=Date.parse(observedAt),now=observed+15*60_000;
const binding={requestedQueryHash:'a'.repeat(64),sourceQueryHash:'b'.repeat(64),evidenceEpoch:'c'.repeat(64),sourceScopeComplete:true,directoryComplete:true};

test('source scalar evidence preserves positive values and cannot claim admitted coverage',()=>{
 for(const total of [1,24,628115,Number.MAX_SAFE_INTEGER]){
  const summary=createAjesSourceCountSummary({total,stale:false,observedAt},binding,now);
  assert.equal(summary.total,total);assert.equal(summary.upperBound,true);
  assert.equal(summary.precision,'source-upper-bound');assert.equal(summary.selectionScope,'source-candidates');
  assert.equal(summary.sourceScopeComplete,true);assert.equal(summary.sourceCountProof.sourceTotal,total);
  assert.equal(summary.sourceCountProof.sourceObservedAt,observedAt);
  assert.equal(isAjesSourceCountSummary(summary,binding,now),true);
  assert.equal(Object.hasOwn(summary,'countProof'),false);
  assert.equal(Object.hasOwn(summary.sourceCountProof,'admittedTotal'),false);
  assert.equal(Object.isFrozen(summary),true);assert.equal(Object.isFrozen(summary.sourceCountProof),true);
 }
});
test('restricted scope, missing directories and zero stay explicitly source-bound',()=>{
 for(const sourceScopeComplete of [true,false])for(const total of [0,46]){
  const selected={...binding,sourceScopeComplete};
  const summary=createAjesSourceCountSummary({total,stale:false,observedAt},selected,now);
  assert.equal(summary.total,total);assert.equal(summary.upperBound,true);
  assert.equal(summary.sourceScopeComplete,sourceScopeComplete);
  assert.equal(summary.sourceCountProof.sourceScopeComplete,sourceScopeComplete);
 }
 const missing=createAjesSourceCountSummary({total:0,stale:false,observedAt},{...binding,sourceScopeComplete:false,directoryComplete:false},now);
 assert.equal(missing.sourceCountProof.directoryComplete,false);
 assert.throws(()=>createAjesSourceCountSummary({total:0,stale:false,observedAt},{...binding,directoryComplete:false},now),/ajes_source_count_invalid/);
});
test('fresh and retained source counts expire from the original observation, never from recovery time',()=>{
 const source={total:84,stale:false,observedAt};
 assert.equal(isAjesSourceCountSummary(createAjesSourceCountSummary(source,binding,observed),binding,observed+AJES_SOURCE_COUNT_FRESH_MS-1),true);
 assert.throws(()=>createAjesSourceCountSummary(source,binding,observed+AJES_SOURCE_COUNT_FRESH_MS),/ajes_source_count_invalid/);
 const stale=createAjesSourceCountSummary({...source,stale:true},binding,observed+AJES_SOURCE_COUNT_FRESH_MS);
 assert.equal(stale.observedAt,observedAt);assert.equal(stale.sourceCountProof.sourceObservedAt,observedAt);
 assert.equal(isAjesSourceCountSummary(stale,binding,observed+AJES_SOURCE_COUNT_RETAINED_MS-1),true);
 assert.equal(isAjesSourceCountSummary(stale,binding,observed+AJES_SOURCE_COUNT_RETAINED_MS),false);
 assert.throws(()=>createAjesSourceCountSummary({...source,stale:true},binding,observed+AJES_SOURCE_COUNT_RETAINED_MS),/ajes_source_count_invalid/);
 assert.throws(()=>createAjesSourceCountSummary(source,binding,observed-1),/ajes_source_count_invalid/);
});
test('source evidence rejects invalid, partial, stale-mislabeled and context-mismatched counts',()=>{
 for(const total of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'24',null,undefined])
  assert.throws(()=>createAjesSourceCountSummary({total,stale:false,observedAt},binding,now),/ajes_source_count_invalid/);
 for(const patch of [{partial:true},{upperBound:true},{stale:undefined},{stale:'false'},{observedAt:''},{observedAt:'not-a-date'}])
  assert.throws(()=>createAjesSourceCountSummary({total:24,stale:false,observedAt,...patch},binding,now),/ajes_source_count_invalid/);
 const source=createAjesSourceCountSummary({total:24,stale:false,observedAt},binding,now);
 for(const key of ['requestedQueryHash','sourceQueryHash','evidenceEpoch'] as const)
  assert.equal(isAjesSourceCountSummary(source,{...binding,[key]:'d'.repeat(64)},now),false,key);
 for(const patch of [{total:25},{observedAt:'2026-11-28T08:01:00Z'},{upperBound:false},{precision:'exact'},{selectionScope:'admitted'},{sourceScopeComplete:false}])
  assert.equal(isAjesSourceCountSummary({...source,...patch},binding,now),false);
 for(const patch of [{version:2},{kind:'japan-admitted-census'},{predicateVersion:'previous'},{sourceTotal:25},{sourceObservedAt:'2026-11-28T08:01:00Z'},{sourceQueryHash:'invalid'}])
  assert.equal(isAjesSourceCountSummary({...source,sourceCountProof:{...source.sourceCountProof,...patch}},binding,now),false);
 assert.equal(isAjesSourceCountSummary({total:0,stale:false,observedAt,upperBound:true},{},now),false,'legacy zero sentinels have no source evidence');
});

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const catalogText=readFileSync(new URL('../apps/web/lib/catalog/ajes-catalog.ts',import.meta.url),'utf8');
const censusText=readFileSync(new URL('../apps/web/lib/catalog/ajes-census.ts',import.meta.url),'utf8');
const cacheText=readFileSync(new URL('../apps/web/lib/catalog/detail-read-cache.ts',import.meta.url),'utf8');
const stripped=(source:string)=>stripTypeScriptTypes(source,{mode:'transform'}).replace(/\bexport\s+/g,'');
const Cache=new Function(stripped(cacheText)+'\nreturn DetailReadCache;')();
const upper=catalogText.slice(catalogText.indexOf('type AjesAvailableCountSummary='),catalogText.indexOf('export const readAjesCount='));
assert.ok(upper.includes('export const readAjesCountSummary='));
const requestHelpers=censusText.slice(censusText.indexOf('export function ajesRequestedCountQuery('),censusText.indexOf('/** These source restrictions'));
const helpers=new Function('hash',stripped(requestHelpers)+'\nreturn {ajesRequestedCountQuery,ajesRequestedCountQueryHash};')(hash);
const scopeSource=censusText.match(/export function ajesSourceScopeSupportsExactCount[\s\S]*?\n}/)?.[0];
assert.ok(scopeSource);
const sourceScope=new Function(stripped(scopeSource)+'\nreturn ajesSourceScopeSupportsExactCount;')();

class SourceUnavailable extends Error{constructor(public reason:string){super(reason);}}
class RefreshRequired extends Error{}
function fixture(){
 const state={queries:[] as any[],zeroCalls:0,enabled:true,revision:'initial',makeDirectoryUnavailable:false,modelDirectoryUnavailable:false,
  source:{total:84,stale:false,observedAt} as any,onRead:null as null|(()=>void)};
 const snapshot=()=>({editorial:{revision:state.revision,entries:{}},calculationIndex:null});
 const dependencies={
  DetailReadCache:Cache,createHash,cache:(fn:any)=>fn,process:{env:{AVTOCENA_RELEASE_SHA:'a'.repeat(40)}},
  createAjesSourceCountSummary,isAjesSourceCountSummary,AJES_SOURCE_COUNT_PREDICATE_VERSION,
  AJES_CENSUS_PREDICATE_VERSION:'japan-admitted-census-zero-v2',
  assertAjesJapanMarket:(market:string)=>assert.equal(market,'japan'),
  assertCollectionEnabled:async()=>{if(!state.enabled)throw new SourceUnavailable('disabled');},
  ajesResultFilter:()=>({}),
  resolvedCatalogQuery:async(key:string)=>{
   const p=JSON.parse(key),q:any={table:'stats',page:1,pageSize:24};
   for(const field of ['make','model','fuel','drive','color','transmission','pickup','engineFrom','engineTo','powerFrom','powerTo','yearFrom','page','pageSize','sort'])
    if(p[field]!==undefined)q[field]=p[field];
   return {query:q,makeDirectoryUnavailable:state.makeDirectoryUnavailable,modelDirectoryUnavailable:state.modelDirectoryUnavailable};
  },
  ajesSourceScopeSupportsExactCount:sourceScope,
  readAjesPublicEvidenceSnapshot:async()=>snapshot(),
  ajesQuery:(q:any)=>({sql:'select count(*) from stats where fixture='+JSON.stringify(q)}),
  ajesPowerEvidenceEpoch:hash,AjesCursorRefreshRequired:RefreshRequired,
  ...helpers,headers:async()=>new Map([['x-real-ip','127.0.0.1']]),
  cappedAjesQuery:async(q:any)=>q,AjesUnavailable:SourceUnavailable,
  ajesClient:{read:async(q:any,ip:string)=>{assert.equal(ip,'127.0.0.1');state.queries.push(q);state.onRead?.();if(state.source instanceof Error)throw state.source;return state.source;}},
  readAjesCensusCount:async(options:any)=>{
   state.zeroCalls++;assert.equal(options.sourceCount.total,0);assert.equal(sourceScope(options.query),true);
   await options.assertCurrent();
   return {total:0,stale:false,observedAt:options.sourceCount.observedAt,upperBound:false,countProof:{sourceTotal:0,complete:true,predicateVersion:'japan-admitted-census-zero-v2'}};
  },
 };
 const read=new Function(...Object.keys(dependencies),stripped(upper)+'\nreturn readAjesCountSummary;')(...Object.values(dependencies));
 return {state,read:(params:any)=>read(JSON.stringify({market:'japan',...params}))};
}

test('actual count reader exposes positive candidate counts for all filter scopes using scalar COUNT only',async t=>{
 t.mock.method(Date,'now',()=>now);
 const {state,read}=fixture();
 for(const params of [{},{powerTo:'160'},{budgetTo:'3000000'},{bodyType:'sedan'},{hasPrice:'yes'},{fuel:'petrol'},{drive:'awd'},{transmission:'automatic'},{color:'white'},{engineTo:'2000'},{pickup:true}]){
  const summary=await read(params);
  assert.equal(summary.total,84);assert.equal(summary.upperBound,true);
  assert.equal(summary.sourceScopeComplete,sourceScope(state.queries.at(-1)));
  assert.equal(summary.sourceCountProof.requestedQueryHash,helpers.ajesRequestedCountQueryHash({market:'japan',...params}));
  assert.equal(Object.hasOwn(summary,'countProof'),false);
 }
 assert.equal(state.queries.length,11);assert.equal(state.zeroCalls,0);
 assert.ok(state.queries.every(q=>q.aggregate==='count'&&q.countIdentity===undefined&&q.censusFields===undefined));
 assert.ok(state.queries.every(q=>q.page===undefined&&q.pageSize===undefined&&q.sort===undefined));
});
test('actual count reader caches fresh scalars across pagination and sort without extending their source date',async t=>{
 let current=now;t.mock.method(Date,'now',()=>current);
 const {state,read}=fixture();
 const first=await read({make:'AUDI',model:'A4'});
 const next=await read({make:'AUDI',model:'A4',page:2,pageSize:24,after:'existing-cursor',sort:'year'});
 assert.equal(next,first);assert.equal(state.queries.length,1);
 current=observed+AJES_SOURCE_COUNT_FRESH_MS-1;
 assert.equal(await read({make:'AUDI',model:'A4'}),first);assert.equal(state.queries.length,1);
 current=observed+AJES_SOURCE_COUNT_FRESH_MS;
 state.source={total:84,stale:true,observedAt};
 const retained=await read({make:'AUDI',model:'A4'});
 assert.equal(retained.stale,true);assert.equal(retained.observedAt,observedAt);assert.equal(state.queries.length,2);
 await read({make:'AUDI',model:'A4'});
 assert.equal(state.queries.length,3,'retained recovery does not enter the fresh scalar cache');
});
test('only a fresh scalar zero with complete source and directory scope takes the admitted-zero path',async t=>{
 t.mock.method(Date,'now',()=>now);
 const {state,read}=fixture();state.source={total:0,stale:false,observedAt};
 const exact=await read({yearFrom:2020});assert.equal(exact.upperBound,false);assert.equal(state.zeroCalls,1);
 const restricted=await read({yearFrom:2020,fuel:'petrol'});
 assert.equal(restricted.total,0);assert.equal(restricted.upperBound,true);assert.equal(restricted.sourceScopeComplete,false);
 state.makeDirectoryUnavailable=true;
 const unresolved=await read({make:'AUDI',yearFrom:2020});
 assert.equal(unresolved.upperBound,true);assert.equal(unresolved.sourceScopeComplete,false);assert.equal(unresolved.sourceCountProof.directoryComplete,false);
 state.makeDirectoryUnavailable=false;state.modelDirectoryUnavailable=true;
 assert.equal((await read({make:'AUDI',model:'A4',yearFrom:2020})).upperBound,true);
 state.modelDirectoryUnavailable=false;state.source={total:0,stale:true,observedAt};
 assert.equal((await read({yearFrom:2021})).upperBound,true);assert.equal(state.zeroCalls,1);
});
test('source errors, invalid counts and changed local evidence cannot manufacture or renew a count',async t=>{
 t.mock.method(Date,'now',()=>now);
 for(const source of [new SourceUnavailable('visitor_restricted'),{total:84,stale:false,observedAt,partial:true},
  {total:84,stale:false,observedAt:'2026-11-28T07:00:00Z'},{total:84,stale:true,observedAt:'2026-11-21T08:00:00Z'}]){
  const {state,read}=fixture();state.source=source;
  await assert.rejects(read({}),SourceUnavailable);
  assert.equal(state.zeroCalls,0);assert.equal(state.queries.length,1);
 }
 const changed=fixture();changed.state.onRead=()=>{changed.state.revision='changed';};
 await assert.rejects(changed.read({}),RefreshRequired);assert.equal(changed.state.zeroCalls,0);
 const disabled=fixture();disabled.state.enabled=false;
 await assert.rejects(disabled.read({}),SourceUnavailable);assert.equal(disabled.state.queries.length,0);
});


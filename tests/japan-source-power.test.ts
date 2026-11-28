import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseJapanSourcePower,japanSupplierPower,japanSupplierPreviewPower,japanSupplierPowerLabel,japanUnknownPower,japanPowerFilterSummary,japanPowerFilterNotice} from '../apps/web/lib/catalog/japan-source-power';
import {ajesResultFilter} from '../apps/web/lib/catalog/ajes-result-filter';
import {ajesPowerEstimateHp} from '../apps/web/lib/catalog/ajes-power-estimate';
import {ajesCatalogQuery,ajesLot,ajesQuery,ajesSourceCacheSql,AJES_CENSUS_FIELDS,AjesInputError,AjesCursorRefreshRequired} from '../apps/web/lib/catalog/ajes-query';
import {ajesOffer} from '../apps/web/lib/catalog/ajes-offer';
import {createAjesClient,AjesUnavailable} from '../apps/web/lib/catalog/ajes-client';
import {publicOffer} from '../apps/web/lib/catalog/storage';
import {offerParameterDraft} from '../apps/web/lib/catalog/offer-parameter-draft';
import {japanPreviewParameters} from '../apps/web/lib/catalog/japan-preview-parameters';
import {validateCustomerParameters} from '../apps/web/lib/catalog/customer-parameters';
import {powerUnitPatch} from '../apps/web/lib/catalog/power-parameter-draft';
import {readFilteredAjesPage,ajesPowerEvidenceEpoch} from '../apps/web/lib/catalog/ajes-filtered-page';
import {ajesErrorResponse} from '../apps/web/lib/catalog/ajes-error-response';
import {applyJapanOwnerSpecifications} from '../apps/web/lib/catalog/japan-owner-specifications';
import {sortCatalogRows} from '../apps/web/lib/catalog/market-page';
import {priceCardForCity} from '../apps/web/lib/catalog/card-city-delivery';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as census from '../apps/web/lib/catalog/ajes-census';

const row={ID:'power-fixture',MARKA_NAME:'TOYOTA',MODEL_NAME:'TEST',YEAR:2023,AUCTION_TYPE:2,STATUS:'Sold',FINISH:935000,TIME:'P',PW:'150',ENG_V:1490,IMAGES:''};
const rate={currency:'JPY',sourcePrice:935000,effectiveRate:0.6,cbrRate:60,nominal:100,rateDate:'2026-11-26',rateSource:'cbr'} as any;
function offer(power:unknown,id='power-fixture',fuel='P'){
 return ajesOffer(ajesLot({...row,ID:id,PW:power,TIME:fuel},'stats',false)!,rate,'2026-11-26T04:00:00Z');
}

const sourcePage=(query:any,items:any[],received=items.length,flags:Record<string,unknown>={})=>({items,page:query.page||1,pageSize:query.pageSize||24,received,partial:false,stale:false,observedAt:'2026-11-26T06:02:33.366Z',...flags});
async function catalogPowerFixture(read:(query:any,options?:any)=>unknown|Promise<unknown>){
 const state={queries:[] as any[],counts:0,priced:[] as string[][],snapshots:[] as any[],editorialRevision:'fixture-1',calculationDigest:null as string|null,runtimeSha:'1'.repeat(40),
  evidenceReader:undefined as undefined|(()=>Promise<any>),price:undefined as undefined|((rows:any[])=>Promise<any[]>),rawRead:undefined as undefined|((query:any)=>Promise<any>),censusRate:undefined as undefined|((amount:number)=>any),
  controlledCount:undefined as undefined|((options:any)=>Promise<any>),savedCount:undefined as undefined|((path:string)=>Promise<any>),countWrites:[] as any[],Unavailable:AjesUnavailable,Input:AjesInputError,Refresh:AjesCursorRefreshRequired,
  census,compileQuery:ajesQuery,query:ajesCatalogQuery,filter:ajesResultFilter,project:publicOffer,sort:sortCatalogRows,read:async(query:any,options:any)=>{state.queries.push(query);state.snapshots.push(options?.evidenceSnapshot);return read(query,options);}};
 (globalThis as any).__japanPowerPageFixture=state;
 const stubs:Record<string,string>={
  'server-only':'','next/headers':"export const headers=async()=>new Map([['x-real-ip','127.0.0.1']]);",
  './ajes-census':"export const {ajesCensusFields,ajesRequestedCountQuery,ajesRequestedCountQueryHash,AJES_CENSUS_PREDICATE_VERSION}=globalThis.__japanPowerPageFixture.census;export const readAjesCensusCount=options=>{const s=globalThis.__japanPowerPageFixture;return s.controlledCount?s.controlledCount(options):s.census.readAjesCensusCount(options);};",
  '../data':"export const getJsonStorage=()=>({readJson:async path=>globalThis.__japanPowerPageFixture.savedCount?.(path)??null,writeJson:async(path,value)=>{globalThis.__japanPowerPageFixture.countWrites.push({path,value});}});export const readDataJson=async()=>null;export const mutateDataJson=async()=>{throw Error('unexpected private write');};export const getDataRoot=()=>'/tmp';",
  './rates':"export const convertToRub=async amount=>globalThis.__japanPowerPageFixture.censusRate?.(amount)??null;",
  './ajes-count-pricing-context':`export const captureAjesCountPricingContext=async()=>({run:async work=>work(),price:async rows=>{const s=globalThis.__japanPowerPageFixture;s.priced.push(rows.map(row=>row.id));return s.price?s.price(rows):rows;}});`,
  './ajes-runtime':"export const ajesClient={read:async query=>{const s=globalThis.__japanPowerPageFixture;s.counts++;if(s.rawRead)return s.rawRead(query);throw Error('unexpected source aggregate');}};",
  './ajes-public':`export const cappedAjesQuery=async q=>q;export const readAjesPublic=(q,o)=>globalThis.__japanPowerPageFixture.read(q,o);
   export const readAjesPublicEvidenceSnapshot=async()=>{const s=globalThis.__japanPowerPageFixture;return s.evidenceReader?s.evidenceReader():Object.freeze({editorial:{revision:s.editorialRevision,entries:{}},calculationIndex:s.calculationDigest?{digest:s.calculationDigest}:null});};`,
  './ajes-query':'export const ajesQuery=(...args)=>globalThis.__japanPowerPageFixture.compileQuery(...args);export const ajesCatalogQuery=p=>globalThis.__japanPowerPageFixture.query(p);export class AjesFilterUnavailable extends Error{};export const AjesInputError=globalThis.__japanPowerPageFixture.Input;export const AjesCursorRefreshRequired=globalThis.__japanPowerPageFixture.Refresh;',
  './ajes-client':'export const readAjesModelDirectory=async()=>({models:[]});export const readAjesMakeDirectory=async()=>({makes:[]});export const AjesUnavailable=globalThis.__japanPowerPageFixture.Unavailable;',
  './ajes-result-filter':'export const ajesResultFilter=p=>globalThis.__japanPowerPageFixture.filter(p);',
  './storage':'export const publicOffer=x=>globalThis.__japanPowerPageFixture.project(x);','./market-page':'export const sortCatalogRows=(...args)=>globalThis.__japanPowerPageFixture.sort(...args);',
  './live-business-pricing':'export const applyActiveBusinessPricingBatch=async rows=>{const s=globalThis.__japanPowerPageFixture;s.priced.push(rows.map(row=>row.id));return s.price?s.price(rows):rows;};',
  './collection-controls':'export const assertCollectionEnabled=async()=>{};',
  './japan-preview-parameters':'export const japanPreviewParameters=()=>({});',
  '../encyclopedia/calculation-evidence':'export const hasEncyclopediaCalculationEvidence=()=>false;',
 };
 const bundle=await build({entryPoints:['apps/web/lib/catalog/ajes-catalog.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['react'],define:{'process.env.AVTOCENA_RELEASE_SHA':'globalThis.__japanPowerPageFixture.runtimeSha'},plugins:[{name:'power-page-fixture',setup(builder){
  builder.onResolve({filter:/.*/},args=>args.path in stubs?{path:args.path,namespace:'power-page-fixture'}:undefined);
  builder.onLoad({filter:/.*/,namespace:'power-page-fixture'},args=>({contents:stubs[args.path]}));
 }}]});
 const module={exports:{} as any},require=createRequire(import.meta.url);
 new Function('require','module','exports',bundle.outputFiles[0].text)((id:string)=>id==='react'?{cache:(fn:any)=>fn}:require(id),module,module.exports);
 return {state,read:(params:any,measure?:any,options?:any)=>module.exports.readAjesCatalogPage(params,measure,{includeCount:false,...options}),
  count:(params:any)=>module.exports.readAjesCountSummary(JSON.stringify(params)),close:()=>{delete (globalThis as any).__japanPowerPageFixture;}};
}

/** An immutable, completely provided local collection supplies the counter
 * boundary for pagination tests. This is not the production AJ count reader:
 * that reader rejects every positive source count without a snapshot contract. */
function installControlledCountFixture(fixture:Awaited<ReturnType<typeof catalogPowerFixture>>,sourceRows:Array<Record<string,any>>){
 const groups=new Map<string,any>();
 for(const source of sourceRows){
  const values=Object.fromEntries(AJES_CENSUS_FIELDS.map(field=>[field,source[field]??''])),key=JSON.stringify(values);
  const group=groups.get(key)??{values,total:0,validIds:0,validFinishes:0};group.total++;group.validIds++;group.validFinishes++;groups.set(key,group);
 }
 const observedAt=new Date().toISOString();
 fixture.state.censusRate=amount=>({...rate,sourcePrice:amount,sourcePriceRub:amount*rate.effectiveRate,rateDate:observedAt.slice(0,10)});
 fixture.state.rawRead=async query=>{
  if(query.aggregate==='count')return {items:[],total:sourceRows.length,distinctTotal:new Set(sourceRows.map(row=>row.ID)).size,observedAt,stale:false};
  throw Error('unexpected schema LIST/GROUP request in a controlled count fixture');
 };
 fixture.state.controlledCount=async options=>{
  let admittedTotal=0,knownTotal=0,unknownTotal=0;
  for(const group of groups.values()){
   const evaluated=await census.evaluateAjesCensusGroup(group,{params:options.params,snapshot:options.snapshot,observedAt,
    rate:async amount=>fixture.state.censusRate!(amount)});
   if(evaluated.admitted){admittedTotal+=group.total;if(evaluated.known)knownTotal+=group.total;else unknownTotal+=group.total;}
  }
  const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const sourceQueryHash=createHash('sha256').update(ajesQuery({...options.query,aggregate:'count',countIdentity:true}).sql).digest('hex');
  return {total:admittedTotal,stale:false,upperBound:false,observedAt,countProof:{version:1,kind:'japan-admitted-census',
   predicateVersion:'controlled-japan-admission-fixture-v1',requestedQueryHash:census.ajesRequestedCountQueryHash(options.params),
   queryHash:digest([census.ajesRequestedCountQuery(options.params),options.query]),evidenceEpoch:options.evidenceEpoch,sourceQueryHash,
   coverageHash:digest(sourceRows),complete:true,sourceObservedAt:observedAt,sourceCompletedAt:observedAt,
   sourceTotal:sourceRows.length,sourceDistinctTotal:new Set(sourceRows.map(row=>row.ID)).size,groupedTotal:sourceRows.length,
   groupCount:groups.size,pages:1,baseAdmittedTotal:admittedTotal,correctionCount:0,correctionDelta:0,admittedTotal,knownTotal,unknownTotal}};
 };
}

test('a controlled complete count invalidates an old short uncounted cursor and counted pages partition all73 fixture cars',async()=>{
 const sourceRows=[...Array.from({length:6},(_,i)=>({...row,ID:'early-'+i,PW:'150'})),
  ...Array.from({length:200},(_,i)=>({...row,ID:'rejected-'+i,PW:'220'})),
  ...Array.from({length:44},(_,i)=>({...row,ID:'late-'+i,PW:'150'})),
  ...Array.from({length:23},(_,i)=>({...row,ID:'unknown-'+i,PW:''}))];
 const fixture=await catalogPowerFixture(query=>{
  const selected=sourceRows.slice(((query.page||1)-1)*24,(query.page||1)*24);
  return sourcePage(query,selected.map(row=>offer(row.PW,row.ID)),selected.length,{observedAt:new Date().toISOString()});
 });
 const params={market:'japan',powerTo:'160',city:'Новокузнецк'};
 try{
  const uncounted=await fixture.read(params);assert.equal(uncounted.items.length,6);assert.equal(uncounted.scanLimited,true);
  installControlledCountFixture(fixture,sourceRows);
  const priorReads=fixture.state.queries.length;
  await assert.rejects(fixture.read({...params,page:'2',after:uncounted.nextCursor},undefined,{includeCount:true}),AjesCursorRefreshRequired);
  assert.equal(fixture.state.queries.length,priorReads,'old short cursor is rejected before more LIST reads');
  const ids:string[]=[];let after:string|undefined;
  for(let page=1;page<=4;page++){
   const result=await fixture.read({...params,page:String(page),...(after?{after}:{})},undefined,{includeCount:true});
   assert.equal(result.total,73);assert.equal(result.countSummary.countProof.sourceTotal,273);assert.equal(result.countSummary.countProof.complete,true);
   assert.equal(result.items.length,page===4?1:24);assert.equal(result.hasMore,page<4);assert.equal(result.scanLimited,false);
   ids.push(...result.items.map((item:any)=>item.id));after=result.nextCursor;
  }
  assert.equal(new Set(ids).size,73);assert.equal(ids.length,73);assert.equal(after,null);
 }finally{fixture.close();}
});

test('controlled exact totals close a full last page; contradictory or partial source pages cannot claim an exact ending',async()=>{
 for(const mode of ['full','short','extra','partial'] as const){
  const count=mode==='extra'?23:24,sourceRows=Array.from({length:count},(_,i)=>({...row,ID:'last-'+i,PW:'150'}));
  const fixture=await catalogPowerFixture(query=>{
   const shown=mode==='short'?23:mode==='partial'?6:24;
   return sourcePage(query,Array.from({length:shown},(_,i)=>offer('150','last-'+i)),mode==='partial'?24:shown,{observedAt:new Date().toISOString(),...(mode==='partial'?{partial:true}:{})});
  });
  installControlledCountFixture(fixture,sourceRows);
  try{
   const promise=fixture.read({market:'japan',powerTo:'160'},undefined,{includeCount:true});
   if(mode==='short'||mode==='extra')await assert.rejects(promise,AjesCursorRefreshRequired);
   else{
    const result=await promise;
    assert.equal(result.nextCursor,null);
    if(mode==='full'){assert.equal(result.items.length,24);assert.equal(result.total,24);assert.equal(result.hasMore,false);}
    else{assert.equal(result.items.length,6);assert.equal(result.partial,true);assert.equal(result.hasMore,true);assert.equal(result.total,null);assert.equal(result.countSummary,null);}
   }
  }finally{fixture.close();}
 }
});

test('positive saved census proofs cannot revive through the scalar cache, including a false zero with positive source weight',async()=>{
 for(const power of ['150','220']){
  const fixture=await catalogPowerFixture(()=>{throw Error('unexpected public LIST');});
  const params={market:'japan',powerTo:'160'},sourceRows=[{...row,ID:'saved-positive',PW:power}];
  installControlledCountFixture(fixture,sourceRows);
  const query={...ajesCatalogQuery(params)};delete query.page;delete query.pageSize;delete query.sort;
  const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const evidenceEpoch=digest([census.AJES_CENSUS_PREDICATE_VERSION,ajesPowerEvidenceEpoch({runtimeSha:fixture.state.runtimeSha,
   editorialRevision:fixture.state.editorialRevision,calculationDigest:null}),null]);
  const summary=await fixture.state.controlledCount!({params,query,evidenceEpoch,snapshot:{editorial:{revision:fixture.state.editorialRevision,entries:{}},calculationIndex:null}});
  summary.countProof.predicateVersion=census.AJES_CENSUS_PREDICATE_VERSION;
  const key=digest([census.ajesRequestedCountQuery(params),ajesQuery({...query,aggregate:'count',countIdentity:true}).sql,evidenceEpoch]);
  fixture.state.controlledCount=undefined;
  fixture.state.savedCount=async()=>({key,value:summary});
  try{
   assert.equal(summary.total,power==='150'?1:0);
   await assert.rejects(fixture.count(params),/census_source_snapshot_unavailable/);
   assert.equal(fixture.state.counts,1,'one scalar COUNT; no schema LIST, GROUP or correction request');
   assert.equal(fixture.state.queries.length,0);assert.equal(fixture.state.countWrites.length,0);
  }finally{fixture.close();}
 }
});

test('validated source COUNT0 keeps an exact scalar cache without any LIST or GROUP reads',async()=>{
 const fixture=await catalogPowerFixture(()=>{throw Error('unexpected public LIST');});
 const observedAt=new Date().toISOString();
 fixture.state.rawRead=async query=>{
  assert.equal(query.aggregate,'count');assert.equal(query.countIdentity,true);
  return {items:[],total:0,distinctTotal:0,observedAt,stale:false};
 };
 try{
  const first=await fixture.count({market:'japan'}),second=await fixture.count({market:'japan',sort:'totalRubDesc'});
  assert.equal(first.total,0);assert.equal(first.countProof.sourceTotal,0);assert.equal(first.observedAt,observedAt);
  assert.deepEqual(second,first);assert.equal(fixture.state.counts,1);assert.equal(fixture.state.countWrites.length,1);
  assert.equal(fixture.state.queries.length,0);
 }finally{fixture.close();}
});

test('a positive controlled count boundary cannot seed the runtime memory or persisted scalar cache',async()=>{
 const fixture=await catalogPowerFixture(()=>{throw Error('unexpected public LIST');});
 installControlledCountFixture(fixture,[{...row,ID:'memory-positive'}]);
 const controlled=fixture.state.controlledCount!;
 fixture.state.controlledCount=async options=>{
  const summary=await controlled(options);summary.countProof.predicateVersion=census.AJES_CENSUS_PREDICATE_VERSION;return summary;
 };
 try{
  assert.equal((await fixture.count({market:'japan',powerTo:'160'})).total,1);
  assert.equal(fixture.state.countWrites.length,0,'positive weight is never persisted');
  fixture.state.controlledCount=undefined;
  await assert.rejects(fixture.count({market:'japan',powerTo:'160'}),/census_source_snapshot_unavailable/);
  assert.equal(fixture.state.counts,2,'the positive controlled result was not retained in memory');
 }finally{fixture.close();}
});

test('one fresh exhausted source LIST proves its complete admitted count even when COUNT is unavailable',async()=>{
 const fixture=await catalogPowerFixture(query=>sourcePage(query,[offer(150,'single-one'),offer(150,'single-two')],3,{observedAt:new Date().toISOString()}));
 fixture.state.rawRead=async()=>{throw new AjesUnavailable('visitor_restricted');};
 try{
  const result=await fixture.read({market:'japan'},undefined,{includeCount:true});
  assert.equal(result.total,2);assert.equal(result.countSummary.upperBound,false);assert.equal(result.reads,1);
  assert.equal(result.hasMore,false);assert.equal(result.received,3);assert.equal(result.items.length,2);
  assert.ok(fixture.state.snapshots[0],'admission and public projection use one captured local snapshot');
 }finally{fixture.close();}
});

test('exhausted multiple LIST responses, duplicate IDs and invalid observation dates cannot manufacture exact totals',async()=>{
 for(const mode of ['two-responses','duplicate','stale','partial','missing-date','future-date'] as const){
  const fixture=await catalogPowerFixture(query=>{
   const observedAt=mode==='missing-date'?'invalid':new Date(Date.now()+(mode==='future-date'?60_000:0)).toISOString();
   const ids=query.page===2?['two-end']:mode==='duplicate'?['duplicate','duplicate']:['one','two'];
   return sourcePage(query,ids.map(id=>offer(150,id)),mode==='two-responses'&&query.page===1?24:ids.length,
    {observedAt,...(mode==='stale'?{stale:true}:{}),...(mode==='partial'?{partial:true}:{})});
  });
  try{
   const result=await fixture.read({market:'japan'});
   assert.equal(result.total,null,mode);assert.equal(result.countSummary,null,mode);
   assert.equal(result.items.length,mode==='two-responses'?3:2);
   assert.equal(result.reads,mode==='two-responses'?2:1);
  }finally{fixture.close();}
 }
});

/** Real editorial reader and DetailReadCache; only private storage and the
 * immutable calculation-index bytes are replaced by in-memory fixtures. */
async function cachedPowerEvidenceFixture(){
 const state={stored:{revision:'editorial-a',entries:{}} as any,reads:0,index:{digest:'a'.repeat(64)}};
 (globalThis as any).__japanPowerEvidenceFixture=state;
 const stubs:Record<string,string>={
  'server-only':'','next/headers':'export const headers=async()=>new Map();',
  './ajes-runtime':'export const ajesClient={read:async()=>{throw Error("unexpected source read");}};',
  '../data':'export const getJsonStorage=()=>{throw Error("unexpected storage read");};export const readDataJson=async path=>{if(path!=="catalog-editorial/current.json")throw Error("unexpected private path");const s=globalThis.__japanPowerEvidenceFixture;s.reads++;return structuredClone(s.stored);};export const mutateDataJson=()=>{throw Error("unexpected private write");};',
  '../encyclopedia/calculation-index':'export const readCalculationIndex=()=>globalThis.__japanPowerEvidenceFixture.index;export const applyEncyclopediaCalculation=x=>x;',
 };
 const bundle=await build({stdin:{contents:`
  export {readAjesPublicEvidenceSnapshot as snapshot} from './apps/web/lib/catalog/ajes-public';
  export {readCatalogEditorial as cached,readCatalogEditorialFresh as fresh,applyCatalogEditorial as apply} from './apps/web/lib/catalog/editorial';
 `,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'power-evidence-fixture',setup(builder){
  builder.onResolve({filter:/.*/},args=>args.path in stubs?{path:args.path,namespace:'power-evidence-fixture'}:undefined);
  builder.onLoad({filter:/.*/,namespace:'power-evidence-fixture'},args=>({contents:stubs[args.path]}));
 }}]});
 const module={exports:{} as any};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
 return {...module.exports,state,close:()=>{delete (globalThis as any).__japanPowerEvidenceFixture;}};
}
function editorialPower(input:any,hp:number){
 return {id:input.id,market:input.market,sourceId:input.sourceId,sourceOfferId:input.sourceOfferId,status:'visible',specifications:{powerHp:hp,powerDataSource:'manual',powerDataConfidence:'verified'}};
}

test('power snapshots share the actual five-second editorial cache with pricing, while a fresh-only read cannot replace it',async()=>{
 let now=Date.now();const clock=mock.method(Date,'now',()=>now);
 const evidence=await cachedPowerEvidenceFixture();
 const input={...offer(200,'cache-authority'),catalogPricingMode:undefined,totalRub:500000};
 evidence.state.stored.entries[input.id]=editorialPower(input,150);
 const fixture=await catalogPowerFixture((query,options)=>sourcePage(query,[evidence.apply(input,options.evidenceSnapshot.editorial)],1));
 try{
  const original=await evidence.cached();
  evidence.state.stored={revision:'editorial-b',entries:{[input.id]:editorialPower(input,190)}};
  assert.equal((await evidence.fresh()).revision,'editorial-b','fresh-only storage sees the new revision');
  const snapshot=await evidence.snapshot();
  assert.equal(snapshot.editorial,original,'the source snapshot uses the exact existing pricing cache');
  assert.equal(snapshot.editorial.revision,'editorial-a');assert.equal(Object.isFrozen(snapshot),true);
  fixture.state.evidenceReader=evidence.snapshot;
  fixture.state.price=async rows=>{const actualPricingIndex=await evidence.cached();return rows.map(row=>evidence.apply(row,actualPricingIndex));};
  const result=await fixture.read({market:'japan',powerTo:'160',budgetTo:'900000'});
  assert.deepEqual(result.items.map((item:any)=>item.id),[input.id]);assert.equal(result.items[0].powerHp,150);
  assert.deepEqual(result.powerFilterSummary,{shown:1,localPower:1,supplierPower:0,unknownPower:0});
  assert.equal(result.hasMore,false);assert.equal(evidence.state.reads,2,'all guards reuse the real five-second cache');
  assert.ok(fixture.state.snapshots.every(value=>value===fixture.state.snapshots[0]&&value.editorial===original));
  const before=ajesPowerEvidenceEpoch({runtimeSha:fixture.state.runtimeSha,editorialRevision:snapshot.editorial.revision,calculationDigest:snapshot.calculationIndex.digest});
  now+=5_001;
  const refreshed=await evidence.snapshot();
  assert.equal(refreshed.editorial.revision,'editorial-b');assert.equal(evidence.state.reads,3);
  const after=ajesPowerEvidenceEpoch({runtimeSha:fixture.state.runtimeSha,editorialRevision:refreshed.editorial.revision,calculationDigest:refreshed.calculationIndex.digest});
  assert.notEqual(after,before);
 }finally{fixture.close();evidence.close();clock.mock.restore();}
});

test('an actual editorial cache expiry during pricing resets before publishing changed power or starting unknown',async()=>{
 for(const initialPower of [150,undefined]){
  let now=Date.now();const clock=mock.method(Date,'now',()=>now);
  const evidence=await cachedPowerEvidenceFixture();
  const input={...offer('','cache-mid-price'),catalogPricingMode:undefined,totalRub:500000};
  if(initialPower)evidence.state.stored.entries[input.id]=editorialPower(input,initialPower);
  const fixture=await catalogPowerFixture((query,options)=>sourcePage(query,[evidence.apply(input,options.evidenceSnapshot.editorial)],1));
  try{
   fixture.state.evidenceReader=evidence.snapshot;
   fixture.state.price=async rows=>{
    if(!rows.length)return rows;
    evidence.state.stored={revision:'editorial-b',entries:{[input.id]:editorialPower(input,190)}};
    now+=5_001;
    const actualPricingIndex=await evidence.cached();
    return rows.map(row=>evidence.apply(row,actualPricingIndex));
   };
   await assert.rejects(fixture.read({market:'japan',powerTo:'160',budgetTo:'900000'}),AjesCursorRefreshRequired);
   assert.deepEqual(fixture.state.queries.map(query=>query.page),initialPower?[1]:[1,1]);
   assert.equal(evidence.state.reads,2);
   assert.ok(fixture.state.snapshots.every(value=>value.editorial.revision==='editorial-a'),'no row is silently reclassified under a different epoch');
  }finally{fixture.close();evidence.close();clock.mock.restore();}
 }
});

test('power continuation rejects changed editorial, calculation or runtime evidence before any new source read',async()=>{
 for(const change of [
  (state:any)=>{state.editorialRevision='fixture-2';},
  (state:any)=>{state.calculationDigest='b'.repeat(64);},
  (state:any)=>{state.runtimeSha='2'.repeat(40);},
 ]){
  const fixture=await catalogPowerFixture(query=>sourcePage(query,Array.from({length:24},(_,i)=>offer(150,`epoch-${query.page}-${i}`)),24));
  try{
   const first=await fixture.read({market:'japan',powerTo:'160'}),before=fixture.state.queries.length;
   change(fixture.state);
   await assert.rejects(fixture.read({market:'japan',powerTo:'160',page:'2',after:first.nextCursor}),AjesCursorRefreshRequired);
   assert.equal(fixture.state.queries.length,before);
   assert.deepEqual(ajesErrorResponse(new AjesCursorRefreshRequired()),{status:409,body:{ok:false,error:'japan_cursor_refresh_required'}});
  }finally{fixture.close();}
 }
});

test('unexpected effective power changes from pricing require refresh even when the revision is unchanged',async()=>{
 for(const power of [150,'']){
  const fixture=await catalogPowerFixture(query=>sourcePage(query,[{...offer(power,'price-power-change'),catalogPricingMode:undefined,totalRub:500000}],1));
  try{
   fixture.state.price=async rows=>rows.map(row=>({...row,powerHp:190,powerDataSource:'manual',powerDataConfidence:'verified'}));
   await assert.rejects(fixture.read({market:'japan',powerTo:'160',budgetTo:'900000'}),AjesCursorRefreshRequired);
   assert.equal(fixture.state.editorialRevision,'fixture-1');
  }finally{fixture.close();}
 }
});

test('K classification gives authoritative manual and owner power priority over contrary supplier PW',async()=>{
 const known={...offer(220,'manual-known'),powerHp:150,powerDataSource:'manual',powerDataConfidence:'verified'};
 const excluded={...offer(120,'manual-high'),powerHp:190,powerDataSource:'manual',powerDataConfidence:'verified'};
 const owner=applyJapanOwnerSpecifications({...offer('','owner-known'),make:'HONDA',model:'STEPWGN',fuel:'petrol',powertrainKind:'combustion'});
 const unknown=offer('','unknown-after');
 const fixture=await catalogPowerFixture(query=>sourcePage(query,[unknown,excluded,known,owner],4));
 try{
  const result=await fixture.read({market:'japan',powerTo:'160'});
  assert.deepEqual(result.items.map((item:any)=>item.id),[known.id,owner.id,unknown.id]);
  assert.deepEqual(result.powerFilterSummary,{shown:3,localPower:2,supplierPower:0,unknownPower:1});
  assert.deepEqual(fixture.state.queries.map(query=>query.page),[1,1]);assert.equal(result.hasMore,false);
 }finally{fixture.close();}
});

test('a local value rejected by the actual public projection stays unknown after every known source page',async()=>{
 const rejected={...offer('','unproven-100'),powerHp:100,editorialSpecifications:{powerHp:100}};
 assert.equal(publicOffer(rejected).japanPowerUnknown,true);
 const known=offer(150,'later-known');
 const fixture=await catalogPowerFixture(query=>sourcePage(query,query.page===1?
  [rejected,...Array.from({length:23},(_,i)=>offer(200,`excluded-${i}`))]:[known],query.page===1?24:1));
 try{
  const result=await fixture.read({market:'japan',powerFrom:'110',powerTo:'160'});
  assert.deepEqual(result.items.map((item:any)=>item.id),[known.id,rejected.id]);
  assert.equal(result.items[0].japanSupplierPower.hp,150);assert.equal(result.items[1].japanPowerUnknown,true);
  assert.equal(result.items[1].powerHp,undefined);
  assert.deepEqual(result.powerFilterSummary,{shown:2,localPower:0,supplierPower:1,unknownPower:1});
  assert.deepEqual(fixture.state.queries.map(query=>query.page),[1,2,1,2]);assert.equal(result.hasMore,false);
 }finally{fixture.close();}
});

test('the existing delivered-price sort orders each loaded power partition without moving cheap unknowns ahead of known',async()=>{
 const priced=(hp:unknown,id:string,totalRub:number)=>({...offer(hp,id),catalogPricingMode:undefined,totalRub});
 const rows=[priced('','unknown-cheap',100000),priced(150,'known-expensive',900000),priced('','unknown-less-cheap',200000),priced(120,'known-cheaper',500000)];
 for(const sort of ['totalRub','totalRubDesc']){
  const fixture=await catalogPowerFixture(query=>sourcePage(query,rows,rows.length));
  try{
   const result=await fixture.read({market:'japan',powerTo:'160',sort});
   const expected=sort==='totalRub'?['known-cheaper','known-expensive','unknown-cheap','unknown-less-cheap']:['known-expensive','known-cheaper','unknown-less-cheap','unknown-cheap'];
   assert.deepEqual(result.items.map((item:any)=>item.id),expected.map(id=>'ajes-stats-'+id));
   assert.deepEqual(result.items.map(japanUnknownPower),[false,false,true,true]);
   assert.deepEqual(fixture.state.queries.map(query=>query.page),[1,1]);assert.equal(result.hasMore,false);
   assert.ok(fixture.state.queries.every(query=>query.sort===undefined),'delivered-price sorting must not reorder the raw auction-price candidates');
  }finally{fixture.close();}
 }
});

test('power price sorting uses the selected city inside each known/unknown partition',async()=>{
 const priced=(hp:unknown,id:string,totalRub:number,deliveryRub:number)=>({...offer(hp,id),catalogPricingMode:undefined,totalRub,
  calculationSnapshot:{deliveryPricingBasis:{subtotalRub:totalRub,deliveryRub,percents:[]}}});
 const rows=[priced('','unknown-base-cheaper',500000,0),priced(150,'known-base-cheaper',900000,0),
  priced('','unknown-city-cheaper',550000,100000),priced(120,'known-city-cheaper',950000,100000)];
 assert.deepEqual(rows.map(row=>priceCardForCity(row,'Новокузнецк').offer.totalRub),[620000,1020000,570000,970000]);
 for(const sort of ['totalRub','totalRubDesc']){
  const fixture=await catalogPowerFixture(query=>sourcePage(query,rows,rows.length));
  try{
   const result=await fixture.read({market:'japan',powerTo:'160',sort,city:'Новокузнецк'});
   const expected=sort==='totalRub'?['known-city-cheaper','known-base-cheaper','unknown-city-cheaper','unknown-base-cheaper']:
    ['known-base-cheaper','known-city-cheaper','unknown-base-cheaper','unknown-city-cheaper'];
   assert.deepEqual(result.items.map((item:any)=>item.id),expected.map(id=>'ajes-stats-'+id));
   assert.deepEqual(result.items.map(japanUnknownPower),[false,false,true,true]);
   assert.equal(result.hasMore,false);assert.equal(result.total,null,'two K/U observations are not one exact source snapshot');
  }finally{fixture.close();}
 }
});

test('power price separation preserves other source sort priorities and does not broaden ordinary or invalid queries',async()=>{
 for(const [sort,sourceSort] of [['mileage','mileage'],['year','year'],['totalRubDesc,mileage','mileage'],['year,totalRub','year']]){
  const fixture=await catalogPowerFixture(query=>{ajesQuery(query);return sourcePage(query,[offer(150,'sort-retained')],1);});
  try{
   const result=await fixture.read({market:'japan',powerTo:'160',sort});
   assert.equal(result.items.length,1);
   assert.ok(fixture.state.queries.every(query=>query.sort===sourceSort));
  }finally{fixture.close();}
 }
 const fixture=await catalogPowerFixture(query=>{ajesQuery(query);return sourcePage(query,[offer(150,'ordinary-sort')],1);});
 try{
  await fixture.read({market:'japan',sort:'totalRubDesc'},undefined,{includeCount:false});
  assert.equal(fixture.state.queries[0].sort,'totalRubDesc','unfiltered source order is unchanged');
  await assert.rejects(fixture.read({market:'japan',powerTo:'160',sort:'totalRubDesc,totalRub'}),AjesInputError);
 }finally{fixture.close();}
});

for(const sort of ['totalRub','totalRubDesc'])test(`power then ${sort} keeps the usable selection instead of scanning an unrelated auction-price prefix`,async()=>{
 // The most/least expensive auction rows do not pass the power filter. A
 // delivered-price button must order the same loaded candidates; it cannot
 // replace them with eight rejected raw FINISH pages and an empty catalogue.
 const known=Array.from({length:48},(_,i)=>({...offer(150,`price-eligible-${i}`),catalogPricingMode:undefined,
  sourcePrice:1000000+i,totalRub:900000+(47-i)*1000,auctionDate:`2026-11-${String(28-Math.floor(i/24)).padStart(2,'0')}T12:00:00Z`,
  calculationSnapshot:{deliveryPricingBasis:{subtotalRub:900000+(47-i)*1000,deliveryRub:10000,percents:[]}}}));
 const excluded=[100000,4000000].flatMap(base=>Array.from({length:192},(_,i)=>({...offer(300,`price-excluded-${base}-${i}`),
  catalogPricingMode:undefined,sourcePrice:base+i,totalRub:3000000+i*1000})));
 const fixture=await catalogPowerFixture(query=>{
  const sql=ajesQuery(query).sql;
  const rows=[...known,...excluded];
  if(/order by finish asc/.test(sql))rows.sort((a,b)=>a.sourcePrice-b.sourcePrice);
  if(/order by finish desc/.test(sql))rows.sort((a,b)=>b.sourcePrice-a.sourcePrice);
  const offset=(query.page-1)*query.pageSize;
  return sourcePage(query,rows.slice(offset,offset+query.pageSize));
 });
 try{
  const params={market:'japan',powerTo:'160',city:'Новокузнецк'};
  const original=await fixture.read(params);
  assert.equal(original.items.length,24);
  const first=await fixture.read({...params,sort});
  assert.equal(first.items.length,24,'a price-only sort preserves a populated power selection');
  assert.deepEqual(new Set(first.items.map((item:any)=>item.id)),new Set(original.items.map((item:any)=>item.id)));
  assert.deepEqual(first.items.map((item:any)=>item.id),(sort==='totalRub'?known.slice(0,24).reverse():known.slice(0,24)).map(item=>item.id));
  assert.equal(first.hasMore,true);assert.equal(first.scanLimited,false);assert.equal(first.total,null);
  assert.equal(first.powerFilterSummary.supplierPower,24);assert.equal(first.powerFilterSummary.unknownPower,0);
  const second=await fixture.read({...params,sort,page:'2',after:first.nextCursor});
  assert.equal(second.items.length,24);
  assert.deepEqual(second.items.map((item:any)=>item.id),(sort==='totalRub'?known.slice(24,48).reverse():known.slice(24,48)).map(item=>item.id));
  assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,48,'continuation neither loses nor repeats eligible rows');
  assert.deepEqual(fixture.state.queries.map(query=>query.page),[1,1,2],'price sorting adds no rejected-prefix crawl');
  const reads=fixture.state.queries.length;
  await assert.rejects(fixture.read({...params,sort:sort==='totalRub'?'totalRubDesc':'totalRub',page:'2',after:first.nextCursor}),AjesCursorRefreshRequired);
  await assert.rejects(fixture.read({...params,sort,city:'Москва',page:'2',after:first.nextCursor}),AjesCursorRefreshRequired);
  assert.equal(fixture.state.queries.length,reads,'sort and city remain part of the continuation identity');
 }finally{fixture.close();}
});

test('a later source refusal preserves 23 available rows as incomplete and retries the exact next source page',async()=>{
 let failing=true;
 const fixture=await catalogPowerFixture(query=>{
  if(query.page===2&&failing)throw new AjesUnavailable('request_timeout');
  const count=query.page===1?23:query.page===2?24:2;
  return sourcePage(query,Array.from({length:count},(_,i)=>offer(150,`fresh-${query.page}-${i}`)),query.page<3?24:2);
 });
 try{
  const result=await fixture.read({market:'japan',powerTo:'160',city:'Новокузнецк'});
  assert.deepEqual(fixture.state.queries.map(query=>query.page),[1,2]);assert.equal(fixture.state.counts,0);
  assert.equal(result.items.length,23);assert.equal(result.received,24);assert.equal(result.hasMore,true);
  assert.equal(result.total,null);assert.equal(result.countSummary,null);assert.match(result.nextCursor,/^j2\.k\.2\.0\.2\.[a-f0-9]{64}\.[a-f0-9]{64}\.-$/);
  assert.equal(result.observedAt,'2026-11-26T06:02:33.366Z');assert.equal(result.generationId,result.observedAt);
  assert.equal(result.partial,true);assert.equal(result.stale,false);assert.equal(result.scanLimited,true);assert.equal(result.interrupted,true);
  assert.deepEqual(result.powerFilterSummary,{shown:23,localPower:0,supplierPower:23,unknownPower:0});
  assert.ok(result.items.every((item:any)=>item.japanSupplierPower.hp===150));
  failing=false;
  const next=await fixture.read({market:'japan',powerTo:'160',city:'Новокузнецк',page:'2',after:result.nextCursor});
  const last=await fixture.read({market:'japan',powerTo:'160',city:'Новокузнецк',page:'3',after:next.nextCursor});
  assert.equal(next.items.length,24);assert.equal(next.items[0].id,'ajes-stats-fresh-2-0');
  assert.equal(next.partial,false);assert.equal(last.hasMore,false);assert.equal(last.items.length,2);
  const ids=[...result.items,...next.items,...last.items].map(item=>item.id);
  assert.equal(ids.length,49);assert.equal(new Set(ids).size,49);
  assert.deepEqual(fixture.state.queries.map(query=>query.page),[1,2,2,3,1,2,3]);
 }finally{fixture.close();}
});

test('power refill keeps the 24-row query and orders all matching known cars before unknown through numbered cursors',async()=>{
 const source=(page:number)=>page===1?Array.from({length:24},(_,i)=>offer(i===23?200:'',`page-1-${i}`)):
  page===2?Array.from({length:24},(_,i)=>offer(i===23?200:i%2?'':150,`page-2-${i}`)):
  [120,'',155,180].map((pw,i)=>offer(pw,`page-3-${i}`));
 const fixture=await catalogPowerFixture(query=>sourcePage(query,source(query.page),query.page===3?4:24));
 try{
  const params={market:'japan',powerTo:'160',city:'Новокузнецк'};
  const first=await fixture.read(params);
  const second=await fixture.read({...params,page:'2',after:first.nextCursor});
  const third=await fixture.read({...params,page:'3',after:second.nextCursor});
  const results=[first,second,third];
  assert.deepEqual(results.map(result=>result.items.length),[24,24,1]);
  assert.deepEqual(results.map(result=>result.hasMore),[true,true,false]);
  assert.match(first.nextCursor,/^j2\.u\.1\.10\.2\./);assert.match(second.nextCursor,/^j2\.u\.3\.0\.3\./);assert.equal(third.nextCursor,null);
  assert.ok(results.every(result=>result.total===null&&result.countSummary===null));
  const ids=results.flatMap(result=>result.items.map((item:any)=>item.id));
  const matched=[1,2,3].flatMap(source).filter(ajesResultFilter(params).matches);
  const expected=[...matched.filter(item=>!japanUnknownPower(item)),...matched.filter(japanUnknownPower)].map(item=>item.id);
  assert.deepEqual(ids,expected);assert.equal(new Set(ids).size,49);
  assert.ok(results.flatMap(result=>result.items).some(item=>item.japanPowerUnknown===true));
  assert.deepEqual(fixture.state.queries.map(query=>query.page),[1,2,3,1,1,2,3]);
  assert.ok(fixture.state.queries.every(query=>query.pageSize===24));
  const normalized=fixture.state.queries.map(({page,...query})=>JSON.stringify(query));
  assert.ok(normalized.every(query=>query===normalized[0]),'only page changes; SQL selection and page size stay unchanged');
  assert.equal(fixture.state.counts,0);
 }finally{fixture.close();}
});

test('an all-over-limit search stops at eight requested source pages and never claims an empty global catalogue',async()=>{
 const fixture=await catalogPowerFixture(query=>sourcePage(query,Array.from({length:24},(_,i)=>offer(180,`over-${query.page}-${i}`)),24));
 try{
  const result=await fixture.read({market:'japan',powerTo:'160'});
  assert.deepEqual(fixture.state.queries.map(query=>query.page),[1,2,3,4,5,6,7,8]);assert.deepEqual(result.items,[]);
  assert.equal(result.hasMore,true);assert.match(result.nextCursor,/^j2\.k\.9\.0\.2\./);assert.equal(result.total,null);assert.equal(result.countSummary,null);
  assert.equal(result.scanLimited,true);assert.equal(result.stale,false);
  assert.deepEqual(result.powerFilterSummary,{shown:0,localPower:0,supplierPower:0,unknownPower:0});
 }finally{fixture.close();}
});

test('exhausting both power passes does not establish one exact source count across two observations',async()=>{
 const fixture=await catalogPowerFixture(query=>sourcePage(query,[150,200,''].map((pw,i)=>offer(pw,`last-${i}`)),3));
 try{
  const result=await fixture.read({market:'japan',powerTo:'160'});
  assert.equal(result.hasMore,false);assert.equal(result.items.length,2);assert.equal(result.total,null);
  assert.equal(result.countSummary,null);
  assert.deepEqual(result.powerFilterSummary,{shown:2,localPower:0,supplierPower:1,unknownPower:1});
  assert.equal(result.nextCursor,null);assert.equal(fixture.state.queries.length,2);
 }finally{fixture.close();}
});

test('source-page power selection preserves stale and partial evidence instead of promoting it to fresh or exact',async()=>{
 for(const flags of [{stale:true},{partial:true},{partial:true,stale:true}]){
  const fixture=await catalogPowerFixture(query=>sourcePage(query,[offer('', 'saved')],1,flags));
  try{
   const result=await fixture.read({market:'japan',powerTo:'160'});
   assert.equal(result.stale,Boolean(flags.stale));assert.equal(result.partial,Boolean(flags.partial));
   assert.equal(result.observedAt,'2026-11-26T06:02:33.366Z');assert.equal(result.total,null);assert.equal(result.countSummary,null);
   assert.equal(result.hasMore,true);assert.equal(result.items.length,0);assert.equal(fixture.state.queries.length,1);
   assert.match(result.nextCursor,/^j2\.k\.1\.0\.2\./);
  }finally{fixture.close();}
 }
});
test('refill keeps the oldest contributing observation and does not hide stale continuation rows',async()=>{
 const fixture=await catalogPowerFixture(query=>sourcePage(query,Array.from({length:query.page===1?23:24},(_,i)=>offer(150,`dated-${query.page}-${i}`)),24,
  query.page===2?{stale:true,observedAt:'2026-11-25T01:02:03.000Z'}:{}));
 try{
  const result=await fixture.read({market:'japan',powerTo:'160'});
  assert.equal(result.items.length,24);assert.equal(result.stale,true);
  assert.equal(result.observedAt,'2026-11-25T01:02:03.000Z');assert.equal(result.generationId,result.observedAt);
  assert.equal(result.total,null);assert.equal(result.countSummary,null);
 }finally{fixture.close();}
});

test('power combined with body, fuel, drive and color applies every local condition while filling',async()=>{
 const matching={bodyType:'sedan',fuel:'petrol',drive:'awd',color:'белый'};
 const rows=[
  {...offer(150,'combined-known'),...matching},{...offer('','combined-unknown'),...matching},
  {...offer(200,'combined-high'),...matching},{...offer('','combined-body'),...matching,bodyType:'suv'},
  {...offer('','combined-fuel'),...matching,fuel:'diesel'},{...offer('','combined-drive'),...matching,drive:'fwd'},
  {...offer('','combined-color'),...matching,color:'красный'},
 ];
 const fixture=await catalogPowerFixture(query=>sourcePage(query,query.page===1?rows:Array.from({length:24},(_,i)=>({...offer(150,`combined-next-${i}`),...matching})),24));
 try{
  const result=await fixture.read({market:'japan',powerTo:'160',...matching,city:'Новокузнецк'});
  assert.equal(result.items.length,24);
  assert.equal(result.items[0].id,'ajes-stats-combined-known');
  assert.ok(result.items.slice(1).every((item:any)=>item.id.startsWith('ajes-stats-combined-next-')));
  assert.equal(fixture.state.queries.length,2);assert.equal(result.hasMore,true);assert.equal(result.total,null);
  for(const key of ['fuel','drive','color'] as const)assert.ok(fixture.state.queries.every(query=>query[key]===matching[key]));
  assert.deepEqual(result.powerFilterSummary,{shown:24,localPower:0,supplierPower:24,unknownPower:0});
 }finally{fixture.close();}
});

test('already issued mixed-power cursors explicitly reset instead of reinterpreting their offset',async()=>{
 const fixture=await catalogPowerFixture(query=>sourcePage(query,Array.from({length:24},(_,i)=>offer('',`cursor-${query.page}-${i}`)),24));
 try{
  await assert.rejects(fixture.read({market:'japan',powerTo:'160',page:'2',after:'2.3'}),AjesCursorRefreshRequired);
  assert.deepEqual(fixture.state.queries,[]);
 }finally{fixture.close();}
});

test('power plus delivered-price filtering retains the existing priced continuation path',async()=>{
 const pricedOffer=(power:unknown,id:string)=>({...offer(power,id),catalogPricingMode:undefined,totalRub:500000});
 const fixture=await catalogPowerFixture(query=>sourcePage(query,query.page===1?
  [pricedOffer(150,'price-first'),pricedOffer(200,'price-excluded')]:Array.from({length:24},(_,i)=>pricedOffer(150,`price-next-${i}`)),24));
 try{
  const result=await fixture.read({market:'japan',powerTo:'160',budgetTo:'900000'});
  assert.deepEqual(fixture.state.queries.map(query=>query.page),[1,2]);assert.equal(result.items.length,24);
  assert.match(result.nextCursor,/^j2\.k\.2\.23\.2\./);assert.equal(result.hasMore,true);assert.equal(result.total,null);
  assert.deepEqual(fixture.state.priced.map(ids=>ids.length),[1,24]);
  assert.ok(!fixture.state.priced.flat().includes('ajes-stats-price-excluded'),'known excessive power is removed before price work');
 }finally{fixture.close();}
});

test('supplier integer horsepower accepts number or varchar digits, never selects a comma alternative',()=>{
 for(const value of [160,'160',' 160 ','00160'])assert.equal(parseJapanSourcePower(value),160);
 assert.equal(parseJapanSourcePower(2501),2501);
 for(const value of ['',0,-1,'0','150,180','180,150','160.5','160.0',1.5,'160 hp','1e2','160;drop',null,{},[],'9'.repeat(31),Number.MAX_SAFE_INTEGER+1])assert.equal(parseJapanSourcePower(value),undefined,String(value));
});

test('Japan power selection uses local facts first, scalar supplier hp second and retains labelled unknown rows',()=>{
 const filter=ajesResultFilter({market:'japan',powerFrom:80,powerTo:160});
 for(const [pw,expected] of [[80,true],[160,true],[79,false],[161,false],[2501,false],['',true],['170,52',true],['bad',true]] as const)assert.equal(filter.matches(offer(pw)),expected,String(pw));
 assert.equal(filter.matches({...offer(200),powerHp:150}),true);
 assert.equal(filter.matches({...offer(150),powerHp:180}),false);
 assert.equal(filter.matches({...offer(''),savedCalculationPreview:{parameters:{powerHp:180},totalRub:1000000}}),true);
 assert.equal(japanUnknownPower({...offer(''),savedCalculationPreview:{parameters:{powerHp:150}}}),true);
 for(const market of ['china','korea','uae'])assert.equal(ajesResultFilter({market,powerTo:160}).matches({...offer(150),market}),false);
 assert.equal(filter.matches({...offer(150),id:'another-provider'}),false);
 assert.equal(filter.matches({...offer(150),sourceId:'another-provider'}),false);
 const owner={...offer(200),make:'HONDA',model:'STEPWGN',fuel:'petrol',powertrainKind:'combustion',operational:{chassisCode:'RP3',raw:{sourceFuel:'P',sourcePower:'200'}}};
 assert.equal(filter.matches(owner),true);
 assert.equal(japanSupplierPower(owner),undefined);
 const ownerDto=publicOffer(applyJapanOwnerSpecifications(owner as any));
 assert.equal(ownerDto.powerHp,150,'the existing reader owner override is an explicit public local value');
 assert.equal(ownerDto.japanSupplierPower,undefined);
 assert.equal(ownerDto.japanPowerUnknown,undefined);
 assert.deepEqual(japanPowerFilterSummary([ownerDto]),{shown:1,localPower:1,supplierPower:0,unknownPower:0});
});

test('public supplier hp survives projection without changing prices or verified specifications',()=>{
 for(const fuel of ['P','H','E']){
  const input=offer('150','public-'+fuel,fuel),before=JSON.stringify(input);
  const output=publicOffer(input) as any;
  assert.deepEqual(output.japanSupplierPower,{offerId:input.id,hp:150,unit:'hp',source:'ajes_pw',...(fuel==='P'?{combustionPreviewEligible:true}:{})});
  assert.equal(japanSupplierPowerLabel(output),'150 л.с. · поставщик');
  for(const key of ['powerHp','powerKw','power30MinKw','utilizationPowerKw','operational','sourceId'])assert.equal(output[key],undefined,key);
  assert.equal(output.totalRub,null);assert.equal(output.catalogPricingMode,'seller');
  const expected=fuel==='P'?150:undefined;
  assert.equal(ajesPowerEstimateHp(input),expected);assert.equal(ajesPowerEstimateHp(output),expected);
  assert.equal(offerParameterDraft(input).powerHp,expected?'150':'');assert.equal(offerParameterDraft(input).power30MinKw,'');
  assert.equal(offerParameterDraft(output).powerHp,expected?'150':'');assert.equal(offerParameterDraft(output).icePowerKw,'');
  assert.equal(JSON.stringify(input),before);
  assert.equal(ajesResultFilter({market:'japan',powerTo:160}).matches(output),true);
  assert.equal(japanSupplierPower({...output,id:'ajes-stats-other'}),undefined);
  assert.equal(japanSupplierPower({...output,japanSupplierPower:{...output.japanSupplierPower,unit:'kw'}}),undefined);
  assert.equal(japanSupplierPower({...output,powerHp:180}),undefined);
  assert.deepEqual((publicOffer(output) as any).japanSupplierPower,output.japanSupplierPower);
 }
 const unknown=publicOffer(offer('150,180')) as any;
 assert.equal(unknown.japanPowerUnknown,true);assert.equal(unknown.japanSupplierPower,undefined);
 assert.equal(japanUnknownPower(unknown),true);
 const summary=japanPowerFilterSummary([publicOffer({...offer(200),make:'HONDA',model:'STEPWGN',fuel:'petrol',powertrainKind:'combustion'}),publicOffer(offer(120)),unknown]);
 assert.deepEqual(summary,{shown:3,localPower:1,supplierPower:1,unknownPower:1});
 assert.match(japanPowerFilterNotice(summary),/Мощность не указана: 1/);
 assert.match(japanPowerFilterNotice(summary),/не подтверждает право/);
});

test('the list preview and editable detail use the same scalar supplier hp with local and manual priority',()=>{
 for(const power of [49,52,97])for(const fuel of ['P','D','L','C']){
  const raw=offer(power,`preview-${power}-${fuel}`,fuel),before=JSON.stringify(raw),dto=publicOffer(raw) as any;
  for(const input of [raw,dto]){
   assert.deepEqual(japanSupplierPreviewPower(input),{offerId:raw.id,hp:power,unit:'hp',source:'ajes_pw',combustionPreviewEligible:true});
   const preview=japanPreviewParameters(input),draft=offerParameterDraft(input),detail=validateCustomerParameters(draft);
   assert.equal(preview.powerHp,power);assert.equal(detail.powerHp,power);
   assert.ok(Math.abs(Number(preview.powerKw)-Number(detail.powerKw))<1e-8);assert.equal(detail.power30MinKw,undefined);assert.equal(detail.icePowerKw,undefined);
   const manual=validateCustomerParameters({...draft,...powerUnitPatch('powerHp','130',draft)});
   assert.equal(manual.powerHp,130);assert.equal(manual.powerKw,130*0.73549875);
  }
  assert.equal(JSON.stringify(raw),before);
 }
 const base=offer(150),local={...base,powerHp:180,powerDataConfidence:'source_exact',operational:{...base.operational,semanticEvidence:{...base.operational?.semanticEvidence,powerHp:{status:'exact',value:180,source:'fixture:local_manual'}}},japanPowerEstimate:{offerId:base.id,values:[150],requiresConfirmation:true}};
 assert.equal(ajesPowerEstimateHp(local),180);
 assert.equal(japanPreviewParameters(local).powerHp,180);assert.equal(offerParameterDraft(local).powerHp,'180');
 const kwOnly={...base,powerKw:130,powerDataConfidence:'source_exact',operational:{...base.operational,semanticEvidence:{...base.operational?.semanticEvidence,powerKw:{status:'exact',value:130,source:'fixture:local_manual'}}}};
 for(const input of [kwOnly,publicOffer(kwOnly)]){
  assert.equal(japanSupplierPreviewPower(input),undefined);
  const draft=offerParameterDraft(input as any);
  assert.equal(draft.powerKw,'130');assert.equal(Number(draft.powerHp),Number((130/0.73549875).toFixed(8)));
 }
 const iceOnly={...base,icePowerKw:130};
 assert.equal(japanSupplierPreviewPower(iceOnly),undefined);
 assert.equal(Number(offerParameterDraft(iceOnly).powerHp),Number((130/0.73549875).toFixed(8)));
 const owner={...offer(200),make:'HONDA',model:'STEPWGN',fuel:'petrol',powertrainKind:'combustion'};
 assert.equal(japanPreviewParameters(owner).powerHp,150);assert.equal(offerParameterDraft(owner as any).powerHp,'150');
});

test('unknown, ambiguous, foreign and electrified supplier power cannot seed a combustion calculation',()=>{
 for(const value of ['',0,'150,180','160.5','160 hp',2501]){
  const input=offer(value);
  assert.equal(japanSupplierPreviewPower(input),undefined);assert.equal(offerParameterDraft(input).powerHp,'');
  assert.throws(()=>japanPreviewParameters(input));
 }
 assert.equal(japanSupplierPreviewPower({...offer(150),fuel:undefined}),undefined);
 for(const fuel of ['H','HE','E']){
  const input=offer(150,`electrified-${fuel}`,fuel);
  for(const projected of [input,publicOffer(input)]){
   assert.equal(japanSupplierPreviewPower(projected),undefined);
   assert.equal(offerParameterDraft(projected as any).powerHp,'');
   assert.equal(offerParameterDraft(projected as any).power30MinKw,'');
   assert.equal(offerParameterDraft(projected as any).icePowerKw,'');
   assert.throws(()=>japanPreviewParameters(projected as any));
  }
 }
 for(const patch of [{powertrainKind:'other_hybrid'},{powertrainKind:'series_hybrid'},{model:'NOTE e-POWER'},{trim:'HYBRID'},{market:'korea'},{sourceId:'other'},{id:'foreign-offer'}]){
  assert.equal(japanSupplierPreviewPower({...offer(150),...patch}),undefined);
 }
 const electric={...offer(150,'known-electric','E'),powerHp:150};
 assert.equal(offerParameterDraft(electric).power30MinKw,'');assert.throws(()=>japanPreviewParameters(electric));
});

test('projection retains full-record preview vetoes and old compact supplier facts cannot invent eligibility',()=>{
 const base=offer(150);
 const vetoes=[
  {sourceTitle:'TOYOTA TEST HYBRID'},
  {encyclopediaIdentity:{rawModel:'TEST HYBRID'}},
  {fuelDefaultBlocked:true},
  {semanticEvidence:{...base.operational?.semanticEvidence,fuel:{status:'conflict'}}},
  {semanticEvidence:{...base.operational?.semanticEvidence,powertrainKind:{status:'ambiguous'}}},
 ];
 for(const veto of vetoes){
  const input={...base,operational:{...base.operational,...veto}} as any,before=JSON.stringify(input);
  const dto=publicOffer(input) as any;
  assert.equal(dto.operational,undefined);assert.equal(dto.japanSupplierPower.hp,150);
  assert.equal(dto.japanSupplierPower.combustionPreviewEligible,undefined);
  for(const candidate of [input,dto,publicOffer(dto)]){
   assert.equal(japanSupplierPreviewPower(candidate),undefined);
   assert.throws(()=>japanPreviewParameters(candidate as any));
   const draft=offerParameterDraft(candidate as any);
   assert.equal(draft.powerHp,'');assert.equal(draft.power30MinKw,'');assert.equal(draft.icePowerKw,'');
  }
  assert.equal(offerParameterDraft(input,dto).powerHp,'','the detail full-record/DTO pair keeps the same veto');
  assert.equal(JSON.stringify(input),before);
 }
 const fresh=publicOffer(base) as any;
 const legacy={...fresh,japanSupplierPower:{offerId:base.id,hp:150,unit:'hp',source:'ajes_pw'}};
 for(const candidate of [legacy,publicOffer(legacy)]){
  assert.equal(japanSupplierPowerLabel(candidate),'150 л.с. · поставщик');
  assert.equal(japanSupplierPreviewPower(candidate),undefined);assert.equal(offerParameterDraft(candidate as any).powerHp,'');
 }
 assert.equal(offerParameterDraft(base,legacy).powerHp,'150','the actual full record may still supply its own eligible input');
 const defaultFuel=offer(150,'owner-default',''),defaultDto=publicOffer(defaultFuel) as any;
 assert.equal(defaultDto.fuel,'petrol');assert.equal(defaultDto.japanSupplierPower.combustionPreviewEligible,true);
 assert.equal(japanPreviewParameters(defaultFuel).powerHp,150);assert.equal(offerParameterDraft(defaultFuel,defaultDto).powerHp,'150');
});

test('power and ordinary queries share only the equivalent raw source selection',()=>{
 for(const table of ['stats','main'] as const)for(const query of [{},{make:'TOYOTA',page:2},{yearFrom:2020,yearTo:2023},{drive:'awd'}]){
  const ordinary=ajesQuery({table,...query}),power=ajesQuery({table,...query,powerTo:160});
  assert.equal(ajesSourceCacheSql(power.sql),ajesSourceCacheSql(ordinary.sql));
  assert.doesNotMatch(power.sql,/pw\s*(?:>=|<=|>|<)/i);
  assert.ok(new URLSearchParams({sql:power.sql}).toString().length<6000);
 }
 const original=ajesSourceCacheSql(ajesQuery({}).sql);
 for(const query of [{table:'main' as const},{page:2},{pageSize:12},{make:'HONDA'},{yearFrom:2020}])assert.notEqual(ajesSourceCacheSql(ajesQuery(query).sql),original);
});

test('power toggle reuses the same fresh raw page without another supplier request or losing source PW',async()=>{
 let reads=0;
 const client=createAjesClient({password:()=> 'fixture-secret',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>{reads++;return new Response(JSON.stringify([row,{...row,ID:'unknown',PW:''}]));}});
 const ordinary=await client.read({table:'stats'},'127.0.0.1');
 const filtered=await client.read({table:'stats',powerTo:160},'127.0.0.1');
 const otherPower=await client.read({table:'stats',powerTo:100},'127.0.0.1');
 const {sourceReceipt:ordinaryReceipt,...ordinaryPage}=ordinary;
 const {sourceReceipt:filteredReceipt,...filteredPage}=filtered;
 const {sourceReceipt:otherReceipt,...otherPage}=otherPower;
 assert.equal(reads,1);assert.deepEqual(filteredPage,ordinaryPage);assert.deepEqual(otherPage,ordinaryPage);
 assert.ok(ordinaryReceipt&&filteredReceipt&&otherReceipt);
 assert.equal(new Set([ordinaryReceipt.requestId,filteredReceipt.requestId,otherReceipt.requestId]).size,3);
 assert.equal(ordinaryReceipt.supplierAttempted,true);
 for(const receipt of [filteredReceipt,otherReceipt]){
  assert.equal(receipt.supplierAttempted,false);
  assert.equal(receipt.queryHash,ordinaryReceipt.queryHash);
  assert.equal(receipt.observedAt,ordinaryReceipt.observedAt);
 }
 assert.equal(filtered.items[0].sourcePower,'150');assert.equal(filtered.items[1].sourcePower,'');
});

test('power query reuses persisted ordinary page, without treating another page or stale result as fresh',async()=>{
 const ordinarySql=ajesQuery({}).sql;
 const saved={schemaVersion:2,stale:false,partial:false,items:[ajesLot(row,'stats',false)],page:1,pageSize:24,received:1,observedAt:new Date().toISOString()};
 for(const [patch,expected] of [[{},0],[{page:2},1],[{observedAt:new Date(Date.now()-31*60000).toISOString()},1]] as const){
  let reads=0;
  const client=createAjesClient({password:()=> 'fixture-secret',assertEnabled:async()=>{},reserve:async()=>{},readQuery:async sql=>sql===ordinarySql?{...saved,...patch}:null,fetcher:async()=>{reads++;return new Response(JSON.stringify([row]));}});
  const result=await client.read({powerTo:160},'127.0.0.1');
  assert.equal(reads,expected);assert.equal(result.stale,false);assert.equal(result.items[0].sourcePower,'150');
 }
});

test('fresh restored details expire at the original observation deadline, not 30 minutes after restart',async()=>{
 let now=Date.now(),reads=0;
 const clock=mock.method(Date,'now',()=>now);
 const saved={schemaVersion:2,items:[ajesLot(row,'stats',true)],page:1,pageSize:1,received:1,observedAt:new Date(now-29*60000).toISOString()};
 try{
  const client=createAjesClient({password:()=> 'fixture-secret',assertEnabled:async()=>{},reserve:async()=>{},readDetail:async()=>saved,fetcher:async()=>{reads++;return new Response(JSON.stringify([row]));}});
  const first=await client.read({id:row.ID},'127.0.0.1');assert.equal(reads,0);assert.equal(first.observedAt,saved.observedAt);
  now+=60_001;
  await client.read({id:row.ID},'127.0.0.1');assert.equal(reads,1);
 }finally{clock.mock.restore();}
});

test('power requests retain the ordinary source deadline and native failures cool down without renewing it',async()=>{
 let now=Date.now(),reads=0;
 const clock=mock.method(Date,'now',()=>now);
 const saved={schemaVersion:2,items:[ajesLot(row,'stats',false)],page:1,pageSize:24,received:1,observedAt:new Date(now-31*60000).toISOString()};
 const deadlines:number[]=[];
 const originalTimer=globalThis.setTimeout;
 const timer=mock.method(globalThis,'setTimeout',((callback:any,delay:any,...args:any[])=>{deadlines.push(Number(delay));return originalTimer(callback,delay,...args);}) as typeof setTimeout);
 try{
  const client=createAjesClient({password:()=> 'fixture-secret',assertEnabled:async()=>{},reserve:async()=>{},readQuery:async()=>saved,fetcher:async()=>{reads++;throw new TypeError('private connection failure');}});
  assert.equal((await client.read({powerTo:160},'127.0.0.1')).stale,true);
  assert.ok(deadlines.includes(20_000));assert.ok(!deadlines.includes(4500));
  now+=10_000;await client.read({powerTo:100},'127.0.0.1');assert.equal(reads,1);
  now+=19_000;await client.read({powerTo:160},'127.0.0.1');assert.equal(reads,1);
  now+=1_001;await client.read({powerTo:160},'127.0.0.1');assert.equal(reads,2);
  await client.read({powerTo:160},'127.0.0.2');assert.equal(reads,3);
 }finally{timer.mock.restore();clock.mock.restore();}
});

test('filtered continuation preserves matching and unknown cars without inventing a supplier total',async()=>{
 const all=[150,200,'',160,180,'bad'].map((pw,i)=>offer(pw,'row'+i));
 const filter=ajesResultFilter({market:'japan',powerTo:160});
 const read=async(page:number)=>{const rows=all.slice((page-1)*2,page*2);return {received:rows.length,items:rows.filter(filter.matches)};};
 const first=await readFilteredAjesPage({page:1,pageSize:2,read});
 const second=await readFilteredAjesPage({page:1,pageSize:2,after:first.nextCursor,read});
 assert.deepEqual([...first.items,...second.items].map(v=>v.id),['ajes-stats-row0','ajes-stats-row2','ajes-stats-row3','ajes-stats-row5']);
 const partial=await readFilteredAjesPage({page:1,pageSize:24,read:async()=>({received:3,items:[all[0],all[2]],partial:true,stale:true})});
 assert.equal(partial.partial,true);assert.equal(partial.stale,true);assert.equal('total' in partial,false);
 assert.deepEqual(japanPowerFilterSummary(partial.items),{shown:2,localPower:0,supplierPower:1,unknownPower:1});
});

async function japanPowerCardFixture(){
 const prices:any[]=[];
 (globalThis as any).__japanPowerCardPrices=prices;
 const mocks:Record<string,string>={
  CatalogSelectionContext:'export const useCatalogView=()=>globalThis.__japanPowerCardView;',
  DealerBrowsingContext:'export const useDealerBrowsing=()=>null;',
  useSavedCalculationPreview:'export const useSavedCalculationPreview=offer=>offer.savedCalculationPreview;',
  FavoriteToggle:'export const FavoriteToggle=()=>null;',
  CatalogCover:'export const CatalogCover=()=>null;',
  CatalogPrice:'export const CatalogPrice=({offer})=>{globalThis.__japanPowerCardPrices.push(offer);return null;};',
  IntentPrefetchLink:'export const IntentPrefetchLink=({children})=>children;',
  'RecyclingPower.module.css':'export default {};',
 };
 const bundle=await build({entryPoints:['apps/web/components/catalog/CatalogCard.tsx'],bundle:true,platform:'node',format:'cjs',write:false,loader:{'.css':'empty'},jsx:'automatic',packages:'external',plugins:[{name:'card-context',setup(builder){
  builder.onResolve({filter:/.*/},args=>{const name=args.path.split('/').at(-1)!;return mocks[name]?{path:name,namespace:'card-context'}:undefined;});
  builder.onLoad({filter:/.*/,namespace:'card-context'},args=>({contents:mocks[args.path],loader:'js'}));
 }}]});
 const module={exports:{} as any};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
 return {prices,render(offer:any,view:string){
  (globalThis as any).__japanPowerCardView=view;
  return renderToStaticMarkup(createElement(module.exports.CatalogCard,{offer,compact:true,dense:true}));
 },close(){delete (globalThis as any).__japanPowerCardView;delete (globalThis as any).__japanPowerCardPrices;}};
}

test('actual grid and list cards cannot hide unknown PW behind an obsolete compact estimate',async()=>{
 const fixture=await japanPowerCardFixture();
 const raw=offer('79,98','legacy-estimate');
 const unknown=publicOffer({...raw,japanPowerEstimate:{offerId:raw.id,values:[79,98],requiresConfirmation:true}} as any);
 assert.equal(unknown.japanPowerUnknown,true);
 try{
  for(const view of ['grid','list']){
   const html=fixture.render(unknown,view);
   assert.match(html,/data-japan-power-unknown="true"/);assert.match(html,/Мощность не указана/);
   assert.doesNotMatch(html,/79 \/ 98|79 л\.с\.|98 л\.с\./);
   const supplied=fixture.render(publicOffer(offer(150)),view);
   assert.match(supplied,/data-japan-supplier-power="true"/);assert.match(supplied,/150 л\.с\. · поставщик/);
  }
 }finally{fixture.close();}
});

test('saved calculation previews preserve original Japan supplier and unknown labels in actual grid and list cards',async()=>{
 const fixture=await japanPowerCardFixture();
 const preview={version:'card-preview-fixture',totalRub:700014,deliveryCity:'',parameters:{powerHp:58,powerKw:42.66,fuel:'petrol',engineCc:660}};
 try{
  for(const power of [58,150,''])for(const view of ['grid','list']){
   const source=publicOffer(offer(power,`preview-provenance-${power||'unknown'}`));
   assert.equal(source.powerHp,undefined);
   const input={...source,savedCalculationPreview:preview},before=structuredClone(input);
   // The same source row must keep its discovery provenance before and after
   // a saved scenario arrives through the existing client preview hook.
   for(const value of [source,input]){
    const html=fixture.render(value,view);
    if(power){
     assert.match(html,/data-japan-supplier-power="true"/);
     assert.ok(html.includes(`${power} л.с. · поставщик`));
     assert.doesNotMatch(html,/data-japan-power-unknown/);
    }else{
     assert.match(html,/data-japan-power-unknown="true"/);
     assert.match(html,/Мощность не указана/);
     assert.doesNotMatch(html,/data-japan-supplier-power|58 л\.с\./);
    }
    assert.doesNotMatch(html,/42,66 кВт/,'a scenario is not the supplier power measurement');
   }
   const displayed=fixture.prices.at(-1);
   assert.equal(displayed.totalRub,preview.totalRub);
   assert.equal(displayed.powerHp,58);assert.equal(displayed.powerKw,42.66);
   assert.deepEqual(displayed.savedCalculationPreview,preview,'the price/calculation overlay is unchanged');
   assert.deepEqual(input,before,'rendering does not rewrite the source row or saved parameters');
  }
 }finally{fixture.close();}
});

test('Japan authoritative local and owner power still outrank supplier facts while saved prices retain their parameters',async()=>{
 const fixture=await japanPowerCardFixture();
 const preview={version:'manual-preview-fixture',totalRub:810000,deliveryCity:'',parameters:{powerHp:58,powerKw:42.66}};
 const local=publicOffer({...offer(150,'manual-local'),powerHp:180,powerKw:132.39,powerDataSource:'manual',powerDataConfidence:'verified'} as any);
 const owner=publicOffer(applyJapanOwnerSpecifications({...offer(200,'owner-local'),make:'HONDA',model:'STEPWGN',fuel:'petrol',powertrainKind:'combustion'}));
 try{
  for(const [source,hp] of [[local,180],[owner,150]] as const)for(const view of ['grid','list']){
   assert.equal(source.powerHp,hp);assert.equal(source.japanSupplierPower,undefined);assert.equal(source.japanPowerUnknown,undefined);
   assert.equal(ajesResultFilter({market:'japan',powerTo:160}).matches(source),hp<=160);
   const plain=fixture.render(source,view);
   assert.ok(plain.includes(`${hp} л.с.`));assert.doesNotMatch(plain,/data-japan-supplier-power|data-japan-power-unknown/);
   const input={...source,savedCalculationPreview:preview},before=structuredClone(input);
   const html=fixture.render(input,view);
   assert.doesNotMatch(html,/data-japan-supplier-power|data-japan-power-unknown/);
   assert.equal(ajesResultFilter({market:'japan',powerTo:160}).matches(input),hp<=160,'a saved scenario does not change authoritative selection');
   assert.equal(fixture.prices.at(-1).totalRub,preview.totalRub);
   assert.deepEqual(fixture.prices.at(-1).savedCalculationPreview,preview);
   assert.deepEqual(input,before);
  }
 }finally{fixture.close();}
});

test('Japan cards without previews retain existing local normalization and non-Japan preview rendering is unchanged',async()=>{
 const fixture=await japanPowerCardFixture();
 const source={...publicOffer(offer('','local-normalization')),catalogPricingMode:undefined,totalRub:900000,powerKw:110,
  cardProjectionVersion:3,publicVisibleRub:900000,publicSpecificationVerified:true,calculationStatus:'estimated',operational:{raw:{powerKw:110}}};
 const foreign={...publicOffer(offer(150,'foreign-preview')),market:'china',powerHp:122,powerKw:89.73,
  savedCalculationPreview:{version:'foreign-preview-fixture',totalRub:910000,deliveryCity:'',parameters:{powerHp:58,powerKw:42.66}}};
 try{
  for(const view of ['grid','list']){
   const html=fixture.render(source,view);
   assert.match(html,/149,56 л\.с\./);assert.doesNotMatch(html,/data-japan-supplier-power|data-japan-power-unknown/);
   assert.equal(fixture.prices.at(-1).powerHp,149.56);assert.equal(fixture.prices.at(-1).powerKw,110);
   const foreignHtml=fixture.render(foreign,view);
   assert.match(foreignHtml,/58 л\.с\./);assert.doesNotMatch(foreignHtml,/data-japan-supplier-power|data-japan-power-unknown/);
   assert.equal(fixture.prices.at(-1).totalRub,910000);
   assert.deepEqual(fixture.prices.at(-1).savedCalculationPreview,foreign.savedCalculationPreview);
  }
 }finally{fixture.close();}
});

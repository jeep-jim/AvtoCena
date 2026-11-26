import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {parseJapanSourcePower,japanSupplierPower,japanSupplierPreviewPower,japanSupplierPowerLabel,japanUnknownPower,japanPowerFilterSummary} from '../apps/web/lib/catalog/japan-source-power';
import {ajesResultFilter} from '../apps/web/lib/catalog/ajes-result-filter';
import {ajesPowerEstimateHp} from '../apps/web/lib/catalog/ajes-power-estimate';
import {ajesCatalogQuery,ajesLot,ajesQuery,ajesSourceCacheSql} from '../apps/web/lib/catalog/ajes-query';
import {ajesOffer} from '../apps/web/lib/catalog/ajes-offer';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {publicOffer} from '../apps/web/lib/catalog/storage';
import {offerParameterDraft} from '../apps/web/lib/catalog/offer-parameter-draft';
import {japanPreviewParameters} from '../apps/web/lib/catalog/japan-preview-parameters';
import {validateCustomerParameters} from '../apps/web/lib/catalog/customer-parameters';
import {powerUnitPatch} from '../apps/web/lib/catalog/power-parameter-draft';
import {readFilteredAjesPage} from '../apps/web/lib/catalog/ajes-filtered-page';
import {applyJapanOwnerSpecifications} from '../apps/web/lib/catalog/japan-owner-specifications';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const row={ID:'power-fixture',MARKA_NAME:'TOYOTA',MODEL_NAME:'TEST',YEAR:2023,AUCTION_TYPE:2,STATUS:'Sold',FINISH:935000,TIME:'P',PW:'150',ENG_V:1490,IMAGES:''};
const rate={currency:'JPY',sourcePrice:935000,effectiveRate:0.6,cbrRate:60,nominal:100,rateDate:'2026-11-26',rateSource:'cbr'} as any;
function offer(power:unknown,id='power-fixture',fuel='P'){
 return ajesOffer(ajesLot({...row,ID:id,PW:power,TIME:fuel},'stats',false)!,rate,'2026-11-26T04:00:00Z');
}

const sourceObservedAt=new Date(Date.now()-1000).toISOString();
const sourcePage=(query:any,items:any[],received=items.length,flags:Record<string,unknown>={})=>({items,page:query.page||1,pageSize:query.pageSize||24,received,sourceFingerprint:createHash('sha256').update(JSON.stringify(items)).digest('hex'),partial:false,stale:false,observedAt:sourceObservedAt,...flags});
const sourceReceipt=(query:any,sequence:number,patch:Record<string,unknown>={})=>({version:1,
 readId:`00000000-0000-4000-8000-${String(sequence).padStart(12,'0')}`,runtimeSha:'a'.repeat(40),
 readStartedAt:new Date(Date.now()).toISOString(),readFinishedAt:new Date(Date.now()).toISOString(),
 table:'stats',kind:'list',page:query.page||1,pageSize:query.pageSize||24,
 canonicalQuerySha256:'b'.repeat(64),wireQuerySha256:'c'.repeat(64),disposition:'memory_cache',
 sourceAttempted:false,reason:null,sourceAttempt:null,...patch});
async function catalogPowerFixture(read:(query:any)=>unknown|Promise<unknown>){
 const state={queries:[] as any[],counts:0,priced:[] as string[][],editorial:{revision:'fixture',entries:{}},priceHook:undefined as undefined|(()=>void),query:ajesCatalogQuery,filter:ajesResultFilter,project:publicOffer,read:async(query:any,options:any)=>{const request={...query,phase:options?.powerContext?.phase};state.queries.push(request);return read(request);}};
 (globalThis as any).__japanPowerPageFixture=state;
 const stubs:Record<string,string>={
  'server-only':'','next/headers':"export const headers=async()=>new Map([['x-real-ip','127.0.0.1']]);",
  './ajes-runtime':"export const ajesClient={read:async()=>{globalThis.__japanPowerPageFixture.counts++;throw Error('unexpected source aggregate');}};",
  './ajes-public':`import {AjesUnavailable} from './apps/web/lib/catalog/ajes-access-policy.ts';
   export const cappedAjesQuery=async q=>q;export const readAjesPublic=async(q,o)=>{
    try{return await globalThis.__japanPowerPageFixture.read(q,o);}catch(error){
     if(!error?.reason)throw error;const failure=new AjesUnavailable(error.reason);
     Object.defineProperty(failure,'sourceReadReceipt',{value:error.sourceReadReceipt});throw failure;
    }
   };`,
  './ajes-query':'export const ajesCatalogQuery=p=>globalThis.__japanPowerPageFixture.query(p);export class AjesFilterUnavailable extends Error{};export class AjesInputError extends Error{constructor(){super("ajes_invalid_query");}};',
  '../encyclopedia/calculation-index':'export const readCalculationIndex=()=>null;',
  './editorial':'export const readCatalogEditorial=async()=>globalThis.__japanPowerPageFixture.editorial;',
  './ajes-client':'export const readAjesModelDirectory=async()=>({models:[]});export const readAjesMakeDirectory=async()=>({makes:[]});export class AjesUnavailable extends Error{constructor(reason){super("ajes_"+reason);this.reason=reason;}};',
  './ajes-result-filter':'export const ajesResultFilter=p=>globalThis.__japanPowerPageFixture.filter(p);',
  './storage':'export const publicOffer=x=>globalThis.__japanPowerPageFixture.project(x);','./market-page':'export const sortCatalogRows=x=>x;',
  './live-business-pricing':'export const applyActiveBusinessPricingBatch=async rows=>{globalThis.__japanPowerPageFixture.priced.push(rows.map(row=>row.id));globalThis.__japanPowerPageFixture.priceHook?.();return rows;};',
  './collection-controls':'export const assertCollectionEnabled=async()=>{};',
  './japan-preview-parameters':'export const japanPreviewParameters=()=>({});',
  '../encyclopedia/calculation-evidence':'export const hasEncyclopediaCalculationEvidence=()=>false;',
 };
 const bundle=await build({entryPoints:['apps/web/lib/catalog/ajes-catalog.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['react'],plugins:[{name:'power-page-fixture',setup(builder){
  builder.onResolve({filter:/.*/},args=>args.path in stubs?{path:args.path,namespace:'power-page-fixture'}:undefined);
  builder.onLoad({filter:/.*/,namespace:'power-page-fixture'},args=>({contents:stubs[args.path],resolveDir:process.cwd()}));
 }}]});
 const module={exports:{} as any},require=createRequire(import.meta.url);
 new Function('require','module','exports',bundle.outputFiles[0].text)((id:string)=>id==='react'?{cache:(fn:any)=>fn}:require(id),module,module.exports);
 return {state,read:module.exports.readAjesCatalogPage,close:()=>{delete (globalThis as any).__japanPowerPageFixture;}};
}

test('catalogue receipts belong to the current read, including cached cursor pages and stale retries',async()=>{
 const previousRuntime=process.env.AVTOCENA_RELEASE_SHA;process.env.AVTOCENA_RELEASE_SHA='a'.repeat(40);
 let clock=Date.now(),sequence=0,stale=true;
 const mockedClock=mock.method(Date,'now',()=>clock);
 const fixture=await catalogPowerFixture(query=>sourcePage(query,Array.from({length:48},(_,i)=>offer(150,`receipt-${i}`)),48,
  {stale,sourceReadReceipt:sourceReceipt(query,++sequence),sourceReadReceipts:[{private:'OLD_RECEIPT'}],catalogReadReceipt:{private:'OLD_WRAPPER'}}));
 try{
  const params={market:'japan',powerTo:'160'};
  const first=await fixture.read(params,undefined,{includeCount:false});
  assert.equal(first.stale,true);assert.ok(first.retryCursor);
  stale=false;clock+=1000;
  const retry=await fixture.read({...params,after:first.retryCursor},undefined,{includeCount:false});
  clock+=1000;
  const cached=await fixture.read(params,undefined,{includeCount:false});
  clock+=1000;
  const second=await fixture.read({...params,page:'2',after:cached.nextCursor},undefined,{includeCount:false});
  for(const [index,result] of [first,retry,cached,second].entries()){
   const receipt=result.catalogReadReceipt;
   assert.equal(receipt.version,1);assert.match(receipt.readId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
   assert.equal(receipt.runtimeSha,'a'.repeat(40));assert.equal(receipt.sourceReadCalls,1);
   assert.equal(receipt.readStartedAt,receipt.readFinishedAt);
   assert.equal(result.sourceReadReceipts.length,1);assert.equal(result.sourceReadReceipts[0].readId,sourceReceipt({},index+1).readId);
   assert.equal(result.sourceReadReceipts[0].sourceAttempted,false);assert.equal(result.sourceReadReceipts[0].disposition,'memory_cache');
   assert.equal(result.sourceReadReceiptsLimited,false);assert.equal('sourceReadReceipt' in result,false);
   assert.equal(JSON.stringify(result).includes('OLD_'),false);
  }
  assert.equal(new Set([first,retry,cached,second].map(value=>value.catalogReadReceipt.readId)).size,4);
  assert.equal(new Set([first,retry,cached,second].map(value=>value.catalogReadReceipt.readStartedAt)).size,4);
  assert.equal(retry.partial,false);assert.equal(cached.partial,false);assert.equal(second.items.length,24);
  assert.equal(first.sourceRevision,second.sourceRevision,'read identity never changes the source/cursor fingerprint');
  assert.equal(new Set([...cached.items,...second.items].map((item:any)=>item.id)).size,48);
  assert.equal(fixture.state.counts,0,'optional COUNT is not list evidence');assert.equal(sequence,4);
 }finally{fixture.close();mockedClock.mock.restore();if(previousRuntime===undefined)delete process.env.AVTOCENA_RELEASE_SHA;else process.env.AVTOCENA_RELEASE_SHA=previousRuntime;}
});

test('catalogue evidence is bounded to actual source reads and marks missing or unsafe receipts',async()=>{
 for(const unsafe of [false,true]){
  let sequence=0;
  const fixture=await catalogPowerFixture(query=>sourcePage(query,[],48,{sourceReadReceipt:unsafe?
   {private:'PRIVATE_RECEIPT',sql:'PRIVATE_SQL',clientIp:'PRIVATE_IP'}:sourceReceipt(query,++sequence)}));
  try{
   const result=await fixture.read({market:'japan',powerTo:'160'},undefined,{includeCount:false});
   assert.equal(result.catalogReadReceipt.sourceReadCalls,8);assert.equal(fixture.state.queries.length,8);
   assert.equal(result.sourceReadReceipts.length,unsafe?0:8);assert.equal(result.sourceReadReceiptsLimited,unsafe);
   assert.equal(JSON.stringify(result).includes('PRIVATE_'),false);assert.equal(result.partial,true);assert.ok(result.retryCursor);
  }finally{fixture.close();}
 }
});

test('a caught continuation failure is attributed to its current read and is not replayed on retry',async()=>{
 let sequence=0,failing=true;
 const fixture=await catalogPowerFixture(query=>{
  const receipt=sourceReceipt(query,++sequence);
  if(query.page===2&&failing)throw {reason:'request_timeout',sourceReadReceipt:{...receipt,disposition:'unavailable',reason:'request_timeout',sourceAttempted:true,
   sourceAttempt:{startedAt:receipt.readStartedAt,finishedAt:receipt.readFinishedAt,httpStatus:null}}};
  return sourcePage(query,Array.from({length:query.page===1?23:48},(_,i)=>offer(150,`failure-${query.page}-${i}`)),48,{sourceReadReceipt:receipt});
 });
 try{
  const params={market:'japan',powerTo:'160'},first=await fixture.read(params);
  assert.equal(first.items.length,23);assert.equal(first.interrupted,true);assert.equal(first.catalogReadReceipt.sourceReadCalls,2);
  assert.equal(first.sourceReadReceiptsLimited,false);assert.deepEqual(first.sourceReadReceipts.map((r:any)=>[r.page,r.reason,r.sourceAttempted]),[[1,null,false],[2,'request_timeout',true]]);
  failing=false;const retry=await fixture.read({...params,after:first.retryCursor});
  assert.equal(retry.items.length,24);assert.equal(retry.interrupted,false);assert.equal(retry.partial,false);
  assert.equal(retry.catalogReadReceipt.sourceReadCalls,2);assert.equal(retry.sourceReadReceiptsLimited,false);
  assert.deepEqual(retry.sourceReadReceipts.map((r:any)=>r.readId),[sourceReceipt({},3).readId,sourceReceipt({},4).readId]);
  assert.ok(retry.sourceReadReceipts.every((r:any)=>r.reason===null));
 }finally{fixture.close();}
});

test('an optional COUNT failure is not reported as the list source failure',async()=>{
 const fixture=await catalogPowerFixture(query=>sourcePage(query,Array.from({length:48},(_,i)=>offer(150,`count-${i}`)),48,
  {sourceReadReceipt:sourceReceipt(query,1)}));
 try{
  const result=await fixture.read({market:'japan'});
  assert.equal(fixture.state.counts,1);assert.equal(result.catalogReadReceipt.sourceReadCalls,1);
  assert.deepEqual(result.sourceReadReceipts.map((r:any)=>[r.kind,r.reason]),[['list',null]]);
  assert.equal(result.sourceReadReceiptsLimited,false);assert.equal(result.partial,false);assert.equal(result.items.length,24);
 }finally{fixture.close();}
});

test('power selection fills 24 known cars from bounded source portions before exposing unknown',async()=>{
 const fixture=await catalogPowerFixture(query=>sourcePage(query,query.page===1?
  [...Array.from({length:23},(_,i)=>offer(150,`first-${i}`)),offer('','unknown')]:Array.from({length:48},(_,i)=>offer(130,`next-${i}`)),48));
 try{
  const result=await fixture.read({market:'japan',powerTo:'160',city:'Новокузнецк'});
  assert.deepEqual(fixture.state.queries.map(q=>[q.phase,q.page,q.pageSize]),[['known',1,48],['known',2,48]]);
  assert.equal(result.items.length,24);assert.equal(result.items.at(-1).id,'ajes-stats-next-0');assert.equal(result.hasMore,true);
  assert.equal(result.total,null);assert.equal(result.countSummary,null);assert.match(result.nextCursor,/^jp1\./);assert.equal(result.partial,false);
  assert.deepEqual(result.powerFilterSummary,{shown:24,localPower:0,supplierPower:24,unknownPower:0});assert.equal(fixture.state.counts,0);
 }finally{fixture.close();}
});

test('query-bound numbered pages keep all known cars first and never repeat a borrowed row',async()=>{
 const fixture=await catalogPowerFixture(query=>query.phase==='unknown'?sourcePage(query,Array.from({length:48},(_,i)=>offer('',`unknown-${i}`)),48):
  sourcePage(query,Array.from({length:query.page===1?45:7},(_,i)=>offer(150,`known-${(query.page===1?0:45)+i}`)),query.page===1?48:7));
 try{
  const params={market:'japan',powerTo:'160'},first=await fixture.read(params),second=await fixture.read({...params,page:'2',after:first.nextCursor}),third=await fixture.read({...params,page:'3',after:second.nextCursor});
  assert.deepEqual([first,second,third].map(result=>result.items.length),[24,24,24]);
  assert.ok([...first.items,...second.items].every((item:any)=>item.japanSupplierPower));
  assert.deepEqual(third.items.slice(0,4).map((item:any)=>item.id),['ajes-stats-known-48','ajes-stats-known-49','ajes-stats-known-50','ajes-stats-known-51']);
  assert.ok(third.items.slice(4).every((item:any)=>item.japanPowerUnknown));
  assert.equal(new Set([...first.items,...second.items,...third.items].map((item:any)=>item.id)).size,72);assert.equal(fixture.state.counts,0);
 }finally{fixture.close();}
});

test('sparse conservative known candidates stop at the bound without a false zero or premature unknown phase',async()=>{
 const fixture=await catalogPowerFixture(query=>sourcePage(query,Array.from({length:48},(_,i)=>offer(180,`over-${query.page}-${i}`)),48));
 try{
  const result=await fixture.read({market:'japan',powerTo:'160'});
  assert.equal(fixture.state.queries.length,8);assert.ok(fixture.state.queries.every(q=>q.phase==='known'));assert.deepEqual(result.items,[]);
  assert.equal(result.partial,true);assert.equal(result.scanLimited,true);assert.equal(result.hasMore,false);assert.match(result.retryCursor,/^jp1\./);
  assert.equal(result.total,null);assert.equal(result.countSummary,null);
 }finally{fixture.close();}
});

test('only fresh exhaustion of both power phases establishes an exact first-page count',async()=>{
 const fixture=await catalogPowerFixture(query=>sourcePage(query,[150,200,''].map((pw,i)=>offer(pw,`last-${i}`)),3));
 try{
  const result=await fixture.read({market:'japan',powerTo:'160'});
  assert.equal(result.hasMore,false);assert.equal(result.items.length,2);assert.equal(result.total,2);
  assert.deepEqual(result.countSummary,{total:2,upperBound:false,stale:false,observedAt:result.observedAt});
  assert.deepEqual(result.powerFilterSummary,{shown:2,localPower:0,supplierPower:1,unknownPower:1});assert.equal(result.nextCursor,null);
  assert.deepEqual(fixture.state.queries.map(q=>q.phase),['known','unknown']);
 }finally{fixture.close();}
});

test('saved known rows keep stale/partial evidence and cannot move unknown ahead of an unproved source end',async()=>{
 for(const flags of [{stale:true},{partial:true},{partial:true,stale:true}]){
  const fixture=await catalogPowerFixture(query=>sourcePage(query,[offer(150,'saved'),offer('','saved-unknown')],2,flags));
  try{
   const result=await fixture.read({market:'japan',powerTo:'160'});
   assert.equal(result.stale,Boolean(flags.stale));assert.equal(result.partial,true);assert.equal(result.observedAt,sourceObservedAt);
   assert.equal(result.total,null);assert.equal(result.countSummary,null);assert.equal(result.hasMore,false);assert.equal(result.items.length,1);
   assert.equal(fixture.state.queries.length,1);assert.equal(fixture.state.queries[0].phase,'known');assert.ok(result.retryCursor);
  }finally{fixture.close();}
 }
});

test('power combined with body, fuel, drive and color preserves every local condition in both phases',async()=>{
 const matching={bodyType:'sedan',fuel:'petrol',drive:'awd',color:'белый'};
 const rows=[{...offer(150,'combined-known'),...matching},{...offer('','combined-unknown'),...matching},
  {...offer(200,'combined-high'),...matching},{...offer('','combined-body'),...matching,bodyType:'suv'},
  {...offer('','combined-fuel'),...matching,fuel:'diesel'},{...offer('','combined-drive'),...matching,drive:'fwd'},
  {...offer('','combined-color'),...matching,color:'красный'}];
 const fixture=await catalogPowerFixture(query=>sourcePage(query,rows,rows.length));
 try{
  const result=await fixture.read({market:'japan',powerTo:'160',...matching,city:'Новокузнецк'});
  assert.deepEqual(result.items.map((item:any)=>item.id),['ajes-stats-combined-known','ajes-stats-combined-unknown']);assert.equal(result.total,2);
  assert.equal(fixture.state.queries.length,2);for(const q of fixture.state.queries)for(const key of ['fuel','drive','color'] as const)assert.equal(q[key],matching[key]);
 }finally{fixture.close();}
});

test('unbound legacy source-offset cursors are rejected before a source read',async()=>{
 const fixture=await catalogPowerFixture(()=>{throw Error('unexpected source read');});
 try{await assert.rejects(fixture.read({market:'japan',powerTo:'160',page:'2',after:'2.3'}),/ajes_invalid_query/);assert.equal(fixture.state.queries.length,0);}finally{fixture.close();}
});

test('power plus delivered-price filtering fills 24 while excluding excess power before pricing',async()=>{
 const pricedOffer=(power:unknown,id:string)=>({...offer(power,id),catalogPricingMode:undefined,totalRub:500000});
 const fixture=await catalogPowerFixture(query=>sourcePage(query,query.page===1?[pricedOffer(150,'price-first'),pricedOffer(200,'price-excluded')]:Array.from({length:48},(_,i)=>pricedOffer(150,`price-next-${i}`)),48));
 try{
  const result=await fixture.read({market:'japan',powerTo:'160',budgetTo:'900000'});
  assert.deepEqual(fixture.state.queries.map(q=>[q.phase,q.page]),[['known',1],['known',2]]);assert.equal(result.items.length,24);
  assert.match(result.nextCursor,/^jp1\./);assert.equal(result.hasMore,true);assert.equal(result.total,null);
  assert.deepEqual(fixture.state.priced.map(ids=>ids.length),[1,48]);assert.ok(!fixture.state.priced.flat().includes('ajes-stats-price-excluded'));
 }finally{fixture.close();}
});

test('a local revision changed during pricing cannot cross the frozen power phase boundary',async()=>{
 const fixture=await catalogPowerFixture(query=>sourcePage(query,[{...offer(150,'revision'),catalogPricingMode:undefined,totalRub:500000}],1));
 try{fixture.state.priceHook=()=>{fixture.state.editorial={revision:'changed',entries:{}};};await assert.rejects(fixture.read({market:'japan',powerTo:'160',budgetTo:'900000'}),/ajes_cursor_expired/);}finally{fixture.close();}
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
 assert.equal(reads,1);assert.deepEqual(filtered,ordinary);assert.deepEqual(otherPower,ordinary);
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

test('actual grid and list cards cannot hide unknown PW behind an obsolete compact estimate',async()=>{
 const mocks:Record<string,string>={
  CatalogSelectionContext:'export const useCatalogView=()=>globalThis.__japanPowerCardView;',
  DealerBrowsingContext:'export const useDealerBrowsing=()=>null;',
  useSavedCalculationPreview:'export const useSavedCalculationPreview=()=>undefined;',
  FavoriteToggle:'export const FavoriteToggle=()=>null;',
  CatalogCover:'export const CatalogCover=()=>null;',
  CatalogPrice:'export const CatalogPrice=()=>null;',
  IntentPrefetchLink:'export const IntentPrefetchLink=({children})=>children;',
  'RecyclingPower.module.css':'export default {};',
 };
 const bundle=await build({entryPoints:['apps/web/components/catalog/CatalogCard.tsx'],bundle:true,platform:'node',format:'cjs',write:false,loader:{'.css':'empty'},jsx:'automatic',packages:'external',plugins:[{name:'card-context',setup(builder){
  builder.onResolve({filter:/.*/},args=>{const name=args.path.split('/').at(-1)!;return mocks[name]?{path:name,namespace:'card-context'}:undefined;});
  builder.onLoad({filter:/.*/,namespace:'card-context'},args=>({contents:mocks[args.path],loader:'js'}));
 }}]});
 const module={exports:{} as any};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
 const raw=offer('79,98','legacy-estimate');
 const unknown=publicOffer({...raw,japanPowerEstimate:{offerId:raw.id,values:[79,98],requiresConfirmation:true}} as any);
 assert.equal(unknown.japanPowerUnknown,true);
 try{
  for(const view of ['grid','list']){
   (globalThis as any).__japanPowerCardView=view;
   const html=renderToStaticMarkup(createElement(module.exports.CatalogCard,{offer:unknown}));
   assert.match(html,/data-japan-power-unknown="true"/);assert.match(html,/Мощность не указана/);
   assert.doesNotMatch(html,/79 \/ 98|79 л\.с\.|98 л\.с\./);
   const supplied=renderToStaticMarkup(createElement(module.exports.CatalogCard,{offer:publicOffer(offer(150))}));
   assert.match(supplied,/data-japan-supplier-power="true"/);assert.match(supplied,/150 л\.с\. · поставщик/);
  }
 }finally{delete (globalThis as any).__japanPowerCardView;}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {readFilteredAjesPage,readPowerOrderedAjesPage,ajesPowerEvidenceEpoch,assertAjesPowerCursorEpoch} from '../apps/web/lib/catalog/ajes-filtered-page';
import {AjesCursorRefreshRequired} from '../apps/web/lib/catalog/ajes-query';
import {AjesUnavailable} from '../apps/web/lib/catalog/ajes-client';

type Row={id:string;known:boolean};
type Page={items:Row[];received:number;observedAt:string;partial?:boolean;stale?:boolean};
const rows=(page:number,count=24,known=true):Row[]=>Array.from({length:count},(_,i)=>({id:`ajes-stats-${page}-${i}`,known}));
const summary=(total:number,upperBound=true,tag='a')=>({total,upperBound,stale:false,observedAt:new Date().toISOString(),
 ...(upperBound?{sourceCountProof:{requestedQueryHash:tag.repeat(64)}}:{countProof:{coverageHash:tag.repeat(64),evidenceEpoch:tag.repeat(64),sourceTotal:total,knownTotal:0}})});

// Exercise the actual catalog-page function with controlled source/count
// adapters. No application bootstrap, supplier request or copied reader logic.
function fixture(){
 const state={count:null as any,countReads:0,reads:[] as number[],revision:'editorial-1',calculationDigest:null as string|null,
  pricingDigest:'price-1',source:async(page:number):Promise<Page>=>({items:rows(page),received:24,observedAt:new Date().toISOString()})};
 const query=(params:Record<string,unknown>)=>({table:'stats',make:'AUDI',model:'A4',page:Number(params.page||1),pageSize:24,
  ...(params.powerTo?{powerTo:Number(params.powerTo)}:{}),...(params.sort?{sort:String(params.sort)}:{})});
 const bindings={
  process:{env:{AVTOCENA_RELEASE_SHA:'a'.repeat(40)}},
  assertAjesJapanMarket:(market:unknown)=>assert.equal(market,'japan'),
  ajesResultFilter:(params:Record<string,unknown>)=>({active:Boolean(params.powerTo||params.budgetTo),powerFilter:Boolean(params.powerTo),priceFilter:Boolean(params.budgetTo),matchesPower:()=>true,matches:()=>true}),
  readAjesPublicEvidenceSnapshot:async()=>({editorial:{revision:state.revision,entries:{}},calculationIndex:state.calculationDigest?{digest:state.calculationDigest}:null}),
  captureAjesCountPricingContext:async()=>({digest:state.pricingDigest,run:async(work:()=>Promise<any>)=>work(),price:async(items:Row[])=>items}),
  ajesPowerEvidenceEpoch,assertAjesPowerCursorEpoch,ajesCatalogQuery:query,AjesCursorRefreshRequired,
  japanLocalPowerHp:(row:Row)=>row.known?150:undefined,japanSupplierPower:()=>undefined,japanUnknownPower:(row:Row)=>!row.known,
  resolvedCatalogQuery:async(key:string)=>({query:query(JSON.parse(key)),modelDirectoryUnavailable:false,makeDirectoryUnavailable:false}),
  ajesSourceScopeSupportsExactCount:()=>true,parseCatalogSort:(value?:string)=>value?value.split(','):[],
  readAjesCountSummary:async()=>{state.countReads++;if(state.count===null)throw new AjesUnavailable('count_unavailable');return state.count;},
  readAjesPublic:async(q:{page:number})=>{state.reads.push(q.page);return state.source(q.page);},
  safePublicPricing:(row:Row)=>row,hasEncyclopediaCalculationEvidence:()=>false,japanPreviewParameters:()=>({}),
  applyActiveBusinessPricingBatch:async(items:Row[])=>items,readFilteredAjesPage,readPowerOrderedAjesPage,
  sortCatalogRows:(items:Row[])=>items,withCatalogEditorialSnapshot:async(_index:unknown,work:()=>Promise<any>)=>work(),
  publicOffer:(row:Row)=>row,japanPowerFilterSummary:(items:Row[])=>({shown:items.length}),
 };
 const source=readFileSync(new URL('../apps/web/lib/catalog/ajes-catalog.ts',import.meta.url),'utf8');
 const start=source.indexOf('export async function readAjesCatalogPage('),end=source.indexOf('/** Add once to totals',start);
 assert(start>=0&&end>start);
 const body=stripTypeScriptTypes(source.slice(start,end).replace(/^export /,''),{mode:'transform'});
 const readPage=new Function(...Object.keys(bindings),body+'\nreturn readAjesCatalogPage;')(...Object.values(bindings));
 return {state,readPage};
}

for(const power of [false,true])test(`count availability, value and observation metadata do not change ${power?'power':'ordinary'} continuation`,async()=>{
 const {state,readPage}=fixture();
 const params={market:'japan',make:'Audi',model:'A4',city:'Новокузнецк',...(power?{powerTo:'160'}:{})};
 const first=await readPage(params,undefined,{includeCount:false});
 assert.equal(state.countReads,0);assert.equal(first.items.length,24);assert.equal(first.total,null);assert(first.nextCursor);
 state.count=summary(24,false);
 const countedFirst=await readPage(params);
 assert.equal(countedFirst.nextCursor,first.nextCursor,'a later scalar observation is not a cursor epoch');
 assert.equal(countedFirst.hasMore,true,'a count equal to loaded rows cannot truncate the source continuation');
 for(const [total,upperBound,tag] of [[999,true,'b'],[0,true,'c'],[48,false,'d']] as const){
  state.count={...summary(total,upperBound,tag),observedAt:'2026-11-28T12:34:56.000Z'};
  const second=await readPage({...params,page:'2',after:first.nextCursor});
  assert.equal(second.items.length,24);assert.deepEqual(second.items,rows(2));assert.equal(second.hasMore,true);
  assert(second.nextCursor);assert.equal(second.total,upperBound?null:48);
  assert.equal(second.countSummary,state.count,'source-scope metadata remains distinct from exact total');
 }
 assert.deepEqual(state.reads,[1,1,2,2,2]);
});

test('zero counts do not erase fresh rows and large counts do not extend an exhausted list',async()=>{
 const {state,readPage}=fixture();state.count=summary(0,false);
 const first=await readPage({market:'japan'});
 assert.equal(first.items.length,24);assert.equal(first.total,null);assert.equal(first.hasMore,true);
 state.count=summary(1000,false);
 state.source=async(page)=>({items:rows(page,3),received:3,observedAt:new Date().toISOString()});
 const last=await readPage({market:'japan',page:'2',after:first.nextCursor});
 assert.equal(last.items.length,3);assert.equal(last.hasMore,false);assert.equal(last.nextCursor,null);
 const numbered=await readPage({market:'japan',page:'2'});
 assert.equal(numbered.items.length,3);assert.equal(numbered.hasMore,false,'a scalar count does not require a cursor for a normal numbered request');
});

test('positive counts preserve useful cards and the failed source offset on a later refusal',async()=>{
 const {state,readPage}=fixture();state.count=summary(999,false);
 state.source=async(page)=>{if(page===2)throw new AjesUnavailable('visitor_restricted');return {items:rows(1,1),received:24,observedAt:new Date().toISOString()};};
 const page=await readPage({market:'japan'});
 assert.deepEqual(page.items,rows(1,1));assert.equal(page.partial,true);assert.equal(page.interrupted,true);
 assert.equal(page.hasMore,true);assert.match(page.nextCursor,/^j1\.2\.0\.2\./);assert.deepEqual(state.reads,[1,2]);
});

test('positive counts cannot replace a retained stale-page retry with a nonexistent continuation',async()=>{
 const {state,readPage}=fixture();state.count=summary(999,false);
 state.source=async(page)=>({items:rows(page),received:24,observedAt:new Date().toISOString(),stale:true});
 const page=await readPage({market:'japan'});
 assert.equal(page.items.length,24);assert.equal(page.stale,true);assert.equal(page.hasMore,false);assert.equal(page.nextCursor,null);
 assert.deepEqual(state.reads,[1]);
});

for(const change of ['editorial','calculation','pricing'] as const)test(`${change} evidence remains bound independently of counts`,async()=>{
 const {state,readPage}=fixture();const params={market:'japan',...(change==='pricing'?{budgetTo:'2000000'}:{})};
 const first=await readPage(params,undefined,{includeCount:false});
 if(change==='editorial')state.revision='editorial-2';
 if(change==='calculation')state.calculationDigest='c'.repeat(64);
 if(change==='pricing')state.pricingDigest='price-2';
 const before=state.reads.length;
 await assert.rejects(readPage({...params,page:'2',after:first.nextCursor},undefined,{includeCount:false}),AjesCursorRefreshRequired);
 assert.equal(state.reads.length,before,'changed membership evidence is rejected before a source LIST read');
});

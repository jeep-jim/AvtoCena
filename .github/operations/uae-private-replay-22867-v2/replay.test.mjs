import assert from 'node:assert/strict';
import test from 'node:test';
import {replay,offerId,classifyPredecessor} from './replay.mjs';
import {inspectPage,START,SOURCE_SEAL} from './accepted-collector.mjs';
import {hash,verifyChainRows} from './chain.mjs';
import {prepareOutcomes} from './prepare.mjs';
const at='2026-11-21T03:45:04.942Z', now=Date.parse(at)+50000;
const a=(i,price=10)=>({market:'uae',sourceId:'dubicars_uae_exact',sourceOfferId:String(i),id:offerId(i),sourceCurrency:'AED',sourcePrice:price,status:'active',operational:{sourceUrl:'https://www.dubicars.com/a-'+i+'.html'}});
const e=(i,id,change_type,data)=>({id:START+i,inner_id:String(id),change_type,data,created_at:'2026-11-21T03:30:00Z'});
const make=({priorRows=[a(1),a(2)],events=[],historicRemovals=[]}={})=>
  replay({priorRows,events,historicRemovals,normalize:x=>x.data?.valid?a(x.inner_id,66):null,observedThrough:at});
test('explicit removal says unavailable, never sold; never infer from source absence',()=>{
 const p=make({events:[e(0,2,'removed'),e(1,3,'added',{valid:true})]});
 assert.deepEqual([...p.rows.keys()],['1','3']);
 const result=classifyPredecessor({old:[a(1),a(2),a(4)],result:p,now});
 assert.deepEqual(result.rows.map(x=>x.disposition),['present_in_source_needs_native_admission','provider_explicit_removed_not_sold','absence_not_sale_requires_comparison']);
 assert.equal(result.unresolved,1);
});
test('negative, identity conflict, and unknown price-only never stand as current money',()=>{
 const p=make({events:[e(0,1,'changed',{new_price:-1}),e(1,2,'changed',{new_price:0}),e(2,3,'changed',{new_price:900}),e(3,4,'added',{valid:false})]});
 assert.equal(p.held.size,3);assert.equal(p.held.get('1').reason,'invalid_or_unqualified_source_price');
 assert.equal(p.rows.get('2').sourcePrice,undefined);
 assert.equal(p.rows.get('2').totalRub,null);
 assert.equal(p.rows.has('3'),false);
 const result=classifyPredecessor({old:[a(1),a(2)],result:p,now});
 assert.equal(result.unresolved,1);
});
test('two exact pages bind allowance, receipts, owner and terminal chain',()=>{
 const p='a'.repeat(64), own='b'.repeat(64), base='2026-11-21T03:40:00.000Z';
 const create=(cursor,previous,events)=>{
  const body={result:events,meta:{cur_change_id:cursor,next_change_id:events.length?cursor+events.length:null,limit:20}};
  return {version:1,attempt:{version:1,market:'uae',seal:SOURCE_SEAL,permit:p,cursor,previous,owner:own,observedAt:base},
   observedAt:at,check:inspectPage(body,cursor,at),body};};
 const one=create(START,null,[e(0,1,'changed',{new_price:7})]),two=create(START+1,hash(one),[]);
 const f={cursor:START+1,pages:2,events:1,kinds:{added:0,changed:1,removed:0},needs:{added:0,changed:0},chain:hash(two),authorization:p,observations:at};
 two.attempt.observedAt=at;f.chain=hash(two);
 assert.equal(verifyChainRows([one,two],f).length,1);
 const corrupt=structuredClone(two);corrupt.attempt.owner='c'.repeat(64);
 assert.throws(()=>verifyChainRows([one,corrupt],f),/owner_or_chain/);
});
const proof={release:'22867cbcfaee27b2e8917b6bf880e44827f67b60',calculation:'4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90',
fxWireSha256:'a'.repeat(64),editorialSha256:'b'.repeat(64),retainedDetailsSha256:'c'.repeat(64),priceInputsSha256:'d'.repeat(64),photoRightsSha256:'e'.repeat(64),
 fxRateDate:'2026-11-20',aedRub:22,legalValidUntil:now+50000};
const n={isSeller:o=>o.catalogPricingMode==='seller',isRequest:o=>o.sourcePrice==null,deliverablePhotoProof:()=>false,deliveredRub:o=>o.totalRub};
function prepare(raw){return raw.sourcePrice==null?{kind:'onRequest',offer:{...raw,totalRub:null}}:{kind:'seller',offer:{...raw,totalRub:null,catalogPricingMode:'seller',sellerPriceRub:raw.sourcePrice*22,calculationSnapshot:{currencyRate:{rateSource:'cbr',rateDate:proof.fxRateDate}}}};}
test('per-ID price gates keep seller and request separate and never erase prior exact delivered',async()=>{
 const replayed=make({priorRows:[a(1,10),a(2,null)]});
 const f={replayed,predecessor:[a(1),a(2)],prepare,proof,native:n,clock:()=>now};
 const out=await prepareOutcomes(f);
 assert.ok(out.canProposeReady);assert.deepEqual(out.admitted,{seller:1,onRequest:1,retainedDelivered:0});
 await assert.rejects(prepareOutcomes({...f,proof:{...proof,aedRub:21}}),/unbound/);
 await assert.rejects(prepareOutcomes({...f,predecessor:[{...a(1),exactNativeDeliveredRub:100},a(2)]}),/price_changed/);
 const held=await prepareOutcomes({...f,replayed:make({events:[e(0,1,'changed',{new_price:-1})]})});
 assert.equal(held.canProposeReady,false);
});

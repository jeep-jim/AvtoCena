import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleDecisions,prepareChangedQuote} from '../scripts/lib/china-mixed-native-ledger.mjs';
const provider='autohome_used_china_open',innerId='54839432',id=createHash('sha256').update(provider+':'+innerId).digest('hex').slice(0,24);
const price=40000,good={id,sourceOfferId:innerId,sourceId:provider,market:'china',sourcePrice:price,operational:{provider:'auto-api.com',detailIdentityVerified:true}};
const at='2026-11-20T15:44:00.000Z';
const inputs=(kinds,final)=>({cursorFrom:51,cursorTo:60,expectedEventCount:kinds.length,events:kinds.map((kind,i)=>({kind,event:51+i,at,innerId,price,offer:good})),
 readFinalReplicaRow:async key=>{assert.equal(key,innerId);return final},admit:async ()=>true,afterVerifiedReaders:async()=>{}});
test('offer→remove, and explicit delete→readd only from final replica',async()=>{
  const off=await assembleDecisions(inputs(['offer','removed'],null)); assert.equal(off.decisions.get(id).state,'explicit_removed');
  const active=await assembleDecisions(inputs(['removed','offer'],good));assert.equal(active.decisions.get(id).state,'changed_admitted');
  await assert.rejects(assembleDecisions(inputs(['offer','removed'],good)),/replica_availability_mismatch/);
});
test('unknown/incomplete, bad provenance, and dangerous price-only after removal all refused',async()=>{
  await assert.rejects(assembleDecisions(inputs(['offer','missing_detail'],good)),/unresolved_detail/);
  await assert.rejects(assembleDecisions({...inputs(['offer'],good),expectedEventCount:2}),/incomplete_native_events/);
  await assert.rejects(assembleDecisions(inputs(['offer'],{...good,sourceId:'other'})),/owned_native_row/);
  await assert.rejects(assembleDecisions(inputs(['removed','price'],null)),/price_after_unavailable/);
});
test('only exact same verified frozen context reuses immutable prior receipt, changed quote engine once',async()=>{
  const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64),d='d'.repeat(64); let calls=0;
  const context={pricingAsOf:at,legalValidUntil:Date.parse(at)+10000,fxReceiptSha256:a,calculationVersion:b,pricingFingerprint:c};
  const quote={id,totalRub:123456};
  const x={decision:{state:'changed_admitted',row:good},verifiedPrior:{...context,sourceInputSha256:d,immutableReceiptSha256:a,id,frozenQuote:quote},
    sourceInputSha256:d,context,now:Date.parse(at)+1,calculateWithInstalledEngine:async row=>{assert.equal(row.id,id);calls++;return quote}};
  assert.deepEqual(await prepareChangedQuote(x),{mode:'reuse_exact_frozen',quote,provenanceSha256:a});assert.equal(calls,0);
  assert.deepEqual(await prepareChangedQuote({...x,sourceInputSha256:c}),{mode:'recalculated_once',quote});assert.equal(calls,1);
  await assert.rejects(prepareChangedQuote({...x,now:context.legalValidUntil}),/invalid_quote_scope/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {guardedCheckpointFetch} from './exact-read-cap.mjs';
const s='https://storage.invalid/x';
const one=maximum=>new Map([['GET '+s,{n:1,maximum,method:'GET'}]]);
test('permits exactly one scoped request and blocks redirects explicitly, retry, other key, supplier and writes',async()=>{
 let n=0; const g=guardedCheckpointFetch(async(_,opts)=>{n++;assert.equal(opts.redirect,'error');return new Response('ok');},one(2));
 for(const k of ['POST','PUT','HEAD'])await assert.rejects(g.fetch(s,{method:k}),/wire_budget/);
 for(const u of [s+'?x=1',s+'-other','https://api1.auto-api.com/'])await assert.rejects(g.fetch(u,{method:'GET'}),/wire_budget/);
 assert.equal(await (await g.fetch(s,{method:'GET'})).text(),'ok');
 await assert.rejects(g.fetch(s,{method:'GET'}),/wire_budget/);
 assert.equal(n,1);assert.deepEqual(g.finish(),{actualObjectGets:1,actualObjectHeads:0});
});
test('known advertised or chunked oversized response refused before parsing',async()=>{
 const bad=guardedCheckpointFetch(async()=>new Response('123',{headers:{'content-length':'3'}}),one(2));
 await assert.rejects(bad.fetch(s,{method:'GET'}),/wire_size/);
 const partial=guardedCheckpointFetch(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2]));c.enqueue(new Uint8Array([3]));c.close();}})),one(2));
 await assert.rejects(partial.fetch(s,{method:'GET'}),/wire_size/);
 const skipped=guardedCheckpointFetch(async()=>assert.fail('not executed'),one(2));
 assert.throws(()=>skipped.finish(),/wire_incomplete/);
});
test('actual manifest rejects a paid endpoint and all foreign object keys without a call',async()=>{
 const g=guardedCheckpointFetch(async()=>assert.fail('no wire'));
 for(const s of ['https://api1.auto-api.com/api/v3/encar/offers','https://s3.regru.cloud/another-bucket/catalog/manifest.json'])
  await assert.rejects(g.fetch(s,{method:'GET'}),/wire_budget/);
});
import {publicStatusSplit} from './verify-successor.mjs';
test('stdout projects only fixed numeric/boolean aggregates, never private anchor or unrecognized fields',()=>{
 const canary='DO_NOT_EXPORT_49123456_OR_TOKEN';
 const receipt={kind:'verified_korea_turnkey_native_sample',providerTerminal:false,fullFieldCoverageVerified:false,
  publish:false,providerCalls:0,objectWrites:0,cumulativeReservedAttempts:2000,
  predecessor:{originalAnchor:{id:49123456,key:canary}},sampling:canary,secret:canary,
  cohorts:{baseline:{sampleRows:60,wrappedAligned:60,cc:canary,iceHp:-2,photos:61,drive:1.5,arbitraryNumber:12},
    continuation:{sampleRows:60},secretCohort:{sampleRows:12}},
  nativeMask:{baseline:{russian_exact_predicate_pass:59,model_year_2022_plus:60,advertisement_type_token:12,
      native_cc:{value:canary},native_total_hp:'59',native_ice_hp:Infinity,bodyUrl:canary},continuation:{rows:60,model_year_missing:0}}};
 const projected=publicStatusSplit(receipt,{actualObjectGets:17,actualObjectHeads:3,privateEtag:canary});
 assert.deepEqual(projected,{kind:'verified_korea_turnkey_native_sample',providerTerminal:false,fullFieldCoverageVerified:false,publish:false,providerCalls:0,objectWrites:0,actualObjectGets:17,actualObjectHeads:3,
   cohorts:{baseline:{sampleRows:60,wrappedAligned:60},continuation:{sampleRows:60}},
   nativeMask:{baseline:{russian_exact_predicate_pass:59,model_year_2022_plus:60},continuation:{rows:60,model_year_missing:0}}});
 const stdout=JSON.stringify(projected);
 for(const privateField of [canary,'49123456','originalAnchor','predecessor','privateEtag','arbitraryNumber','secretCohort','advertisement_type_token','cumulativeReservedAttempts'])
  assert.ok(!stdout.includes(privateField));
 assert.throws(()=>publicStatusSplit({...receipt,kind:canary},{actualObjectGets:17,actualObjectHeads:3}),/encar_public_report_invariants/);
 assert.throws(()=>publicStatusSplit(receipt,{actualObjectGets:'17',actualObjectHeads:3}),/encar_exact_wire_budget/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {collect,collectBound,admit,START,SOURCE_SEAL,ROOT,inspectPage} from './collector.mjs';
const now=Date.parse('2026-11-21T03:25:50Z');
const permit={version:1,scope:'existing_paid_dubicars_changes_only',sealSha256:SOURCE_SEAL,serviceAuthority:'existing_owner_confirmed_paid_dubicars_v2',
checkedAt:'2026-11-21T03:00:00Z',expiresAt:'2026-11-21T08:00:00Z',programMaxHttpAttempts:600,accountAction:'none',reviewedWorkerTree:'a'.repeat(40)};
const body=(c,events)=>({result:events,meta:{cur_change_id:c,next_change_id:events.length?c+events.length:null,limit:20}});
function environment(){
 const store=new Map(), calls=[];
 const io={read:async k=>store.get(k)||null,create:async(k,v)=>{assert.ok(!store.has(k));store.set(k,v);}};
 const base={io,auth:admit(permit,now),phaseBudget:1,clock:()=>now,assertOwner:async()=>'e'.repeat(64)};
 function fetchFor(c,payload){return async cur=>{calls.push(cur);assert.equal(cur,c);return {status:200,payload};};}
 return {store,calls,io,base,fetchFor};
}
const event=(i,type='changed',data={new_price:155000})=>({id:START+i,inner_id:String(i+10),change_type:type,created_at:'2026-11-21T00:00:00Z',data});
test('pause then reconstruct durable cursor without revisiting paid first page',async()=>{
 const f=environment();
 const a=await collectBound({...f.base,fetchOne:f.fetchFor(START,body(START,[event(0),event(1,'removed',{})]))});
 assert.equal(a.workingCursor,START+2);assert.equal(a.state,'partial');
 const b=await collectBound({...f.base,fetchOne:f.fetchFor(START+2,body(START+2,[]))});
 assert.deepEqual(f.calls,[START,START+2]);assert.equal(b.state,'source_terminal');assert.equal(b.published,false);
 assert.deepEqual(b.eventKinds,{added:0,changed:1,removed:1});
 const c=await collectBound({...f.base,fetchOne:()=>assert.fail('paid reuse')});assert.deepEqual(b,c);
});
test('ambiguous transport and 402/429 never replay the reserved cursor',async()=>{
 for(const status of [402,429,503]){
   const f=environment();let hits=0;const call={...f.base,fetchOne:async()=>{hits++;return {status};}};
   await assert.rejects(collectBound(call),status===503?/request_failed/:/billing_or_quota_hold/);
   await assert.rejects(collectBound(call),/ambiguous_attempt_never_repeat/);assert.equal(hits,1);
   assert.ok(!f.store.has(ROOT+'sealed-delta.json'));
 }
});
test('broken page metadata fails, raw price only never becomes full detail',()=>{
 assert.throws(()=>inspectPage(body(START,[event(2)]),START,new Date(now).toISOString()),/event_identity/);
 const q=inspectPage(body(START,[event(0,'added',{new_price:15000}),event(1)]),START,new Date(now).toISOString());
 assert.deepEqual(q.unqualified,{added:1,changed:0});assert.deepEqual(q.types,{added:1,changed:1,removed:0});
});
test('valid paid guard cannot substitute a different private UAE seal',async()=>{
 const f=environment();
 await assert.rejects(collect({...f.base,permit,fetchOne:()=>assert.fail('paid request')}),/source_seal/);
 assert.throws(()=>admit({...permit,programMaxHttpAttempts:601},now),/limits_or_expiry/);
 assert.throws(()=>admit({...permit,accountAction:'upgrade'},now),/paid_authority/);
});

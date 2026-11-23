import test from 'node:test';
import assert from 'node:assert/strict';
import {cutOwnedChina} from '../scripts/lib/owned-china-cut.mjs';
import {rawDigest} from '../scripts/lib/catalog-raw-provenance.mjs';
const now=1795500000000;
function example(){
  const previous={generationId:'old'},base={etag:'E1',activeSha256:rawDigest(previous),state:{version:1,market:'china',revision:6,active:previous,previous:null}};
  let current=structuredClone(base),writes=[];
  const args={now:()=>now,receipt:{validUntil:now+120000,evidence:{control:base},target:{generationId:'new'}},
    store:{read:async()=>structuredClone(current),cas:async(etag,state)=>{assert.equal(current.etag,etag);writes.push(state);current={etag:'E'+(writes.length+1),state};}},
    sourceCurrent:async()=>{},preview:async()=>({checked:true}),rollbackCurrent:async()=>{},accept:async()=>{},lease:fn=>fn(async()=>{})};
  return {args,writes,change:()=>current={...current,etag:'competitor'},get:()=>current};
}
test('successful readback proves a CAS even after a lost response',async()=>{
 const f=example(),put=f.args.store.cas;f.args.store.cas=async(...args)=>{await put(...args);throw Error('lost response');};
 const r=await cutOwnedChina(f.args);assert(r.published);assert.equal(f.writes.length,1);assert.equal(r.revision,7);
});
test('private refusal, expired source and concurrent same-content ETag stop the switch',async()=>{
 for(const setup of [f=>{f.args.preview=f.change;},f=>{f.args.preview=async()=>{throw Error('invalid price');};},
  f=>{f.args.receipt.validUntil=now;}]){const f=example();setup(f);await assert.rejects(cutOwnedChina(f.args));assert.equal(f.writes.length,0);}
});
test('a failed public check restores only the still-owned active generation',async()=>{
 const f=example();f.args.accept=async()=>{throw Error('bad response');};await assert.rejects(cutOwnedChina(f.args),/restored/);
 assert.equal(f.get().state.active.generationId,'old');assert.equal(f.get().state.revision,8);assert.equal(f.writes.length,2);
 const g=example();g.args.accept=async()=>{g.change();throw Error('raced');};await assert.rejects(cutOwnedChina(g.args),/no longer owned/);assert.equal(g.writes.length,1);
});

test('a repeated upstream completion rechecks the already active public result without rewriting',async()=>{
 const f=example();await cutOwnedChina(f.args);let checked=0;
 f.args.accept=async()=>{checked++;};const again=await cutOwnedChina(f.args);
 assert.equal(again.alreadyActive,true);assert.equal(again.published,false);assert.equal(f.writes.length,1);assert.equal(checked,1);
});

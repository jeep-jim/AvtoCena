import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSourcePage,intakeState} from '../scripts/lib/catalog-source-intake.mjs';
function fixture(pages,detail=async()=>[]) {
 const source={sourceId:'test',fetchPage:async c=>pages[c || 'first'],normalizeOffer:r=>r,fetchImages:detail};
 const state=intakeState(source,{sourceId:'test'}),rows=[],delays=[];
 const options={waitForRetry:async ms=>delays.push(ms),market:'china',deadline:Date.now()+10000,maxRows:100,maxPages:10,minYear:2020,
 snapshot:(o,stage)=>({offer:structuredClone(o),stage}),writeObservation:async r=>rows.push(r),checkpoint:async()=>{}};
 return {state,rows,options,delays};
}
const offer={id:'one',sourceId:'test',market:'china',year:2024,status:'active',sourcePrice:10000,powerHp:undefined};
test('source month policy can retain an older trim year for exact detail collection',async()=>{
 const f=fixture({first:{items:[{...offer,year:2019}]}});
 f.options.inventoryAgeEligible=()=>true;
 await collectSourcePage(f.state,f.options);
 assert.equal(f.state.detailAttempts,1);assert.equal(f.state.outsideAge,0);
 const excluded=fixture({first:{items:[offer]}});excluded.options.inventoryAgeEligible=()=>false;
 await collectSourcePage(excluded.state,excluded.options);
 assert.equal(excluded.state.detailAttempts,0);assert.equal(excluded.state.outsideAge,1);
});
test('keeps incomplete listings, follows cursor, deduplicates across pages',async()=>{
 const f=fixture({first:{items:[offer],nextCursor:'next'},next:{items:[offer,{...offer,id:'two'}]}});
 await collectSourcePage(f.state,f.options);await collectSourcePage(f.state,f.options);
 assert.equal(f.state.seen.size,2);assert.equal(f.state.duplicates,1);assert.equal(f.rows.length,4);
 assert.equal(f.rows[0].offer.powerHp,undefined);assert.equal(f.state.stopReason,'source_finished');
});
test('preserves listing when detail fails and stops on access challenge',async()=>{
 const f=fixture({first:{items:[offer,{...offer,id:'two'}],nextCursor:'next'}},async()=>{throw Error('http_403')});
 await collectSourcePage(f.state,f.options);
 assert.equal(f.rows.length,1);assert.equal(f.state.stopReason,'blocked_detail');assert.equal(f.state.cursor,null);
});
test('does not loop cursor or discard page merely because data is incomplete',async()=>{
 const f=fixture({first:{items:[offer],nextCursor:'first'}});
 await collectSourcePage(f.state,f.options);await collectSourcePage(f.state,f.options);await collectSourcePage(f.state,f.options);
 assert.equal(f.state.stopReason,'cursor_loop');assert.equal(f.state.seen.size,1);
});
test('blocked listing is not processed',async()=>{
 const f=fixture({first:{items:[offer],health:{blocked:true}}});
 await collectSourcePage(f.state,f.options);assert.equal(f.rows.length,0);assert.equal(f.state.stopReason,'blocked');
});
test('a transient list timeout retries the same cursor without replaying stored rows',async()=>{
 const f=fixture({first:{items:[offer]}});const fetch=f.state.source.fetchPage;let calls=0;
 f.state.source.fetchPage=async c=>{if(++calls===1)throw Error('source_timeout');return fetch(c)};
 await collectSourcePage(f.state,f.options);assert.equal(f.state.done,false);
 await collectSourcePage(f.state,f.options);assert.equal(f.state.seen.size,1);assert.equal(f.state.listFailures,1);
});
test('a source-declared transient HTTP 202 shell retries the same cursor',async()=>{
 const f=fixture({first:{items:[offer]}});const fetch=f.state.source.fetchPage;let calls=0;
 f.state.source.fetchPage=async c=>{if(++calls===1)throw Error('carswitch_exact_transient_status_202_bytes_2063');return fetch(c)};
 await collectSourcePage(f.state,f.options);
 assert.equal(f.state.done,false);assert.equal(f.state.stopReason,'retry_pending');assert.equal(f.state.cursor,null);
 await collectSourcePage(f.state,f.options);
 assert.equal(f.state.seen.size,1);assert.equal(f.state.listFailures,1);assert.equal(calls,2);
});
test('a Yandex bridge non-JSON 5xx response retries the same cursor',async()=>{
 const f=fixture({first:{items:[offer]}});const fetch=f.state.source.fetchPage;let calls=0;
 f.state.source.fetchPage=async c=>{if(++calls===1)throw Error('yandex_bridge_non_json_500_autopapa_105');return fetch(c)};
 await collectSourcePage(f.state,f.options);
 assert.equal(f.state.done,false);assert.equal(f.state.stopReason,'retry_pending');assert.equal(f.state.cursor,null);
 await collectSourcePage(f.state,f.options);
 assert.equal(f.state.seen.size,1);assert.equal(f.state.listFailures,1);assert.equal(calls,2);
});
test('access denial is never retried as a transient timeout',async()=>{
 const f=fixture({});let calls=0;f.state.source.fetchPage=async()=>{calls++;throw Error('http_403')};
 await collectSourcePage(f.state,f.options);await collectSourcePage(f.state,f.options);
 assert.equal(calls,1);assert.equal(f.state.stopReason,'blocked');
});


test('transient retries back off, keep the cursor and stop after three failures',async()=>{
 const f=fixture({});let calls=0;
 f.state.cursor='10';f.state.source.fetchPage=async cursor=>{assert.equal(cursor,'10');calls++;throw Error('http_503')};
 for(let i=0;i<4;i++)await collectSourcePage(f.state,f.options);
 assert.equal(calls,3);assert.deepEqual(f.delays,[1000,2000]);
 assert.equal(f.state.stopReason,'list_failed');assert.equal(f.state.cursor,'10');assert.equal(f.rows.length,0);
});
test('access refusals and deterministic errors never enter retry backoff',async()=>{
 for(const message of ['http_403','http_429','invalid_source_payload']){
  const f=fixture({});f.state.source.fetchPage=async()=>{throw Error(message)};
  await collectSourcePage(f.state,f.options);assert.deepEqual(f.delays,[]);assert.equal(f.state.done,true);
 }
});
test('retry waits cannot overrun the remaining collection budget',async t=>{
 let clock=Date.parse('2026-09-29T05:00:00Z');t.mock.method(Date,'now',()=>clock);
 const f=fixture({});f.options.deadline=clock+50;
 f.state.source.fetchPage=async()=>{throw Error('timeout')};
 f.options.waitForRetry=async ms=>{assert.equal(ms,50);clock+=ms;};
 await collectSourcePage(f.state,f.options);assert.equal(f.state.cursor,null);assert.equal(f.rows.length,0);
 assert.equal(f.state.done,true);assert.equal(f.state.stopReason,'time_budget');
});

test('disk reserve stops before requesting another page and preserves the cursor',async()=>{
 const f=fixture({first:{items:[offer],nextCursor:'second'}});
 await collectSourcePage(f.state,f.options);
 f.options.hasDiskRoom=async()=>false;
 f.state.source.fetchPage=async()=>{throw Error('must not request when disk is low');};
 await collectSourcePage(f.state,f.options);
 assert.equal(f.state.stopReason,'disk_budget');assert.equal(f.state.cursor,'second');assert.equal(f.rows.length,2);
});
test('unexpected source failure does not terminate another source',async()=>{
 const {collectSourceStates}=await import('../scripts/lib/catalog-source-intake.mjs');
 const one=fixture({}),two=fixture({});
 await collectSourceStates([one.state,two.state],()=>one.options,async state=>{if(state===one.state)throw Error('source crashed');state.done=true;state.stopReason='source_finished';});
 assert.equal(one.state.stopReason,'collector_error');assert.equal(two.state.stopReason,'source_finished');
});

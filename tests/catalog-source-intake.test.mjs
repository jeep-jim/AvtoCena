import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSourcePage,intakeState} from '../scripts/lib/catalog-source-intake.mjs';
function fixture(pages,detail=async()=>[]) {
 const source={sourceId:'test',fetchPage:async c=>pages[c || 'first'],normalizeOffer:r=>r,fetchImages:detail};
 const state=intakeState(source,{sourceId:'test'}),rows=[];
 const options={market:'china',deadline:Date.now()+10000,maxRows:100,maxPages:10,minYear:2020,
 snapshot:(o,stage)=>({offer:structuredClone(o),stage}),writeObservation:async r=>rows.push(r),checkpoint:async()=>{}};
 return {state,rows,options};
}
const offer={id:'one',sourceId:'test',market:'china',year:2024,status:'active',sourcePrice:10000,powerHp:undefined};
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
test('access denial is never retried as a transient timeout',async()=>{
 const f=fixture({});let calls=0;f.state.source.fetchPage=async()=>{calls++;throw Error('http_403')};
 await collectSourcePage(f.state,f.options);await collectSourcePage(f.state,f.options);
 assert.equal(calls,1);assert.equal(f.state.stopReason,'blocked');
});

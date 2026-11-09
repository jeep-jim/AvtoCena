import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOverviewSourceShard as validate,overviewSourceCountsMatchManifest} from '../scripts/lib/catalog-overview-source-validation.mjs';
const good={generationId:'g1',items:[{id:'a',market:'korea'},{id:'b',market:'korea'}]};
test('accepts complete generation-bound market source',()=>assert.equal(validate(good,'g1','korea',2),2));
test('rejects stale, incomplete, mixed and duplicate sources',()=>{
 for(const value of [{...good,generationId:'g0'},{...good,items:good.items.slice(0,1)},
 {...good,items:[good.items[0],{id:'b',market:'china'}]},
 {...good,items:[good.items[0],good.items[0]]},null]) assert.throws(()=>validate(value,'g1','korea',2));
});
test('global overview readiness preserves all source counts including unpublished Japan rows',()=>{
 const manifest={markets:{china:{count:2},japan:{count:3}}};
 const overview={markets:{china:{sourceTotal:2,total:1,items:[{id:'china-a'}]},japan:{sourceTotal:3,total:0,items:[]}}};
 const markets=['china','japan'];
 assert.equal(overviewSourceCountsMatchManifest(overview,manifest,markets),true);
 for(const japan of [undefined,{sourceTotal:0,total:0,items:[]},{sourceTotal:3,total:0},{sourceTotal:3,total:4,items:[]},{sourceTotal:3,total:-1,items:[]}]){
  assert.equal(overviewSourceCountsMatchManifest({markets:{...overview.markets,japan}},manifest,markets),false);
 }
});

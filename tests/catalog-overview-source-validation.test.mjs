import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOverviewSourceShard as validate} from '../scripts/lib/catalog-overview-source-validation.mjs';
const good={generationId:'g1',items:[{id:'a',market:'korea'},{id:'b',market:'korea'}]};
test('accepts complete generation-bound market source',()=>assert.equal(validate(good,'g1','korea',2),2));
test('rejects stale, incomplete, mixed and duplicate sources',()=>{
 for(const value of [{...good,generationId:'g0'},{...good,items:good.items.slice(0,1)},
 {...good,items:[good.items[0],{id:'b',market:'china'}]},
 {...good,items:[good.items[0],good.items[0]]},null]) assert.throws(()=>validate(value,'g1','korea',2));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogPublicCountGuard as guard} from '../scripts/lib/catalog-public-count-guard.mjs';
test('failed refresh cannot replace 17000 listings with 700',()=>{
 assert.equal(guard({encar:17000},{encar:700}).ok,false);
 assert.equal(guard({encar:17000},{encar:16500}).ok,true);
});
test('growth at one source cannot hide loss at another, including small sources',()=>{
 assert.equal(guard({encar:17000,kcar:2000},{encar:19500,kcar:0}).ok,false);
 assert.equal(guard({autopapa:8349,myauto:6},{autopapa:9000,myauto:0}).ok,false);
});
test('only verified withdrawals reduce protected baseline',()=>{
 assert.equal(guard({encar:17000},{encar:700},{encar:16300}).ok,true);
 assert.equal(guard({encar:17000},{encar:700},{encar:100}).ok,false);
 assert.equal(guard({}, {encar:700}).ok,true);
 assert.equal(guard({encar:17000},{},{encar:17000}).ok,false);
});
test('misconfigured ratios fail closed',()=>{
 for(const ratio of [NaN,0.1,Infinity,1.1]) assert.throws(()=>guard({a:100},{a:100},{},ratio));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogPublicCountGuard as guard} from '../scripts/lib/catalog-public-count-guard.mjs';
test('failed refresh cannot replace 17000 listings with 700',()=>{
 assert.equal(guard({encar:17000},{encar:700}).ok,false);
 assert.equal(guard({encar:17000},{encar:16500}).ok,true);
});
test('growth at one source cannot hide loss at another substantial source',()=>{
 assert.equal(guard({encar:17000,kcar:2000},{encar:19500,kcar:0}).ok,false);
 assert.equal(guard({autopapa:8349,myauto:60},{autopapa:9000,myauto:0}).ok,false);
});
test('bounded turnover is accepted only after an authoritative complete source pass',()=>{
 const previous={autoscout_europe_open:10572,mobile_de_open:10842};
 const next={autoscout_europe_open:9099,mobile_de_open:15179};
 assert.equal(guard(previous,next).ok,false);
 const complete=guard(previous,next,{},0.9,{completedSources:new Set(['autoscout_europe_open','mobile_de_open'])});
 assert.equal(complete.ok,true);
 assert.deepEqual(complete.completedSources,['autoscout_europe_open','mobile_de_open']);
 assert.equal(guard(previous,{autoscout_europe_open:5000,mobile_de_open:19278},{},0.9,
   {completedSources:['autoscout_europe_open','mobile_de_open']}).ok,false);
 assert.equal(guard(previous,{autoscout_europe_open:8500,mobile_de_open:9000},{},0.9,
   {completedSources:['autoscout_europe_open','mobile_de_open']}).ok,false);
});
test('only verified withdrawals reduce protected baseline',()=>{
 assert.equal(guard({encar:17000},{encar:700},{encar:16300}).ok,true);
 assert.equal(guard({encar:17000},{encar:700},{encar:100}).ok,false);
 assert.equal(guard({}, {encar:700}).ok,true);
 assert.equal(guard({encar:17000},{},{encar:17000}).ok,false);
});
test('misconfigured ratios fail closed',()=>{
 for(const ratio of [NaN,0.1,Infinity,1.1]) assert.throws(()=>guard({a:100},{a:100},{},ratio));
 for(const ratio of [NaN,0.1,0.91,Infinity]) assert.throws(()=>guard({a:100},{a:100},{},0.9,{completedSourceRatio:ratio}));
});

test('declining optional Autohome does not freeze a healthy growing China market',()=>{
 assert.equal(guard({autohome_used_china_open:17756,autohome_new_china_open:1612},{autohome_used_china_open:24668,autohome_new_china_open:1323}).ok,true);
 assert.equal(guard({autohome_used_china_open:17756,autohome_new_china_open:1612},{autohome_used_china_open:700,autohome_new_china_open:0}).ok,false);
 assert.equal(guard({autopapa:8349,myauto:6},{autopapa:8194,myauto:4}).ok,true);
 assert.equal(guard({autopapa:8349,myauto:6},{autopapa:7888,myauto:0}).ok,true);
 assert.equal(guard({autopapa:8349,myauto:6},{autopapa:700,myauto:0}).ok,false);
});

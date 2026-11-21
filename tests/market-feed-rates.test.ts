import test from 'node:test';
import assert from 'node:assert/strict';
import {bindFeedRates} from '../scripts/lib/market-feed-rates.mjs';
import {frozenConversion,installFeedRates} from '../apps/web/lib/catalog/feed-rate-snapshot';
test('collection and later publication use the first stored exchange rate for that exact market and run',async()=>{
 const db=new Map();let captures=0;
 const storage={readJson:async(k:string,f:any)=>db.get(k)??f,writeJson:async(k:string,v:any,o:any)=>{assert.deepEqual(o,{ifNoneMatch:'*'});db.set(k,v);}};
 const capture=async()=>{captures++;return ['RUB','EUR','USD','KRW'].map(c=>[c,{currency:c,effectiveRate:c==='KRW'?0.06:1,rateSource:'cbr',rateDate:'2026-11-21',sourcePrice:1,sourcePriceRub:0}]);};
 const opts={runId:'123',storage,capture,install:installFeedRates};
 const first=await bindFeedRates('korea','capture',opts);
 assert.deepEqual(await bindFeedRates('korea','capture',opts),first);
 assert.deepEqual(await bindFeedRates('korea','read',opts),first);
 assert.equal(captures,1);assert.equal(frozenConversion(1000,'KRW')?.sourcePriceRub,60);
 assert.equal(frozenConversion(1000,'GEL'),null);
 await assert.rejects(bindFeedRates('korea','read',{...opts,runId:'456'}),/missing/);
 await assert.rejects(bindFeedRates('japan','capture',opts),/scope/);
});

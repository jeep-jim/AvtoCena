import test from 'node:test';
import assert from 'node:assert/strict';
import {yandexJsonRequest} from '../scripts/lib/yandex-json-request.mjs';
const url='https://operation.api.cloud.yandex.net/operations/test';
test('a transient network failure does not abort a long registry inventory',async()=>{let calls=0;const result=await yandexJsonRequest(url,{pause:async()=>{},fetchImpl:async()=>{if(++calls===1)throw new TypeError('fetch failed');return Response.json({done:true});}});assert.equal(calls,2);assert.equal(result.done,true);});
test('access denials and uncertain mutations are never retried',async()=>{for(const method of ['GET','DELETE']){let calls=0;await assert.rejects(()=>yandexJsonRequest(url,{method,pause:async()=>{},fetchImpl:async()=>{calls++;if(method==='DELETE')throw new TypeError('fetch failed');return new Response('',{status:403});}}));assert.equal(calls,1);}});
test('rate-limit delay is respected and sustained outages are bounded',async()=>{let calls=0;const waits=[];await assert.rejects(()=>yandexJsonRequest(url,{pause:async ms=>waits.push(ms),fetchImpl:async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'2'}});}}));assert.equal(calls,5);assert.deepEqual(waits,[2000,2000,2000,2000]);});

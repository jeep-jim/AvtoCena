import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSourceAccess,optionalSourceDetailFailure} from '../apps/web/lib/catalog/source-access-refusal';
import {DubicarsCurrentAdapter} from '../apps/web/lib/catalog/dubicars-current-source';
import {MyAutoListAdapter} from '../apps/web/lib/catalog/myauto-list-source';
test('denials and HTTP 200 challenge pages propagate through optional detail fallbacks',()=>{
 for(const [status,body] of [[401,''],[403,''],[429,''],[200,'<title>Just a moment</title>'],[404,'has_been_cr_blocked_AWS.html']] as const) {
  assert.throws(()=>{try{assertSourceAccess(status,body);}catch(error){optionalSourceDetailFailure(error);}},/access_blocked/);
 }
 assert.equal(optionalSourceDetailFailure(new Error('timeout')),null);
 assert.doesNotThrow(()=>assertSourceAccess(404,'not found'));
});
test('MyAuto denied listing stops before trying alternate routes',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return new Response('denied',{status:403});};
 try{await assert.rejects(new MyAutoListAdapter().fetchPage(null),/access_blocked_http_403/);assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
test('DubiCars detail denial aborts the page instead of silently dropping every car',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return calls===1?new Response('<a href="https://www.dubicars.com/2024-toyota-yaris-123456.html">car</a>',{status:200}):new Response('denied',{status:403});};
 try{await assert.rejects(new DubicarsCurrentAdapter().fetchPage(null),/access_blocked_http_403/);assert.equal(calls,2);}finally{globalThis.fetch=original;}
});

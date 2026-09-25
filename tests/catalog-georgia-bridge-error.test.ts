import test from 'node:test';
import assert from 'node:assert/strict';
import {GET} from '../apps/web/app/api/internal/georgia-recovery-e2f913/route';

test('Georgia bridge preserves a source refusal as JSON and does not retry it',async()=>{
 const original=globalThis.fetch;let requests=0;
 globalThis.fetch=(async()=>{requests++;return new Response('Access denied',{status:403});}) as typeof fetch;
 try{
  const response=await GET(new Request('https://avtocena.com/api/internal/georgia-recovery-e2f913?source=myauto&pages=1'));
  const body=await response.json();
  assert.equal(response.status,503);assert.equal(body.blocked,true);
  assert.equal(body.causeCode,'georgia_source_access_refused');
  assert.equal(requests,1);assert.deepEqual(body.offers,[]);
 }finally{globalThis.fetch=original;}
});

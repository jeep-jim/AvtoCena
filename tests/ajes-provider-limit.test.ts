import test from 'node:test';
import assert from 'node:assert/strict';
import {ajesRefusalCode} from '../apps/web/lib/catalog/ajes-refusal';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
test('short ban/limit refusals use visitor cooldown across budget and continuation queries',async()=>{
 let calls=0;const diagnostics:any[]=[];
 const client=createAjesClient({password:()=> 'private-fixture',assertEnabled:async()=>{},reserve:async()=>{},saveRequestFailure:async value=>{diagnostics.push(value);},fetcher:async()=>{calls++;return new Response('request limit: ban private-fixture');}});
 for(const query of [{table:'korea',sourcePriceTo:25000000},{table:'korea',page:2},{table:'stats'}])await assert.rejects(client.read(query,'203.0.113.1'),/visitor_restricted/);
 assert.equal(calls,1,'a supplier refusal must stop requests across filters and markets for this visitor');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(diagnostics.length,1);assert.equal(diagnostics[0].providerCode,'ban_limit');assert.equal(diagnostics[0].httpStatus,200);
 assert.equal(JSON.stringify(diagnostics).includes('private-fixture'),false);
});
test('refusal detection never promotes JSON, HTML or malformed non-refusals',()=>{
 for(const text of ['[{"MODEL_NAME":"ban limit"}]','{"error":"ban limit"}','<html>ban limit</html>','random error','x'.repeat(257)+' ban limit'])assert.equal(ajesRefusalCode(text),null);
 assert.equal(ajesRefusalCode('\uFEFF bot2 credential'),'bot2');
 assert.equal(ajesRefusalCode('ban2 credential'),'ban2');
});

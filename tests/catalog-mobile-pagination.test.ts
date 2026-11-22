import test from 'node:test';
import assert from 'node:assert/strict';
import {MobileDeExactAdapter} from '../apps/web/lib/catalog/mobile-de-exact-source';

test('disabled mobile.de refuses initial and continued pagination before any network request',async()=>{
 const original=globalThis.fetch;
 let requests=0;
 globalThis.fetch=async()=>{requests++;throw new Error('unexpected_mobile_de_request');};
 try{
  const adapter=new MobileDeExactAdapter();
  for(const cursor of [null,JSON.stringify({shard:0,page:25}),JSON.stringify({shard:0,page:100}),JSON.stringify({shard:1,page:1})]){
   await assert.rejects(adapter.fetchPage(cursor),{
    name:'CollectionDisabledError',message:'collection_disabled_by_owner:mobile_de_open',
   });
  }
  assert.equal(requests,0);
 }finally{globalThis.fetch=original;}
});

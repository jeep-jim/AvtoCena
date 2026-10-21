import test from 'node:test';
import assert from 'node:assert/strict';
import {MobileDeExactAdapter} from '../apps/web/lib/catalog/mobile-de-exact-source';

test('mobile.de follows advertised pages beyond 25 and prioritizes low-power years',async()=>{
 const original=globalThis.fetch;
 const requested:URL[]=[];
 let numPages=100;
 globalThis.fetch=(async input=>{
  const api=new URL(String(input));requested.push(new URL(api.searchParams.get('url')!));
  return new Response(JSON.stringify({searchResults:{items:[],numPages,numResultsTotal:2000}}),{status:200,headers:{'content-type':'application/json'}});
 }) as typeof fetch;
 try{
  const adapter=new MobileDeExactAdapter();
  const next=await adapter.fetchPage(JSON.stringify({shard:0,page:25}));
  assert.deepEqual(JSON.parse(next.nextCursor!),{shard:0,page:26});assert.equal(next.finished,false);
  const end=await adapter.fetchPage(JSON.stringify({shard:0,page:100}));
  assert.deepEqual(JSON.parse(end.nextCursor!),{shard:1,page:1});
  await adapter.fetchPage(end.nextCursor);
  assert.equal(requested.at(-1)!.searchParams.get('pw'),'1:85');
  const year=new Date().getUTCFullYear()-1;
  assert.equal(requested.at(-1)!.searchParams.get('fr'),`${year}:${year}`);
  numPages=-1;
  await assert.rejects(adapter.fetchPage(null),/invalid_page_count/);
 }finally{globalThis.fetch=original;}
});

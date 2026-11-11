import test from 'node:test';
import assert from 'node:assert/strict';
import {RevalidatedJson} from '../apps/web/lib/catalog/revalidated-json';
import type {JsonStorage} from '../apps/web/lib/data';

test('unchanged inputs reuse parsed identity; changed, missing and unversioned inputs are reread',async()=>{
 let value:any={revision:1},etag:string|undefined='one',found=true,gets=0,heads=0;
 const storage={readObjectMetadata:async()=>{heads++;return {found,etag};},readJsonWithMeta:async()=>{gets++;return {found,etag,value:found?value:null};}} as unknown as JsonStorage;
 const cache=new RevalidatedJson<any>(1024);
 assert.equal(await cache.read(storage,'first',null),value);
 assert.equal(await cache.read(storage,'first',null),value);assert.equal(gets,1);assert.equal(heads,1);
 value={revision:2};etag='two';assert.equal(await cache.read(storage,'first',null),value);assert.equal(gets,2);
 await cache.read(storage,'second',null);assert.equal(gets,3,'generation path cannot share retained data');
 found=false;assert.equal(await cache.read(storage,'second',null),null);assert.equal(gets,3);
 found=true;etag=undefined;await cache.read(storage,'second',null);await cache.read(storage,'second',null);assert.equal(gets,5);
});

test('failed freshness checks do not return stale data; oversized inputs and different stores are not reused',async()=>{
 let gets=0;
 const storage={readObjectMetadata:async()=>{throw Error('unavailable');},readJsonWithMeta:async()=>{gets++;return {found:true,etag:'one',value:{ok:true}};}} as unknown as JsonStorage;
 const cache=new RevalidatedJson<any>(1024);await cache.read(storage,'x',null);
 await assert.rejects(cache.read(storage,'x',null),/unavailable/);assert.equal(gets,1);
 const other={...storage} as JsonStorage;await cache.read(other,'x',null);assert.equal(gets,2);
 const small=new RevalidatedJson<any>(1);await small.read(storage,'x',null);await small.read(storage,'x',null);assert.equal(gets,4);
});

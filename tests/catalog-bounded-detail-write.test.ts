import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedDetailShards,writeBoundedDetailShards,detailShardPath} from '../apps/web/lib/catalog/detail-shards';
test('bounded compaction preserves all shards and clears empty mutable roots',async()=>{
 const rows=Array.from({length:3000},(_,i)=>({id:String(i),raw:'private',value:i}));
 const expected=boundedDetailShards(rows,5),writes=new Map<string,any>();
 let active=0,maxActive=0,compacted=0,peak=0,rootsStarted=false;
 await writeBoundedDetailShards('g1',rows,row=>{compacted++;peak=Math.max(peak,compacted);return {id:row.id,value:row.value};},async(path,value)=>{
  const isRoot=path.startsWith('catalog/public/');
  if(isRoot)rootsStarted=true;else assert.equal(rootsStarted,false);
  active++;maxActive=Math.max(maxActive,active);
  await new Promise(resolve=>setImmediate(resolve));
  writes.set(path,value);compacted-=value.items.length;active--;
 },5,4);
 assert.ok(maxActive<=4);assert.ok(peak<=20);
 for(const [prefix,shard] of expected){const actual=writes.get(detailShardPath('g1',prefix));assert.deepEqual(actual,{generationId:'g1',...shard,items:shard.items.map(({id,value})=>({id,value}))});}
 assert.equal([...writes.keys()].filter(p=>p.startsWith('catalog/public/')).length,256);
 assert.equal([...writes.values()].flatMap(x=>x.items).length,3000);
 assert.ok(rows.every(row=>row.raw==='private'));
});
test('child failure cannot advertise new roots',async()=>{
 const rows=Array.from({length:1000},(_,i)=>({id:String(i)}));const writes:string[]=[];
 await assert.rejects(writeBoundedDetailShards('g1',rows,x=>x,async(path)=>{writes.push(path);throw Error('disk_failure');},1,1),/disk_failure/);
 assert.ok(writes.every(path=>!path.startsWith('catalog/public/')));
});

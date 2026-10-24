import assert from 'node:assert/strict';
import test from 'node:test';
import {createDetailSpool} from '../apps/web/lib/catalog/detail-spool';
import {boundedDetailShards,detailHash,detailShardPath} from '../apps/web/lib/catalog/detail-shards';

test('disk-spooled chunks publish exactly the same bounded details and clear empty roots',async()=>{
 const rows:Array<{id:string;payload:string}>=[];
 for(let i=0;rows.length<15;i++)if(detailHash(`spool-${i}`).startsWith('ab'))rows.push({id:`spool-${i}`,payload:`payload-${i}`});
 rows.push({id:'other-root',payload:'unchanged'});
 const spool=await createDetailSpool<(typeof rows)[number]>(4),writes=new Map<string,any>(),order:string[]=[];
 try {
  await spool.append(rows.slice(0,7));await spool.append(rows.slice(7));
  const count=await spool.publish('g',async(key,value)=>{writes.set(key,value);order.push(key);});
  const expected=boundedDetailShards(rows,4);
  assert.equal(count,expected.size);
  for(const [prefix,shard]of expected)assert.deepEqual(writes.get(detailShardPath('g',prefix)),{generationId:'g',...shard});
  assert.equal([...writes.keys()].filter(k=>k.startsWith('catalog/public/offers/')).length,256);
  for(const prefix of expected.keys())if(prefix.length>2)assert.ok(order.indexOf(detailShardPath('g',prefix))<order.indexOf(detailShardPath('g',prefix.slice(0,2))));
  assert.deepEqual([...writes.values()].flatMap(v=>v.items).sort((a,b)=>a.id.localeCompare(b.id)),[...rows].sort((a,b)=>a.id.localeCompare(b.id)));
 }finally{await spool.close();}
});

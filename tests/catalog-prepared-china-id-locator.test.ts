import test from 'node:test';
import assert from 'node:assert/strict';
import {detailHash} from '../apps/web/lib/catalog/detail-shards';
import {createDetailSpool} from '../apps/web/lib/catalog/detail-spool';
import {createPreparedChinaIdShardWriter,readPreparedChinaIdLocation,type PreparedChinaIdLocation} from '../apps/web/lib/catalog/prepared-china-id-locator';

const generation='gen_1795190399000_fixture',nextGeneration='gen_1795190399001_other';
const at=(id:string,part:number):PreparedChinaIdLocation=>({id,chunk:'chunk-0001',part,offset:0});
function idsWithSameRoot(){
 const groups=new Map<string,string[]>();
 for(let n=0;n<10_000;n++){
  const id='loc-'+n,prefix=detailHash(id).slice(0,2);
  const list=groups.get(prefix)||[];
  list.push(id);groups.set(prefix,list);
  if(list.length===3&&new Set(list.map(i=>detailHash(i).slice(0,3))).size===3)return list;
  if(list.length===3)groups.delete(prefix);
 }
 throw Error('fixture ids unavailable');
}

test('prepared China key lookup follows one authenticated branch and never reads a sibling',async()=>{
 const rows=idsWithSameRoot().map(at);
 const spool=await createDetailSpool<PreparedChinaIdLocation>(1,{maxBucketBytes:4096});
 const created=new Map<string,Buffer>(),traced:string[]=[];
 const writer=createPreparedChinaIdShardWriter(generation,async(key,body)=>{created.set(key,body);});
 try{
  for(const row of rows)await spool.append([row]);
  await spool.publishShards(writer.write,true);
  const roots=writer.finish(rows.length);
  assert.equal(created.size,4);
  assert.equal(roots.filter(Boolean).length,1);
  assert.ok([...created.keys()].every(key=>key.startsWith(`catalog/generations/${generation}/indexes/prepared-china-read-v1/ids/`)));
  const read=async(key:string)=>{traced.push(key);const body=created.get(key);if(!body)throw Error('missing_exact_key');return body;};
  assert.deepEqual(await readPreparedChinaIdLocation(generation,roots,rows[1].id,read),rows[1]);
  assert.equal(traced.length,2);
  assert.ok(traced.at(-1)!.includes('/'+detailHash(rows[1].id).slice(0,3)+'-'));
  assert.ok(!traced.some(key=>key.includes('/'+detailHash(rows[0].id).slice(0,3)+'-')));
  const exact=[...traced];traced.length=0;
  const siblingMissing=rows[0].id+'-other';
  const different=await readPreparedChinaIdLocation(generation,roots,siblingMissing,read);
  assert.equal(different,null);
  const leaf=exact[1],old=created.get(leaf)!;
  created.set(leaf,Buffer.from(old.toString('utf8').replace(rows[1].id,rows[0].id)));
  await assert.rejects(readPreparedChinaIdLocation(generation,roots,rows[1].id,read),/locator:bytes/);
  created.set(leaf,old);
  await assert.rejects(readPreparedChinaIdLocation(nextGeneration,roots,rows[1].id,read),/missing_exact_key/);
 }finally{await spool.close();}
});

test('prepared locator spool fails instead of retaining an overlarge bucket or sealing a duplicate',async()=>{
 const row=at('fixture-key',0),overflow=await createDetailSpool<PreparedChinaIdLocation>(256,{maxBucketBytes:50});
 try{await assert.rejects(overflow.append([row]),/detail_spool_bucket_too_large/);}finally{await overflow.close();}
 const spool=await createDetailSpool<PreparedChinaIdLocation>();
 const writer=createPreparedChinaIdShardWriter(generation,async()=>{throw Error('unexpected_write');});
 try{
  await spool.append([row,row]);
  await assert.rejects(spool.publishShards(writer.write,true),/locator:leaf/);
  assert.throws(()=>writer.finish(2),/coverage/);
 }finally{await spool.close();}
});

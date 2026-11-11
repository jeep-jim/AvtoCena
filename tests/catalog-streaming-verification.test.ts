import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {verifyCatalogReadModels} from '../apps/web/lib/catalog/verify-read-models';
import {catalogProjectionBatches} from '../apps/web/lib/catalog-projection-parts';
import {boundedDetailShards,detailShardPath} from '../apps/web/lib/catalog/detail-shards';
function fixture(){
 const rows=Array.from({length:2501},(_,i)=>({id:'offer-'+i,market:i%2?'china':'europe'}));
 const objects=new Map<string,any>();const generationId='gen_1_test';const parts=[];
 for(let i=0;i<rows.length;i+=1000){const part={items:rows.slice(i,i+1000)},sha256=crypto.createHash('sha256').update(JSON.stringify(part)).digest('hex'),path=`catalog/generations/${generationId}/indexes/projection-parts/all/${parts.length}-${sha256}.json`;objects.set(path,part);parts.push({path,count:part.items.length,sha256});}
 const directory={storageFormat:'catalog-projection-parts-v1',generationId,count:rows.length,parts};objects.set('catalog/public/projection/all.json',directory);
 for(const market of ['china','europe'])objects.set(`catalog/public/projection/${market}.json`,{generationId,items:rows.filter(r=>r.market===market)});
 for(const [prefix,shard]of boundedDetailShards(rows))objects.set(detailShardPath(generationId,prefix),structuredClone({generationId,...shard}));
 const storage:any={readJson:async(key:string)=>structuredClone(objects.get(key)),getBinary:async(key:string)=>({data:Buffer.from(JSON.stringify(objects.get(key)))})};
 return {rows,objects,storage,generationId,directory};
}
test('stream verifier checks every ID and rejects missing, duplicate and wrong-generation projections',async()=>{
 const f=fixture();assert.equal((await verifyCatalogReadModels(f.storage,f.generationId,f.rows)).offers,2501);
 const key='catalog/public/projection/china.json',original=structuredClone(f.objects.get(key));
 for(const broken of [{...original,generationId:'other'},{...original,items:original.items.slice(1)},{...original,items:[original.items[0],...original.items.slice(0,-1)]}]){f.objects.set(key,broken);await assert.rejects(verifyCatalogReadModels(f.storage,f.generationId,f.rows),/projection_/);}
});
test('stream verifier rejects altered details and calls content verifier for every row',async()=>{
 const f=fixture();let count=0;await verifyCatalogReadModels(f.storage,f.generationId,f.rows,()=>{},()=>{count++;});assert.equal(count,f.rows.length);
 const key=[...f.objects.keys()].find(k=>k.startsWith('catalog/public/offers/'))!;f.objects.get(key).items[0].id='foreign';await assert.rejects(verifyCatalogReadModels(f.storage,f.generationId,f.rows),/shard_ids/);
});
test('batch reader is lazy and retains the existing integrity checks',async()=>{
 const f=fixture();let reads=0;const read=f.storage.readJson;f.storage.readJson=async(k:string)=>{reads++;return read(k)};
 const iterator=catalogProjectionBatches(f.storage,'catalog/public/projection/all.json',f.directory);assert.equal(reads,0);assert.equal((await iterator.next()).value.items.length,1000);assert.equal(reads,1);await iterator.return(undefined);assert.equal(reads,1);
 const complete=catalogProjectionBatches(f.storage,'catalog/public/projection/all.json',f.directory);
 assert.equal((await complete.next()).value.items.length,1000);assert.equal(reads,2);
 assert.equal((await complete.next()).value.items.length,1000);assert.equal(reads,3);
 assert.equal((await complete.next()).value.items.length,501);assert.equal(reads,4);
 assert.equal((await complete.next()).done,true);assert.equal(reads,4);
 f.objects.get(f.directory.parts[0].path).items[0].id='changed';await assert.rejects(async()=>{for await(const _ of catalogProjectionBatches(f.storage,'catalog/public/projection/all.json',f.directory)){}},/integrity_failed/);
});

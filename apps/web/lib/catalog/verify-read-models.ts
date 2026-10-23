import type {JsonStorage} from '../data';
import {catalogProjectionBatches} from '../catalog-projection-parts';
import {boundedDetailShards,detailShardPath,type DetailShard} from './detail-shards';
export async function verifyCatalogReadModels(storage:JsonStorage,generationId:string,rows:{id:string;market:string}[],progress:(stage:string,count:number)=>void=()=>{},verifyDetail?:(row:any)=>void){
  const expected=new Map(rows.map(row=>[row.id,row.market]));
  if(expected.size!==rows.length)throw Error('catalog_verification_duplicate_expected');
  const markets=[...new Set(rows.map(row=>row.market))];
  for(const scope of ['all',...markets]){
    const key=`catalog/public/projection/${scope}.json`;
    if(!storage.getBinary)throw Error('catalog_verification_raw_read_required');
    const raw=JSON.parse((await storage.getBinary(key)).data.toString('utf8'));
    const seen=new Set<string>();
    for await(const batch of catalogProjectionBatches(storage,key,raw)){
      if(batch.generationId!==generationId)throw Error('catalog_current_projection_generation_mismatch:'+scope);
      for(const row of batch.items){
        if(!expected.has(row.id) || expected.get(row.id)!==row.market || (scope!=='all' && row.market!==scope) || seen.has(row.id))throw Error('catalog_current_projection_id_mismatch:'+scope);
        seen.add(row.id);
      }
      progress('projection_'+scope,seen.size);
    }
    const count=scope==='all'?rows.length:rows.filter(row=>row.market===scope).length;
    if(seen.size!==count)throw Error('catalog_current_projection_count_mismatch:'+scope);
  }
  const shards=[...boundedDetailShards(rows,500).entries()];let cursor=0,done=0;
  await Promise.all(Array.from({length:4},async()=>{
    while(cursor<shards.length){
      const [prefix,expected]=shards[cursor++];
      const shard=await storage.readJson<({generationId:string}&DetailShard<any>)|null>(detailShardPath(generationId,prefix),null);
      if(!shard || shard.generationId!==generationId || Boolean(shard.children)!==Boolean(expected.children) || !Array.isArray(shard.items) || shard.items.length!==expected.items.length || shard.items.length>500)throw Error('catalog_current_offer_shard_not_ready:'+prefix);
      const ids=new Set(shard.items.map(row=>row.id));
      if(ids.size!==expected.items.length || expected.items.some(row=>!ids.has(row.id)))throw Error('catalog_current_offer_shard_ids:'+prefix);
      for(const row of shard.items)verifyDetail?.(row);
      done++;if(done%128===0 || done===shards.length)progress('details',done);
    }
  }));
  return {offers:rows.length,detailShards:shards.length};
}

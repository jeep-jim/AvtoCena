import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {boundedDetailShards, detailHash, detailShardPath, type DetailShard} from './detail-shards';

/** Maintenance only: keep complete records on temporary disk, one hash bucket in RAM. */
export async function createDetailSpool<T extends {id:string}>(limit=500,options:{maxBucketBytes?:number}={}) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'avtocena-detail-spool-'));
  const roots=Array.from({length:256},(_,i)=>i.toString(16).padStart(2,'0'));
  const bucketBytes=new Map<string,number>();
  const append=async(rows:T[])=>{
    const groups=new Map<string,string[]>();
    for(const row of rows) {
      const prefix=detailHash(row.id).slice(0,2), lines=groups.get(prefix)||[];
      lines.push(JSON.stringify(row)+'\n');groups.set(prefix,lines);
    }
    // Sequential disk writes also bound serialized copies to the input chunk.
    for(const [prefix,lines] of groups){
      const body=lines.join('');
      if(options.maxBucketBytes!==undefined){
        const bytes=(bucketBytes.get(prefix)||0)+Buffer.byteLength(body);
        if(bytes>options.maxBucketBytes)throw Error('detail_spool_bucket_too_large');
        bucketBytes.set(prefix,bytes);
      }
      await fs.appendFile(path.join(directory,prefix),body);
    }
  };
  const publishShards=async(write:(prefix:string,shard:DetailShard<T>)=>Promise<unknown>,postorder=false)=>{
    let count=0;
    for(const root of roots) {
      let source='';
      try{source=await fs.readFile(path.join(directory,root),'utf8');}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      const rows:T[]=source.split('\n').filter(Boolean).map(line=>JSON.parse(line));
      source='';
      const shards=boundedDetailShards(rows,limit);
      // Legacy children still precede their mutable root. The prepared
      // content-addressed visitor additionally needs each child of a node first.
      const children=[...shards].filter(([prefix])=>prefix.length>2);
      if(postorder)children.sort(([a],[b])=>b.length-a.length);
      for(const [prefix,shard] of children){await write(prefix,shard);count++;}
      await write(root,shards.get(root)||{items:[]});
      if(shards.has(root))count++;
    }
    return count;
  };
  return {
    append,publishShards,
    publish(generationId:string,write:(key:string,value:{generationId:string}&DetailShard<T>)=>Promise<unknown>) {
      return publishShards((prefix,shard)=>write(detailShardPath(generationId,prefix),{generationId,...shard}));
    },
    async close(){await fs.rm(directory,{recursive:true,force:true});},
  };
}

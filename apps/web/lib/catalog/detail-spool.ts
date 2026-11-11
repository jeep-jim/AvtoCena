import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {boundedDetailShards, detailHash, detailShardPath, type DetailShard} from './detail-shards';

/** Maintenance only: keep complete records on temporary disk, one hash bucket in RAM. */
export async function createDetailSpool<T extends {id:string}>(limit=500) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'avtocena-detail-spool-'));
  const roots=Array.from({length:256},(_,i)=>i.toString(16).padStart(2,'0'));
  return {
    async append(rows:T[]) {
      const groups=new Map<string,string[]>();
      for(const row of rows) {
        const prefix=detailHash(row.id).slice(0,2), lines=groups.get(prefix)||[];
        lines.push(JSON.stringify(row)+'\n');groups.set(prefix,lines);
      }
      // Sequential disk writes also bound serialized copies to the input chunk.
      for(const [prefix,lines] of groups)await fs.appendFile(path.join(directory,prefix),lines.join(''));
    },
    async publish(generationId:string,write:(key:string,value:{generationId:string}&DetailShard<T>)=>Promise<unknown>) {
      let count=0;
      for(const root of roots) {
        let source='';
        try{source=await fs.readFile(path.join(directory,root),'utf8');}
        catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
        const rows:T[]=source.split('\n').filter(Boolean).map(line=>JSON.parse(line));
        source='';
        const shards=boundedDetailShards(rows,limit);
        // Children must exist before their mutable root advertises them.
        for(const [prefix,shard] of shards)if(prefix.length>2) {
          await write(detailShardPath(generationId,prefix),{generationId,...shard});count++;
        }
        await write(detailShardPath(generationId,root),{generationId,...(shards.get(root)||{items:[]})});
        if(shards.has(root))count++;
      }
      return count;
    },
    async close(){await fs.rm(directory,{recursive:true,force:true});},
  };
}

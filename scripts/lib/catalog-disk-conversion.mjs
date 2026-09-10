import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {readCheckpointJsonl} from './read-checkpoint-jsonl.mjs';

// Revisions and deduplication live on disk, not in a full-market JS Map.
export async function convertMarketOnDisk({market,directory,files,out,report}) {
  const temporary=await fs.mkdtemp(path.join(out,`.${market}-`));
  const db=new DatabaseSync(path.join(temporary,'observations.sqlite'));
  let total=0;
  try {
    db.exec('PRAGMA cache_size=-16384; PRAGMA temp_store=FILE; CREATE TABLE offers(id TEXT PRIMARY KEY, seq INTEGER, payload TEXT); CREATE INDEX ordering ON offers(seq); BEGIN');
    const insert=db.prepare('INSERT INTO offers VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload');
    let sequence=0;
    for(const file of files.filter(name=>name.endsWith('.jsonl')).sort()) {
      for await(const observation of readCheckpointJsonl(path.join(directory,file))) {
        const offer=observation?.offer;
        if(!offer?.id || offer.market!==market)continue;
        insert.run(String(offer.id),sequence++,JSON.stringify(offer));
        if(sequence%500===0)db.exec('COMMIT; BEGIN');
      }
    }
    db.exec('COMMIT');
    let batch=[],bytes=0,part=0;
    async function flush() {
      const name=`catalog-rebuild-${market}-${String(++part).padStart(4,'0')}.json`;
      const metadata={market,count:batch.length,...(part===1&&report?{report:{...report,sources:report.sources.map(source=>({...source,mode:'live',freshSaved:source.observations||0}))}}:{})};
      await fs.writeFile(path.join(temporary,name),JSON.stringify(metadata).slice(0,-1)+',"offers":['+batch.join(',')+']}');
      total+=batch.length;batch=[];bytes=0;
    }
    for(const row of db.prepare('SELECT payload FROM offers ORDER BY seq').iterate()) {
      const payload=String(row.payload),size=Buffer.byteLength(payload);
      if(batch.length && (batch.length>=500 || bytes+size>8*1024*1024))await flush();
      batch.push(payload);bytes+=size;
    }
    if(batch.length || part===0)await flush();
    const obsolete=(await fs.readdir(out)).filter(name=>name===`catalog-rebuild-${market}.json` || new RegExp(`^catalog-rebuild-${market}-[0-9]+\\.json$`).test(name));
    for(const name of obsolete)await fs.unlink(path.join(out,name));
    for(const name of (await fs.readdir(temporary)).filter(name=>name.endsWith('.json')))await fs.rename(path.join(temporary,name),path.join(out,name));
    return {market,uniqueObservations:total,shards:part,maxRowsPerShard:500,targetBytesPerShard:8*1024*1024};
  } finally {db.close();await fs.rm(temporary,{recursive:true,force:true});}
}

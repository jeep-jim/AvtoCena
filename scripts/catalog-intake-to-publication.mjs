import fs from 'node:fs/promises';
import {readCheckpointJsonl} from './lib/read-checkpoint-jsonl.mjs';
import path from 'node:path';
import {joinJapanInventory} from '../apps/web/lib/catalog/japan-inventory-join.ts';
const root=process.env.CATALOG_INTAKE_INPUT_DIR || 'catalog-intake-input';
const out=process.env.CATALOG_REBUILD_INPUT_DIR || 'catalog-intake-publish';
await fs.mkdir(out,{recursive:true});
for(const market of ['korea','china','uae','europe','georgia','japan']) {
 const directory=path.join(root,`catalog-intake-${market}`);
 let files=[];try{files=await fs.readdir(directory);}catch{continue;}
 const rows=new Map();
 for(const file of files.filter(f=>f.endsWith('.jsonl'))) {
  for await(const observation of readCheckpointJsonl(path.join(directory,file))) {
   const offer=observation?.offer;
   if(offer?.id && offer.market===market)rows.set(offer.id,offer);
  }
 }
 const joined=market==='japan'?joinJapanInventory([...rows.values()]):null;
 const offers=joined?.offers || [...rows.values()];
 if(joined)console.log(JSON.stringify({market,join:joined.report}));
 // The publisher already accepts market shards. Full technical tables can exceed
 // V8's single-string limit when an entire large market is JSON.stringify'd.
 const shardSize=500;
 for(let offset=0;offset<Math.max(offers.length,1);offset+=shardSize) {
  const batch=offers.slice(offset,offset+shardSize);
  const suffix=String(Math.floor(offset/shardSize)+1).padStart(4,'0');
  await fs.writeFile(path.join(out,`catalog-rebuild-${market}-${suffix}.json`),JSON.stringify({market,count:batch.length,offers:batch}));
 }
 console.log(JSON.stringify({market,uniqueObservations:offers.length}));
}

import fs from 'node:fs/promises';
import {readCheckpointJsonl} from './lib/read-checkpoint-jsonl.mjs';
import path from 'node:path';
import {convertMarketOnDisk} from './lib/catalog-disk-conversion.mjs';
import {joinJapanInventory} from '../apps/web/lib/catalog/japan-inventory-join.ts';
const root=process.env.CATALOG_INTAKE_INPUT_DIR || 'catalog-intake-input';
const out=process.env.CATALOG_REBUILD_INPUT_DIR || 'catalog-intake-publish';
await fs.mkdir(out,{recursive:true});
for(const market of ['korea','china','uae','europe','georgia','japan']) {
 const directory=path.join(root,`catalog-intake-${market}`);
 let files=[];try{files=await fs.readdir(directory);}catch{continue;}
 let report;try{report=JSON.parse(await fs.readFile(path.join(directory,"report.json"),"utf8"));}catch{}
 if(market!=='japan') {
  console.log(JSON.stringify(await convertMarketOnDisk({market,directory,files,out,report})));
  continue;
 }
 const rows=new Map();
 for(const file of files.filter(f=>f.endsWith('.jsonl')).sort()) {
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
 const temporary=await fs.mkdtemp(path.join(out,`.${market}-`));
 try {
 for(let offset=0;offset<Math.max(offers.length,1);offset+=shardSize) {
  const batch=offers.slice(offset,offset+shardSize);
  const suffix=String(Math.floor(offset/shardSize)+1).padStart(4,'0');
  await fs.writeFile(path.join(temporary,`catalog-rebuild-${market}-${suffix}.json`),JSON.stringify({market,count:batch.length,offers:batch,...(offset===0&&report?{report:{...report,sources:report.sources.map(source=>({...source,mode:"live",freshSaved:source.observations||0}))}}:{})}));
 }
 // A smaller rerun must not leave old higher-numbered shards in the input.
 const obsolete=(await fs.readdir(out)).filter(name=>name===`catalog-rebuild-${market}.json` || new RegExp(`^catalog-rebuild-${market}-[0-9]+\\.json$`).test(name));
 for(const name of obsolete) await fs.unlink(path.join(out,name));
 for(const name of await fs.readdir(temporary)) await fs.rename(path.join(temporary,name),path.join(out,name));
 } finally { await fs.rm(temporary,{recursive:true,force:true}); }
 console.log(JSON.stringify({market,uniqueObservations:offers.length}));
}

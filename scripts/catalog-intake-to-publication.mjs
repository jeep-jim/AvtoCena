import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
const root=process.env.CATALOG_INTAKE_INPUT_DIR || 'catalog-intake-input';
const out=process.env.CATALOG_REBUILD_INPUT_DIR || 'catalog-intake-publish';
await fs.mkdir(out,{recursive:true});
for(const market of ['korea','china','uae','europe','georgia','japan']) {
 const directory=path.join(root,`catalog-intake-${market}`);
 let files=[];try{files=await fs.readdir(directory);}catch{continue;}
 const rows=new Map();
 for(const file of files.filter(f=>f.endsWith('.jsonl'))) {
  for await(const line of readline.createInterface({input:createReadStream(path.join(directory,file)),crlfDelay:Infinity})) {
   if(!line.trim())continue;
   let observation;try{observation=JSON.parse(line);}catch{throw Error(`invalid_checkpoint_line:${market}:${file}`);}
   const offer=observation?.offer;
   if(offer?.id && offer.market===market)rows.set(offer.id,offer);
  }
 }
 const offers=[...rows.values()];
 await fs.writeFile(path.join(out,`catalog-rebuild-${market}.json`),JSON.stringify({market,count:offers.length,offers}));
 console.log(JSON.stringify({market,uniqueObservations:offers.length}));
}

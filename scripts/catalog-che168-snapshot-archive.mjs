import fs from 'node:fs/promises';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {archiveChe168Snapshot} from './lib/che168-snapshot.mjs';
const config=JSON.parse(await fs.readFile(process.env.CHE168_SNAPSHOT_CONFIG||'data/catalog/che168-snapshot-v1.json','utf8'));
const storage=getJsonStorage();
if(storage.driver!=='object')throw Error('auto_api_durable_storage_required');
let last=0;
await archiveChe168Snapshot({config,storage,password:process.env.AUTO_API_CHE168_KEY,onProgress:progress=>{
  if(Date.now()-last>30000||progress.archivedParts===progress.totalParts){console.log(JSON.stringify(progress));last=Date.now();}
}});
console.log(JSON.stringify({snapshotArchived:true,bytes:config.bytes,initialCursor:config.initialCursor}));

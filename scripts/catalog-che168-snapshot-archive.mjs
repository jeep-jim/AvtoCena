import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls.ts';
import fs from 'node:fs/promises';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {archiveChe168Snapshot,snapshotBinding} from './lib/che168-snapshot.mjs';
import {openRawFeedPin,rawProducerOwner,readRawRootHandoff,writeRawRootHandoff} from './lib/catalog-raw-provenance.mjs';
await assertCollectionEnabled('che168_feed');
const config=JSON.parse(await fs.readFile(process.env.CHE168_SNAPSHOT_CONFIG||'data/catalog/che168-snapshot-v1.json','utf8'));
const storage=getJsonStorage();
if(storage.driver!=='object')throw Error('auto_api_durable_storage_required');
const root=`catalog/provider-snapshots/che168/${snapshotBinding(config)}`,prior=await storage.readJson(root+'/manifest.json',null);
const existing=prior?await readRawRootHandoff(storage,root,prior):null,owner=rawProducerOwner();
const pin=existing?null:await openRawFeedPin({storage,owner,operationId:`che168-archive-${snapshotBinding(config).slice(0,24)}-${owner.runId}-${owner.attempt}`,
  references:[{kind:'che168-snapshot',root}]});
if(!prior)await pin.add([]);
let last=0;
const receipt=await archiveChe168Snapshot({config,storage,fetchImpl:async (...args)=>{await assertCollectionEnabled('che168_feed');return fetch(...args);},password:process.env.AUTO_API_CHE168_KEY,onProgress:progress=>{
  if(Date.now()-last>30000||progress.archivedParts===progress.totalParts){console.log(JSON.stringify(progress));last=Date.now();}
}});
if(pin)await writeRawRootHandoff(storage,root,receipt,await pin.handoff());
console.log(JSON.stringify({snapshotArchived:true,bytes:config.bytes,initialCursor:config.initialCursor}));

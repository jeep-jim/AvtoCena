import fs from 'node:fs/promises';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {openChe168ReplayJournal} from './lib/che168-replay-journal.mjs';

// Private read-only audit: no feed key, source requests, catalog writes or IDs.
const storage=getJsonStorage();
if(storage.driver!=='object')throw Error('auto_api_durable_storage_required');
const artifactRunId=process.env.CHE168_RECOVERY_ARTIFACT_RUN_ID;
if(!/^\d+$/.test(artifactRunId||''))throw Error('auto_api_recovery_artifact_required');
const key=`catalog/intake-working/che168-v1/${artifactRunId}/head.json`;
const meta=await storage.readJsonWithMeta(key,null);
const events={observation:0,quarantine:0,withdrawal:0};
let summary={at:new Date().toISOString(),artifactRunId,durableCheckpointFound:meta.found,publicationNotChecked:true};
// Report the actual catalog separately from processed replay events. A changed
// manifest alone does not attest publication of this particular paid snapshot.
const manifest=await storage.readJson('catalog/manifest.json',null);
if(manifest?.version===2 && Number.isSafeInteger(manifest.markets?.china?.count)){
  summary={...summary,catalogSnapshot:{generationId:manifest.generationId,
    chinaCount:manifest.markets.china.count,chinaUpdatedAt:manifest.markets.china.updatedAt}};
}
if(meta.found){
  // Pin the committed head seen at the start. Later commits may safely happen
  // concurrently because the referenced chunks are immutable.
  const readOnly={readJsonWithMeta:async()=>meta,readJson:storage.readJson.bind(storage),writeJson:async()=>{throw Error('read_only_audit');}};
  const journal=await openChe168ReplayJournal({storage:readOnly,artifactRunId,binding:meta.value?.binding,initialCursor:meta.value?.initialCursor,
    apply:async event=>{if(!Object.hasOwn(events,event?.kind))throw Error('auto_api_invalid_replay_event');events[event.kind]++;}});
  summary={...summary,chainVerified:true,changes:journal.changes,workingCursor:journal.cursor,chunks:meta.value.chunks.length,bytes:meta.value.bytes,events};
}
await fs.writeFile('che168-replay-status.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));

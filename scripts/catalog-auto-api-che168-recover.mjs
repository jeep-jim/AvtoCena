import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls.ts';
await assertCollectionEnabled('che168_feed');
import path from 'node:path';
import fs from 'node:fs/promises';
import {autoApiChe168Client} from './lib/auto-api-che168-client.mjs';
import {recoverLegacyChe168Snapshot} from './lib/auto-api-che168-recovery.mjs';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {openRawFeedPin,rawProducerOwner} from './lib/catalog-raw-provenance.mjs';
import {forkArchivedIntakeForRecovery,retainRecoveryArchive} from './lib/nonjp-intake-recovery-fork.mjs';
let journalStorage=getJsonStorage();
if(journalStorage.driver!=='object')throw Error('auto_api_durable_storage_required');
if(!/^\d+$/.test(process.env.CHE168_RECOVERY_ARTIFACT_RUN_ID||''))throw Error('auto_api_recovery_artifact_required');
const owner=rawProducerOwner();
let directory=path.join(process.env.CATALOG_INTAKE_INPUT_DIR||'catalog-intake-input','catalog-intake-china');
const rawPin=await openRawFeedPin({storage:journalStorage,owner,operationId:`che168-recovery-${owner.runId}-${owner.attempt}`,
  references:[{kind:'che168-journal',root:`catalog/intake-working/che168-v1/${process.env.CHE168_RECOVERY_ARTIFACT_RUN_ID}`}]});
await rawPin.add([]);
const fork=await forkArchivedIntakeForRecovery({storage:journalStorage,directory,market:'china',owner,beforeRead:refs=>rawPin.add(refs)});
if(fork.archivedInput){
  if(!process.env.GITHUB_ENV)throw Error('auto_api_recovery_handoff_required');
  directory=fork.directory;
  process.env.CATALOG_INTAKE_INPUT_DIR=path.dirname(directory);
  await fs.appendFile(process.env.GITHUB_ENV,`CATALOG_INTAKE_INPUT_DIR=${path.dirname(directory)}\n`);
}
journalStorage=rawPin.storage;
const request=autoApiChe168Client({fetchImpl:async (...args)=>{await assertCollectionEnabled('che168_feed');return fetch(...args);},apiKey:process.env.AUTO_API_CHE168_KEY,deadline:Date.now()+120*60000,requestDelayMs:350});
const report=retainRecoveryArchive(await recoverLegacyChe168Snapshot({directory,request,journalStorage,artifactRunId:process.env.CHE168_RECOVERY_ARTIFACT_RUN_ID}),fork.archivedInput);
report.rawStoragePins=[...(report.rawStoragePins||[]),await rawPin.handoff()];
await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report));
console.log(JSON.stringify({recovered:true,catalogPublished:false,durableReplay:true,source:report.sources[0],recovery:report.recovery}));

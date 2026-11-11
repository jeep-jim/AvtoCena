import fs from 'node:fs/promises';
import {getJsonStorage,mutateDataJson} from '../apps/web/lib/data.ts';
import {activateVerifiedGeneration} from './lib/catalog-activate-verified-generation.mjs';
const scope=JSON.parse(await fs.readFile('.github/market-runs/china-staged-activate.json','utf8'));
if(scope.verificationRunId!==39885687828||scope.generationId!=='gen_1792702445675_8c312f85'||scope.validatedRunId!==39840733509)throw Error('activation_scope_invalid');
const proof=JSON.parse(await fs.readFile('recovery-proof/china-staged-verification.json','utf8'));
const storage=getJsonStorage();
for(let attempt=0;;attempt++){
 const lock=await storage.readJson('catalog/import-lock.json',null);
 if(!(Date.parse(lock?.lockedUntil||'')>Date.now()))break;
 if(lock?.operationId!==scope.failedOperationId)throw Error('activation_other_writer_active');
 if(attempt>=40)throw Error('activation_previous_lease_not_expired');
 console.log(JSON.stringify({stage:'waiting_previous_lease',lockedUntil:lock.lockedUntil}));await new Promise(r=>setTimeout(r,15000));
}
const result=await activateVerifiedGeneration(storage,proof,scope);
await fs.writeFile('china-staged-activation.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({stage:'staged_publication_committed',generationId:result.generationId,counts:result.counts,years:result.years,intakeCursorUnchanged:true}));
await storage.writeJson(`catalog/operations/staged-recovery/${result.generationId}.json`,result);
await mutateDataJson('catalog/operations/markets/china.json',{},previous=>({...previous,publicationStatus:'published',publicationError:null,generationId:result.generationId,publishedCount:result.counts.china,lastPublicationSuccess:result.publishedAt,recoveredFromRun:scope.validatedRunId,verificationRunId:scope.verificationRunId,intakeCursorUnchanged:true}));

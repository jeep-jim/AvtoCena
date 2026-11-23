import {getJsonStorage,mutateDataJson} from '../apps/web/lib/data.ts';
import {releaseCancelledRepairLock} from './lib/release-cancelled-repair-lock.mjs';
import fs from 'node:fs/promises';
const runId=process.env.CANCELLED_REPAIR_RUN_ID, expectedOperationId=process.env.CANCELLED_REPAIR_OPERATION_ID;
if(!/^\d+$/.test(runId||''))throw Error('repair_run_id_invalid');
async function github(path) {
  const response=await fetch(`https://api.github.com/repos/jeep-jim/AvtoCena/${path}`,{headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error(`repair_run_verification_http_${response.status}`);
  return response.json();
}
const run=await github(`actions/runs/${runId}`);
const result=await github(`actions/runs/${runId}/jobs?filter=latest&per_page=100`);
if(result.total_count!==result.jobs?.length)throw Error('repair_jobs_incomplete');
let preflight;
if (run.path === '.github/workflows/backfill-budget-count-index.yml') {
  const a=await github('actions/artifacts/14822552451');
  if (a.name!=='budget-index-storage-preflight' || a.expired || a.workflow_run?.id!==run.id ||
      a.workflow_run.head_sha!==run.head_sha || a.digest!=='sha256:7f1f144c869d841d22283841adaa0d1292e9bd594f46451018f7318a6d9e2bc3') throw Error('budget_preflight_artifact_mismatch');
  preflight=JSON.parse(await fs.readFile('budget-lock-proof/catalog-storage-preflight.json','utf8'));
}
console.log(JSON.stringify(await releaseCancelledRepairLock({storage:getJsonStorage(),mutate:mutateDataJson,expectedOperationId,run,jobs:result.jobs,preflight})));

// Copy this reviewed bundle under .github/operations/uae-source-stage-v1/ only
// as a pinned single-attempt isolated REG role job. No workflow is included.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {stage,ARCHIVE_MANIFESTS} from './stage.mjs';
import {ObjectJsonStorage} from '../../../apps/web/lib/data.ts';
import {COLLECTION_CONTROLS_KEY,validateCollectionControls} from '../../../apps/web/lib/catalog/collection-controls.ts';
import {collectionEnabled} from '../../../apps/web/lib/catalog/collection-controls-schema.ts';
const e=process.env, [localDir,releaseSha,calculationVersion]=process.argv.slice(2);
const risk='uae_source_stage_approved_role_required';
assert.ok(process.argv.length===5&&e.GITHUB_REPOSITORY==='jeep-jim/AvtoCena'&&e.GITHUB_REPOSITORY_ID==='1289722938'
  &&e.GITHUB_REF==='refs/heads/main'&&e.GITHUB_RUN_ATTEMPT==='1'
  &&e.GITHUB_WORKFLOW_REF==='jeep-jim/AvtoCena/.github/workflows/uae-source-stage-v1.yml@refs/heads/main'
  &&e.GITHUB_JOB==='stage'&&/^[1-9]\d{8,14}$/.test(e.GITHUB_RUN_ID||'')
  &&/^[a-f0-9]{40}$/.test(e.GITHUB_SHA||'')&&e.GITHUB_SHA===e.UAE_STAGE_EXPECTED_GITHUB_SHA, risk);
assert.ok(e.JSON_STORAGE_DRIVER==='object'&&e.YC_OBJECT_STORAGE_ENDPOINT==='https://s3.regru.cloud'
  &&e.YC_OBJECT_STORAGE_REGION==='us-east-1'&&e.YC_OBJECT_STORAGE_BUCKET==='avtocena-staging-8120751'
  &&e.YC_OBJECT_STORAGE_PREFIX==='migration-staging/full-20261011/'
  &&e.YC_OBJECT_STORAGE_MAX_ATTEMPTS==='1'&&e.YC_OBJECT_STORAGE_REQUEST_TIMEOUT_MS==='8000',risk);
const storage=new ObjectJsonStorage(), root='catalog/operations/uae-source-stage/v1/'+e.GITHUB_RUN_ID+'/attempt-1/';
const canStage=k=>k.startsWith(root)&&/^(?:rows-\d{5}\.jsonl|manifest-[a-f0-9]{64}\.json|sealed-source-evidence\.json)$/.test(k.slice(root.length));
const canRead=k=>canStage(k)||['catalog/manifest.json','catalog/intake-cursors/v1/uae.json',COLLECTION_CONTROLS_KEY,...ARCHIVE_MANIFESTS.map(([name])=>name)].includes(k)
   ||/^catalog\/generations\/gen_[1-9]\d{12}_[a-f0-9]{8}\/offers\/uae\/chunk-\d{4,6}\.json$/.test(k);
const io={
  async read(k,cap){
    assert.ok(canRead(k),'uae_stage_read_path');
    const {data,size}=await storage.getBinary(k);assert.ok(Buffer.isBuffer(data)&&size===data.length&&size>0&&size<=cap,'uae_stage_body_bound');return data;
  },
  async create(k,bytes){
    assert.ok(canStage(k)&&Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=1024*1024,'uae_stage_create_scope');
    await storage.putBinary(k,bytes,k.endsWith('.jsonl')?'application/x-ndjson':'application/json',{ifNoneMatch:'*'});
  },
};
async function getHealth(){
  const r=await fetch('https://avtocena.com/api/health',{redirect:'error',signal:AbortSignal.timeout(8000),headers:{accept:'application/json','cache-control':'no-cache'}});
  assert.ok(r.ok,'uae_live_health');return r.json();
}
async function assertOwner(){
  const data=await io.read(COLLECTION_CONTROLS_KEY,512*1024), controls=validateCollectionControls(JSON.parse(data.toString('utf8')));
  assert.ok(collectionEnabled(controls,'dubicars_feed'),'uae_dubicars_disabled_by_owner');
  // An unrelated market change is not a gate.
  return createHash('sha256').update(JSON.stringify([controls.markets.uae,controls.sources.dubicars_feed])).digest('hex');
}
try {
  const receipt=await stage({io,runId:e.GITHUB_RUN_ID,localDir,expectedHealth:{releaseSha,calculationVersion},getHealth,assertOwner});
  console.log(JSON.stringify(receipt));
} catch(error){
  const reason=error instanceof Error&&/^(?:uae_[a-z0-9_]+|storage_conflict|object_storage_(?:binary|read|head)_[0-9]+)$/.test(error.message)?error.message:'private_stage_failed';
  console.error(JSON.stringify({status:'no_seal_verified',reason}));process.exitCode=1;
}

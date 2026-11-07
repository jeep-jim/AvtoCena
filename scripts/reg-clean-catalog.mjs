import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {planRegRetention,applyExactSelection,fingerprint} from './lib/reg-retention-plan.mjs';
const data=await import('../apps/web/lib/data.ts');
const {getJsonStorage,mutateDataJson}=data.getJsonStorage?data:data.default;
assert.equal(process.env.JSON_STORAGE_DRIVER,'object');
assert.equal(process.env.YC_OBJECT_STORAGE_ENDPOINT,'https://s3.regru.cloud');
assert.equal(process.env.YC_OBJECT_STORAGE_BUCKET,'avtocena-staging-8120751');
assert.equal((process.env.YC_OBJECT_STORAGE_PREFIX||'').replace(/\/+$/,''),'migration-staging/full-20261011');
const marker=JSON.parse(fs.readFileSync('.github/market-runs/reg-retention.json','utf8'));
assert.equal(marker.authorization,'owner-2026-11-07-storage-cleanup');
assert.ok(['plan','apply'].includes(marker.mode));
const apply=marker.mode==='apply',out='reg-retention-report';fs.mkdirSync(out,{recursive:true});
const report={startedAt:new Date().toISOString(),run:process.env.GITHUB_RUN_ID,apply,acknowledged:0,acknowledgedBytes:0,completed:false};
const save=()=>fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));
const storage=getJsonStorage(),lockPath='catalog/import-lock.json',operationId='reg-retention-'+crypto.randomUUID(),ttl=45*60000;
const roots=['catalog/manifest.json','catalog/previous-manifest.json','catalog/internal/manifest.json'];
let locked=false,baseline={};
async function health(){const r=await fetch('https://avtocena.com/api/health',{signal:AbortSignal.timeout(15000)}),h=await r.json();assert.equal(r.status,200);assert.equal(h.ok,true);assert.match(h.releaseSha||'',/^[a-f0-9]{40}$/);return {releaseSha:h.releaseSha,calculationVersion:h.calculationVersion};}
async function fence(){
 if(locked){const lock=await storage.readJson(lockPath,null);assert.equal(lock?.operationId,operationId,'lease_changed');assert.ok(Date.parse(lock.lockedUntil)>Date.now()+60000,'lease_expiring');}
 for(const path of roots){const state=await storage.readJsonWithMeta(path,null,baseline[path]);assert.ok(state.found&&state.etag,'root_unreadable');assert.equal(state.etag,baseline[path].etag,'manifest_changed');}
}
try{
 report.healthBefore=await health();
 const lock=await storage.readJson(lockPath,null);
 assert.ok(!lock?.lockedUntil||Number.isFinite(Date.parse(lock.lockedUntil)),'invalid_writer_lock');
 if(Date.parse(lock?.lockedUntil||'')>Date.now()){report.deferred=true;report.reason='active_catalog_writer';save();console.log(JSON.stringify(report));process.exit(0);}
 if(apply){
  assert.match(marker.expectedPlanDigest||'',/^[a-f0-9]{64}$/,'reviewed_plan_required');
  await mutateDataJson(lockPath,{lockedUntil:''},v=>{if(v?.lockedUntil&&!Number.isFinite(Date.parse(v.lockedUntil)))throw Error('invalid_writer_lock');if(Date.parse(v?.lockedUntil||'')>Date.now())throw Error('active_catalog_writer');return {operationId,operationType:'catalog_storage_maintenance',startedAt:new Date().toISOString(),lockedUntil:new Date(Date.now()+ttl).toISOString()};});locked=true;
 }
 for(const path of roots){baseline[path]=await storage.readJsonWithMeta(path,null);assert.ok(baseline[path].found&&baseline[path].etag,'required_manifest_missing');}
 const extras=[];
 for(const path of ['catalog/public/facets.json','catalog/public/brand-summary.json','catalog/japan-auction-history/manifest.json']){const value=await storage.readJson(path,null);if(value)extras.push(value);}
 const generationObjects=await storage.listObjects('catalog/generations/');
 const internalObjects=await storage.listObjects('catalog/internal/offers/');
 await fence();
 const plan=planRegRetention({generationObjects,internalObjects,publicManifest:baseline[roots[0]].value,previousManifest:baseline[roots[1]].value,internalManifest:baseline[roots[2]].value,extraReferences:extras,maxDeletes:marker.maxDeletes,graceMs:86400000});
 report.plan=plan.summary;report.manifestHashes=Object.fromEntries(roots.map(k=>[k,fingerprint(baseline[k].value)]));
 report.marketCounts=Object.fromEntries(Object.entries(baseline[roots[0]].value.markets).map(([k,v])=>[k,v.count]));
 report.namespaceBeforeBytes=[...generationObjects,...internalObjects].reduce((n,r)=>n+r.size,0);
 fs.writeFileSync(out+'/selection.json',JSON.stringify(plan.selected.map(r=>({key:r.key,size:r.size,lastModified:r.lastModified})),null,2));save();
 if(apply){
  assert.equal(plan.summary.selectionDigest,marker.expectedPlanDigest,'reviewed_selection_changed');
  let batches=0;
  Object.assign(report,await applyExactSelection({selected:plan.selected,batchSize:1000,checkFence:fence,deleteObjects:keys=>storage.deleteObjects(keys),onProgress:async progress=>{
   Object.assign(report,progress);save();batches++;
   if(batches%10===0){const current=await health();assert.deepEqual(current,report.healthBefore,'runtime_changed_during_cleanup');await mutateDataJson(lockPath,{lockedUntil:''},v=>{assert.equal(v?.operationId,operationId,'lease_changed');return {...v,lockedUntil:new Date(Date.now()+ttl).toISOString()};});console.log(JSON.stringify({acknowledged:report.acknowledged,selected:plan.summary.selectedObjects}));}
  }}));
  const remaining=[...await storage.listObjects('catalog/generations/'),...await storage.listObjects('catalog/internal/offers/')],remainingKeys=new Set(remaining.map(r=>r.key));
  assert.ok(plan.selected.every(r=>!remainingKeys.has(r.key)),'delete_readback_failed');
  const selectedKeys=new Set(plan.selected.map(r=>r.key));
  for(const row of [...generationObjects,...internalObjects])if(!selectedKeys.has(row.key))assert.ok(remainingKeys.has(row.key),'retained_object_missing');
  report.namespaceAfterBytes=remaining.reduce((n,r)=>n+r.size,0);
  report.observedNamespaceReductionBytes=report.namespaceBeforeBytes-report.namespaceAfterBytes;
  report.retainedObjectMembershipVerified=true;
 }
 await fence();report.healthAfter=await health();assert.deepEqual(report.healthAfter,report.healthBefore,'runtime_changed');
 report.completed=true;report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify(report));
}catch(error){report.error=String(error.message).slice(0,240);save();console.error('REG_RETENTION_STOP',report.error);process.exitCode=1;}
finally{
 if(locked)try{await mutateDataJson(lockPath,{lockedUntil:''},v=>v?.operationId===operationId?{...v,lockedUntil:'',finishedAt:new Date().toISOString()}:v);}catch{report.lockReleaseFailed=true;save();process.exitCode=1;}
}

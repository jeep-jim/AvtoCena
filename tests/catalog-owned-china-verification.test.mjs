import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyChinaRefresh,recordChinaDownloadReceipt,verifyOwnedChinaDownload} from '../scripts/lib/owned-china-verification.mjs';

const producerSha='a'.repeat(40),owner={runId:'900',attempt:'1',producerSha};
const prefix='catalog/owned-feed/v1/china';
const time='2026-11-22T10:00:00.000Z',end='2026-11-22T10:01:00.000Z';
function fixture(sourceRunId=owner.runId){
 const cut={version:1,market:'china',status:'complete',runId:sourceRunId,startCursor:100,cursor:102,pages:1,rows:2,
  startedAt:time,completedAt:end};
 const data=new Map([
  [`${prefix}/runs/${sourceRunId}/complete.json`,cut],
  [`${prefix}/runs/${sourceRunId}/pages/100.json`,{version:1,cursor:100,receivedAt:time,
   payload:{meta:{cur_change_id:100,next_change_id:102},result:[{id:100,inner_id:'1',change_type:'added'},{id:101,inner_id:'2',change_type:'removed'}]}}],
  [`${prefix}/runs/${sourceRunId}/pages/102.json`,{version:1,cursor:102,receivedAt:end,payload:{meta:{cur_change_id:102},result:[]}}],
  [`catalog/feed-rates/v1/china/${sourceRunId}.json`,{version:1,market:'china',runId:sourceRunId,capturedAt:time,
   rates:Object.fromEntries(['CNY','EUR','USD'].map(code=>[code,{effectiveRate:12,rateSource:'cbr_live'}]))}],
 ]);
 const writes=[];
 const storage={readJson:async(key,fallback)=>structuredClone(data.get(key)??fallback),writeJson:async(key,value,condition)=>{
  assert.deepEqual(condition,{ifNoneMatch:'*'});writes.push(key);
  if(data.has(key)){const error=Error('exists');error.name='StorageConflictError';throw error;}
  data.set(key,structuredClone(value));
 }};
 return {cut,data,storage,writes};
}
function official(){
 const run={id:900,run_attempt:1,head_sha:producerSha,head_branch:'main',path:'.github/workflows/catalog-refresh-china.yml',
  status:'completed',conclusion:'success',event:'schedule',repository:{id:1289722938,full_name:'jeep-jim/AvtoCena'},head_repository:{id:1289722938}};
 const jobs={total_count:2,jobs:[{name:'download',conclusion:'success'},{name:'recover_existing_intake',conclusion:'skipped'}]
  .map(job=>({...job,run_id:run.id,head_sha:producerSha,status:'completed'}))};
 return {run,jobs,event:{...run}};
}

test('source mirror is selected from official completed jobs, never from artifact absence',()=>{
 const {run,jobs,event}=official();assert.equal(classifyChinaRefresh(run,jobs,event),'mirror');
 jobs.jobs[0].conclusion='skipped';jobs.jobs[1].name='recover_existing_intake / publish (china)';jobs.jobs[1].conclusion='failure';
 run.conclusion='failure';run.event='workflow_dispatch';
 assert.equal(classifyChinaRefresh(run,jobs,event),'publication','failed publication still requires its artifact and verification');
 jobs.jobs[1].conclusion='skipped';assert.throws(()=>classifyChinaRefresh(run,jobs,event),/operation_unverified/);
});

test('foreign repositories, changed attempts, pending jobs and incomplete job lists are rejected',()=>{
 for(const damage of [
  f=>{f.run.head_repository.id=12;},f=>{f.event.run_attempt=2;},f=>{f.run.head_branch='other';},
  f=>{f.jobs.total_count=3;},f=>{f.jobs.jobs[0].status='in_progress';},f=>{f.jobs.jobs[0].head_sha='b'.repeat(40);},
 ]){const f=official();damage(f);assert.throws(()=>classifyChinaRefresh(f.run,f.jobs,f.event),/china_verification/);}
});

test('complete same-run mirror verifies all saved pages, terminal cursor and frozen rates without publication claims',async()=>{
 const f=fixture();const result=await verifyOwnedChinaDownload(f.storage,owner);
 assert.equal(result.verified,true);assert.equal(result.publicPublished,false);assert.equal(result.binding,'same_run_complete');
 assert.equal(result.sourceEvents,2);assert.equal(result.pages,1);assert.equal(result.cursor,102);assert.deepEqual(f.writes,[]);
});

test('resumed source has an immutable current-run receipt and cannot be replaced by latest mutable state',async()=>{
 const f=fixture('899');
 await assert.rejects(verifyOwnedChinaDownload(f.storage,owner),/completion/);
 await recordChinaDownloadReceipt(f.storage,f.cut,owner);await recordChinaDownloadReceipt(f.storage,f.cut,owner);
 f.data.set(`${prefix}/source.json`,{runId:'901',status:'fetching'});
 const result=await verifyOwnedChinaDownload(f.storage,owner);
 assert.equal(result.sourceRunId,'899');assert.equal(result.resumedSourceRun,true);assert.equal(result.binding,'invocation_receipt');
 assert.ok(f.writes.every(key=>key===`${prefix}/downloads/900/1.json`));
 await assert.rejects(verifyOwnedChinaDownload(f.storage,{...owner,producerSha:'b'.repeat(40)}),/receipt_identity/);
});

test('missing terminal, incomplete pages, wrong census, changed receipts and missing rates fail closed',async()=>{
 for(const damage of [
  f=>f.data.delete(`${prefix}/runs/900/pages/102.json`),
  f=>{f.data.get(`${prefix}/runs/900/pages/100.json`).payload.meta.next_change_id=103;},
  f=>{f.data.get(`${prefix}/runs/900/complete.json`).rows=3;},
  f=>{f.data.get('catalog/feed-rates/v1/china/900.json').rates.CNY.effectiveRate=0;},
  f=>{f.data.get(`${prefix}/runs/900/complete.json`).status='fetching';},
 ]){const f=fixture();damage(f);await assert.rejects(verifyOwnedChinaDownload(f.storage,owner),/china_/);assert.deepEqual(f.writes,[]);}
 const f=fixture();await recordChinaDownloadReceipt(f.storage,f.cut,owner);
 f.data.get(`${prefix}/runs/900/complete.json`).rows=3;
 await assert.rejects(verifyOwnedChinaDownload(f.storage,owner),/receipt_digest/);
});

test('published-generation verification stays mandatory for recovery, while mirrors require their own verifier',async()=>{
 const {readFile}=await import('node:fs/promises');
 const yaml=await readFile(new URL('../.github/workflows/catalog-che168-verify-publication.yml',import.meta.url),'utf8');
 assert.match(yaml,/ref: \$\{\{ github\.sha \}\}/);
 assert.doesNotMatch(yaml,/ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
 assert.match(yaml,/node --import tsx scripts\/catalog-verify-owned-china\.mjs/);
 assert.match(yaml,/uses: actions\/download-artifact@v4\n\s+if: steps\.operation\.outputs\.mode == 'publication'/);
 assert.match(yaml,/name: Verify active generation and committed feed cursor\n\s+if: steps\.operation\.outputs\.mode == 'publication'/);
 assert.doesNotMatch(yaml,/continue-on-error:\s*true/);
});

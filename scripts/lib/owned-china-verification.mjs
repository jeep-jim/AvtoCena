import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chinaDeltaPrefix,validateChangePage} from './owned-china-delta.mjs';

const id=value=>typeof value==='string'&&/^[1-9]\d{0,19}$/.test(value);
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const completeKey=runId=>`${chinaDeltaPrefix}/runs/${runId}/complete.json`;
const receiptKey=owner=>`${chinaDeltaPrefix}/downloads/${owner.runId}/${owner.attempt}.json`;

function validateOwner(owner){
 assert(id(owner?.runId)&&id(owner?.attempt)&&/^[a-f0-9]{40}$/.test(owner?.producerSha??''),'china_download_owner');
}
function validateComplete(cut){
 assert(cut?.version===1&&cut.market==='china'&&cut.status==='complete'&&id(cut.runId)&&
  integer(cut.startCursor)&&integer(cut.cursor)&&cut.cursor>=cut.startCursor&&integer(cut.pages)&&integer(cut.rows)&&
  Number.isFinite(Date.parse(cut.startedAt))&&Number.isFinite(Date.parse(cut.completedAt))&&
  Date.parse(cut.completedAt)>=Date.parse(cut.startedAt),'china_download_completion');
}

// GitHub's completed-job list distinguishes a source mirror from the optional
// legacy publication. Missing artifacts never turn a publication into a mirror.
export function classifyChinaRefresh(run,jobs,event){
 assert(run?.repository?.id===1289722938&&run.repository.full_name==='jeep-jim/AvtoCena'&&
  run.head_repository?.id===1289722938&&run.head_branch==='main'&&run.path==='.github/workflows/catalog-refresh-china.yml'&&
  run.status==='completed'&&id(String(run.id))&&id(String(run.run_attempt))&&/^[a-f0-9]{40}$/.test(run.head_sha??'')&&
  ['schedule','push','workflow_dispatch'].includes(run.event)&&
  event?.id===run.id&&event.run_attempt===run.run_attempt&&event.head_sha===run.head_sha,'china_verification_run_identity');
 assert(Array.isArray(jobs?.jobs)&&jobs.jobs.length>0&&jobs.total_count===jobs.jobs.length&&
  jobs.jobs.every(job=>job.run_id===run.id&&job.head_sha===run.head_sha&&job.status==='completed'),'china_verification_jobs');
 const download=jobs.jobs.filter(job=>job.name==='download');
 const recovery=jobs.jobs.filter(job=>job.name==='recover_existing_intake'||job.name.startsWith('recover_existing_intake / '));
 assert(download.length===1&&download.length+recovery.length===jobs.jobs.length,'china_verification_job_scope');
 if(download[0].conclusion==='success'&&recovery.every(job=>job.conclusion==='skipped')){
  assert(run.conclusion==='success','china_download_run_failed');return 'mirror';
 }
 assert(download[0].conclusion==='skipped'&&recovery.some(job=>job.name==='recover_existing_intake / publish (china)'&&job.conclusion!=='skipped'),
  'china_refresh_operation_unverified');
 return 'publication';
}

// A download may resume a prior source run. Bind that immutable completed cut
// to the actual successful caller instead of pretending its rows are new.
export async function recordChinaDownloadReceipt(storage,cut,owner){
 validateOwner(owner);validateComplete(cut);
 const saved=await storage.readJson(completeKey(cut.runId),null);
 assert.deepEqual(saved,cut,'china_download_complete_readback');
 const receipt={version:1,kind:'owned_china_download_receipt_v1',...owner,sourceRunId:cut.runId,completeSha256:sha(cut)};
 try{await storage.writeJson(receiptKey(owner),receipt,{ifNoneMatch:'*'});}
 catch(error){if(error?.name!=='StorageConflictError')throw error;}
 assert.deepEqual(await storage.readJson(receiptKey(owner),null),receipt,'china_download_receipt_readback');
 return receipt;
}

export async function verifyOwnedChinaDownload(storage,owner){
 validateOwner(owner);
 const receipt=await storage.readJson(receiptKey(owner),null);
 if(receipt)assert(receipt.version===1&&receipt.kind==='owned_china_download_receipt_v1'&&receipt.runId===owner.runId&&
  receipt.attempt===owner.attempt&&receipt.producerSha===owner.producerSha&&id(receipt.sourceRunId)&&hash(receipt.completeSha256),
  'china_download_receipt_identity');
 // Older downloads have no invocation receipt. Only an exact same-run complete
// object is acceptable; never fall back to the latest mutable source pointer.
 const sourceRunId=receipt?.sourceRunId??owner.runId;
 const cut=await storage.readJson(completeKey(sourceRunId),null);validateComplete(cut);
 assert(cut.runId===sourceRunId&&(!receipt||sha(cut)===receipt.completeSha256),'china_download_receipt_digest');
 let cursor=cut.startCursor,pages=0,rows=0;
 const chain=createHash('sha256');
 while(true){
  assert(pages<=cut.pages,'china_download_page_limit');
  const saved=await storage.readJson(`${chinaDeltaPrefix}/runs/${sourceRunId}/pages/${cursor}.json`,null);
  assert(saved?.version===1&&saved.cursor===cursor&&Number.isFinite(Date.parse(saved.receivedAt))&&
   Date.parse(saved.receivedAt)>=Date.parse(cut.startedAt)&&Date.parse(saved.receivedAt)<=Date.parse(cut.completedAt),
   'china_download_saved_page');
  chain.update(JSON.stringify([cursor,sha(saved)]));
  const next=validateChangePage(saved.payload,cursor);
  if(next===null){assert(cursor===cut.cursor&&saved.receivedAt===cut.completedAt,'china_download_terminal_page');break;}
  assert(next<=cut.cursor,'china_download_cursor_boundary');
  rows+=saved.payload.result.length;pages++;cursor=next;
 }
 assert(pages===cut.pages&&rows===cut.rows,'china_download_census');
 const rates=await storage.readJson(`catalog/feed-rates/v1/china/${sourceRunId}.json`,null);
 assert(rates?.version===1&&rates.market==='china'&&rates.runId===sourceRunId&&Number.isFinite(Date.parse(rates.capturedAt))&&
  Date.parse(rates.capturedAt)<=Date.parse(cut.completedAt)&&['CNY','EUR','USD'].every(code=>
   Number.isFinite(rates.rates?.[code]?.effectiveRate)&&rates.rates[code].effectiveRate>0&&
   ['cbr','cbr_live','moex','atb_akebono'].includes(rates.rates[code].rateSource)),'china_download_frozen_rates');
 assert.deepEqual(await storage.readJson(completeKey(sourceRunId),null),cut,'china_download_completion_changed');
 return {version:1,kind:'owned_china_download_verification_v1',verified:true,mode:'mirror',publicPublished:false,
  ...owner,sourceRunId,resumedSourceRun:sourceRunId!==owner.runId,binding:receipt?'invocation_receipt':'same_run_complete',
  sourceObservedAt:cut.completedAt,startCursor:cut.startCursor,cursor:cut.cursor,pages,sourceEvents:rows,
  completeSha256:sha(cut),pageChainSha256:chain.digest('hex'),rateSnapshotSha256:sha(rates)};
}

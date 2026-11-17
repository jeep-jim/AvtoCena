import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createReadOnlyRawGcS3Transport,rawGcS3SchemaDiagnostic} from './lib/catalog-raw-gc-s3.mjs';
import {RAW_GC_TARGET,RAW_GC_POLICY_KEY} from './lib/catalog-raw-gc.mjs';
import {RAW_COORDINATION_KEY} from './lib/catalog-raw-coordination.mjs';
import {rawDigest} from './lib/catalog-raw-provenance.mjs';

// An already verified, immutable paid snapshot. This acceptance probe does not
// enumerate the bucket, request a supplier, register a root or enable GC.
export const RAW_READONLY_CHECK_ROOT='catalog/intake-staging/encar/43570782014/1';
// Producer 6a720ec3aa4823ef2808848018bc5b877fb520ad wrote exactly these
// three fields. Counts/time were independently checked by audit 43852979549;
// run/attempt identity comes from the fixed root, not an invented v1 envelope.
const LEGACY_RECEIPT={pages:10270,count:205385,completedAt:'2026-11-14T12:55:40.904Z'};
const fingerprint=meta=>({found:meta.found,...(meta.found?{etag:meta.etag,sha256:rawDigest(meta.value)}:{})});
const same=(a,b)=>rawDigest(a)===rawDigest(b);
// This is transport compatibility evidence only, never a deletion identity.
// HTTP Last-Modified has whole-second resolution; S3 LIST may retain fractions.
// Preserve both observations rather than rewriting the inventory timestamp.
export function compareReadOnlyObjectMetadata(list,head) {
  const listMs=Date.parse(list?.lastModified),headMs=Date.parse(head?.lastModified);
  const valid=typeof list?.lastModified==='string'&&typeof head?.lastModified==='string'
    &&Number.isFinite(listMs)&&Number.isFinite(headMs)&&listMs>0&&headMs>0;
  const identityFieldsMatch=typeof list?.etag==='string'&&list.etag.length>0&&head?.etag===list.etag
    &&Number.isSafeInteger(list?.size)&&list.size>=0&&head?.size===list.size;
  const exactMatch=Boolean(valid&&identityFieldsMatch&&head.lastModified===list.lastModified);
  const httpSecondCompatible=Boolean(valid&&identityFieldsMatch&&headMs%1000===0
    &&listMs>headMs&&listMs<headMs+1000);
  return {exactMatch,matches:exactMatch||httpSecondCompatible,
    timestampComparison:exactMatch?'exact':httpSecondCompatible?'http_second_precision':'mismatch'};
}
const safeTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const safeReason=error=>/^raw_(?:storage_check|gc_s3)_[a-z0-9_]+$/.test(String(error?.message||''))?error.message:'raw_storage_check_failed';
function failedReport(error,evidence={},io) {
  const schemaDiagnostic=rawGcS3SchemaDiagnostic(error);
  let transport=null;
  try {
    const stats=io?.stats();
    if(stats)transport=Object.fromEntries(['requests','get','list','head','put','post','responseBytes']
      .map(key=>[key,Number.isSafeInteger(stats[key])&&stats[key]>=0?stats[key]:null]));
  } catch {}
  return {version:1,status:'failed',reason:safeReason(error),checkedAt:new Date().toISOString(),
    target:RAW_GC_TARGET,root:RAW_READONLY_CHECK_ROOT,scope:'bounded_transport_acceptance_only',
    completeInventory:false,...evidence,...(schemaDiagnostic?{schemaDiagnostic}:{}),transport,
    executionEnabled:false,storageWrites:0,deleteRequests:0};
}
class RawStorageCheckFailure extends Error {
  constructor(error,evidence,io) {super(safeReason(error));this.report=failedReport(error,evidence,io);}
}

export async function verifyRawStorageReadOnly(options={}) {
  const evidence={};
  try {return await verifyRawStorageReadOnlyChecked({...options,evidence});}
  catch(error) {throw new RawStorageCheckFailure(error,evidence,options.io);}
}
async function verifyRawStorageReadOnlyChecked({io,now=Date.now,workMs=120000,evidence}={}) {
  assert.ok(io&&same(io.target,RAW_GC_TARGET),'raw_storage_check_target');
  for(const method of ['readJson','listPage','headObject','stats'])assert.equal(typeof io[method],'function','raw_storage_check_read_port');
  assert.ok(!io.writeJson&&!io.deleteBatch,'raw_storage_check_no_mutation_port');
  assert.ok(Number.isSafeInteger(workMs)&&workMs>0&&workMs<=120000,'raw_storage_check_work_bound');
  const startedAt=now(),deadline=startedAt+workMs;
  const read=(key,maxBytes)=>io.readJson({target:RAW_GC_TARGET,key,maxBytes,deadline});
  const before=[];
  evidence.controls={policy:null,registry:null,unchanged:null};
  for(const key of [RAW_GC_POLICY_KEY,RAW_COORDINATION_KEY]) {
    const observed=fingerprint(await read(key,key===RAW_GC_POLICY_KEY?4096:4*1024**2));before.push(observed);
    evidence.controls[key===RAW_GC_POLICY_KEY?'policy':'registry']=observed;
  }
  const lock=await read('catalog/import-lock.json',65536),lockAt=now();
  const safeName=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value)?value:null;
  const publicationLease={...fingerprint(lock),checkedAt:new Date(lockAt).toISOString(),
    activeAtRead:lock.found&&Date.parse(lock.value?.lockedUntil||'')>lockAt,
    operationType:safeName(lock.value?.operationType),operationId:safeName(lock.value?.operationId),
    lockedUntil:safeTime(lock.value?.lockedUntil),startedAt:safeTime(lock.value?.startedAt),
    heartbeatAt:safeTime(lock.value?.heartbeatAt)};
  evidence.publicationLease=publicationLease;
  const receiptKey=RAW_READONLY_CHECK_ROOT+'/complete.json';
  const receipt=await read(receiptKey,4*1024**2);
  const value=receipt.value;
  const receiptObject=value!==null&&typeof value==='object'&&!Array.isArray(value);
  const knownFields=['pages','count','completedAt','version','provider','runId','attempt'];
  evidence.receipt={key:receiptKey,...fingerprint(receipt),
    fields:Object.fromEntries(knownFields.map(key=>[key,receiptObject&&Object.hasOwn(value,key)?typeof value[key]:'absent'])),
    unexpectedFieldCount:receiptObject?Object.keys(value).filter(key=>!knownFields.includes(key)).length:0,
    pages:Number.isSafeInteger(value?.pages)?value.pages:null,count:Number.isSafeInteger(value?.count)?value.count:null,
    completedAt:safeTime(value?.completedAt)};
  assert.ok(receipt.found&&receiptObject&&Object.keys(value).sort().join(',')==='completedAt,count,pages'
    &&value.pages===LEGACY_RECEIPT.pages&&value.count===LEGACY_RECEIPT.count&&value.completedAt===LEGACY_RECEIPT.completedAt,
  'raw_storage_check_saved_receipt_changed');
  const objects=[],tokens=new Set();let cursor=null;
  // Two small pages exercise continuation token handling without claiming a
  // complete inventory. Keep exact equality separate from HTTP precision compatibility.
  for(let pageIndex=0;pageIndex<2;pageIndex++) {
    const page=await io.listPage({target:RAW_GC_TARGET,prefix:RAW_READONLY_CHECK_ROOT+'/',cursor,maxKeys:2,deadline});
    assert.ok(page.prefix===RAW_READONLY_CHECK_ROOT+'/'&&page.objects.length>0&&page.objects.length<=2,'raw_storage_check_list');
    for(const row of page.objects) {
      assert.ok(row.key.startsWith(RAW_READONLY_CHECK_ROOT+'/')&&!objects.some(previous=>previous.key===row.key),'raw_storage_check_duplicate_or_scope');
      const head=await io.headObject({target:RAW_GC_TARGET,key:row.key,deadline});
      assert.ok(head.found,'raw_storage_check_head_missing');
      objects.push({key:row.key,list:{etag:row.etag,size:row.size,lastModified:row.lastModified},
        head:{etag:head.etag,size:head.size,lastModified:head.lastModified},
        ...compareReadOnlyObjectMetadata(row,head)});
    }
    if(!page.truncated)break;
    assert.ok(typeof page.nextCursor==='string'&&page.nextCursor&&!tokens.has(page.nextCursor)&&page.nextCursor!==cursor,'raw_storage_check_cursor');
    tokens.add(page.nextCursor);cursor=page.nextCursor;
  }
  const listedReceipt=objects.find(row=>row.key===receiptKey);
  assert.ok(listedReceipt&&listedReceipt.list.etag===receipt.etag,'raw_storage_check_receipt_not_listed');
  const after=[];
  for(const key of [RAW_GC_POLICY_KEY,RAW_COORDINATION_KEY])after.push(fingerprint(await read(key,key===RAW_GC_POLICY_KEY?4096:4*1024**2)));
  evidence.controls.unchanged=same(before,after);
  assert.ok(same(before,after),'raw_storage_check_control_changed');
  assert.ok(now()<deadline,'raw_storage_check_deadline');
  const transport=io.stats();
  assert.ok(transport.put===0&&transport.post===0&&transport.requests<=16,'raw_storage_check_readonly_violation');
  const matched=objects.every(row=>row.matches);
  return {version:1,status:matched?'verified':'blocked',reason:matched?null:'head_list_metadata_mismatch',
    checkedAt:new Date(now()).toISOString(),elapsedMs:now()-startedAt,target:RAW_GC_TARGET,
    root:RAW_READONLY_CHECK_ROOT,scope:'bounded_transport_acceptance_only',completeInventory:false,
    controls:{policy:before[0],registry:before[1],unchanged:true},publicationLease,
    receipt:{key:receiptKey,etag:receipt.etag,sha256:rawDigest(value),pages:value.pages,count:value.count,
      completedAt:value.completedAt,format:'legacy_pages_count_completedAt'},
    objects,transport,exactMetadataMatch:objects.every(row=>row.exactMatch),executionEnabled:false,storageWrites:0,deleteRequests:0};
}

async function main() {
  assert.equal(process.argv.length,4,'raw_storage_check_arguments');
  assert.equal(process.argv[2],'--output','raw_storage_check_arguments');
  const output=process.argv[3];assert.ok(path.isAbsolute(output),'raw_storage_check_absolute_output');
  assert.ok(process.env.GITHUB_REPOSITORY==='jeep-jim/AvtoCena'&&process.env.GITHUB_REF==='refs/heads/main'
    &&/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA||''),'raw_storage_check_source');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);
  try {
    let result;
    try {
      const io=createReadOnlyRawGcS3Transport({signal:controller.signal,limits:{requests:16,responseBytes:12*1024**2}});
      result=await verifyRawStorageReadOnly({io});
    } catch(error) {result=error instanceof RawStorageCheckFailure?error.report:failedReport(error);}
    const report={...result,sourceSha:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT};
    await fs.writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify(report));
    if(report.status!=='verified')process.exitCode=1;
  } finally {clearTimeout(timer);}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)void main().catch(error=>{
  const message=String(error?.message||'').split('\n')[0];
  console.error(JSON.stringify({status:'failed',reason:/^raw_(?:storage_check|gc_s3)_[a-z0-9_]+$/.test(message)?message:'raw_storage_check_failed',
    executionEnabled:false,storageWrites:0,deleteRequests:0}));process.exitCode=1;
});

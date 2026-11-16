import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {verifyRawStorageReadOnly,RAW_READONLY_CHECK_ROOT} from '../scripts/catalog-raw-storage-readonly-check.mjs';
import {RAW_GC_TARGET} from '../scripts/lib/catalog-raw-gc.mjs';

// Exact three-field output of producer 6a720ec, verified by audit 43852979549.
const legacyReceipt={pages:10270,count:205385,completedAt:'2026-11-14T12:55:40.904Z'};
function fixture({mismatch=false,changed=false,writePort=false,receipt=legacyReceipt as any,receiptFound=true}={}) {
  const calls:any[]=[];let controlReads=0;
  const rows=['complete.json','page-receipts/1.json','page-receipts/10.json','page-receipts/100.json']
    .map((leaf,index)=>({key:RAW_READONLY_CHECK_ROOT+'/'+leaf,etag:'"etag'+index+'"',size:100+index,lastModified:'2026-11-14T12:55:40.000Z'}));
  const io:any={target:RAW_GC_TARGET,
    async readJson({key}:any) {
      calls.push({method:'GET',key});
      if(key.endsWith('/complete.json'))return {found:receiptFound,etag:rows[0].etag,value:receipt};
      if(key==='catalog/import-lock.json')return {found:true,etag:'"lock"',value:{operationType:'catalog_v3_publish_china',
        operationId:'catalog_v3_publish_china_test',lockedUntil:'2099-01-01T00:00:00Z',heartbeatAt:'2026-11-16T14:00:00Z',
        untrustedExtra:'never copy raw lock documents'}};
      controlReads++;
      return changed&&controlReads>2?{found:true,etag:'"changed"',value:{changed:true}}:{found:false,value:null};
    },
    async listPage({prefix,cursor,maxKeys}:any) {
      calls.push({method:'LIST',prefix,cursor,maxKeys});
      assert.equal(maxKeys,2);
      return {prefix,objects:rows.slice(cursor?2:0,cursor?4:2),truncated:true,nextCursor:cursor?'next2':'next1'};
    },
    async headObject({key}:any) {
      calls.push({method:'HEAD',key});
      const row=rows.find(row=>row.key===key)!;
      return {found:true,...row,...(mismatch?{lastModified:'2026-11-14T12:55:40.123Z'}:{})};
    },
    stats(){return {requests:calls.length,get:calls.filter(row=>row.method==='GET').length,
      list:calls.filter(row=>row.method==='LIST').length,head:calls.filter(row=>row.method==='HEAD').length,put:0,post:0,responseBytes:1000};},
  };
  if(writePort)io.writeJson=()=>{throw Error('unexpected mutation');};
  return {io,calls};
}

test('real verification routine stays bounded and records no deletion authority',async()=>{
  const {io,calls}=fixture(),result=await verifyRawStorageReadOnly({io});
  assert.equal(result.status,'verified');assert.equal(result.completeInventory,false);
  assert.equal(result.executionEnabled,false);assert.equal(result.storageWrites,0);assert.equal(result.deleteRequests,0);
  assert.equal(calls.length,12);assert.equal(result.objects.length,4);assert.equal(result.controls.unchanged,true);
  assert.equal(result.publicationLease.operationType,'catalog_v3_publish_china');
  assert.equal(result.publicationLease.activeAtRead,true);
  assert.equal(result.receipt.format,'legacy_pages_count_completedAt');
  assert.equal(result.receipt.completedAt,legacyReceipt.completedAt);
  assert.equal(result.receipt.sha256,'0fdb319051d5e7fb2648dfe00d3f9f2ad694be409fc64b7016064990371a630f');
  assert.ok(!JSON.stringify(result).includes('untrustedExtra'));
  assert.ok(calls.every(row=>['GET','LIST','HEAD'].includes(row.method)));
});
test('precision mismatch is preserved in the report and never silently accepted',async()=>{
  const result=await verifyRawStorageReadOnly({io:fixture({mismatch:true}).io});
  assert.equal(result.status,'blocked');assert.equal(result.reason,'head_list_metadata_mismatch');
  assert.notEqual(result.objects[0].head.lastModified,result.objects[0].list.lastModified);
});
test('changed coordination authority and mutation-capable ports fail closed',async()=>{
  await assert.rejects(()=>verifyRawStorageReadOnly({io:fixture({changed:true}).io}),(error:any)=>{
    assert.equal(error.message,'raw_storage_check_control_changed');
    assert.equal(error.report.controls.unchanged,false);return true;
  });
  const {io,calls}=fixture({writePort:true});
  await assert.rejects(()=>verifyRawStorageReadOnly({io}),/raw_storage_check_no_mutation_port/);
  assert.equal(calls.length,0);
});
test('only the exact pinned legacy receipt is accepted; modern envelopes and coercions fail before LIST',async()=>{
  for(const receipt of [null,[],{pages:10270,count:205385},
    {...legacyReceipt,pages:'10270'},{...legacyReceipt,count:'205385'},
    {...legacyReceipt,pages:10269},{...legacyReceipt,count:205384},
    {...legacyReceipt,completedAt:'2026-11-14T12:55:40.000Z'},
    {...legacyReceipt,version:1,provider:'auto_api_encar',runId:'43570782014',attempt:'1'}]) {
    const {io,calls}=fixture({receipt});
    await assert.rejects(()=>verifyRawStorageReadOnly({io}),/raw_storage_check_saved_receipt_changed/);
    assert.equal(calls.length,4);assert.ok(calls.every(call=>call.method==='GET'));
  }
  await assert.rejects(()=>verifyRawStorageReadOnly({io:fixture({receiptFound:false}).io}),/raw_storage_check_saved_receipt_changed/);
});
test('receipt failures preserve only bounded already-read metadata and never claim an after-read',async()=>{
  const {io,calls}=fixture({receipt:{...legacyReceipt,privateRaw:'https://private.invalid/?key=do-not-log'}});
  await assert.rejects(()=>verifyRawStorageReadOnly({io}),(error:any)=>{
    const report=error.report,serialized=JSON.stringify(report);
    assert.equal(report.status,'failed');assert.equal(report.reason,'raw_storage_check_saved_receipt_changed');
    assert.equal(report.controls.unchanged,null);assert.deepEqual(report.controls.policy,{found:false});
    assert.equal(report.publicationLease.operationType,'catalog_v3_publish_china');
    assert.equal(report.receipt.unexpectedFieldCount,1);assert.equal(report.receipt.fields.version,'absent');
    assert.equal(report.receipt.pages,10270);assert.equal(report.receipt.count,205385);
    assert.equal(report.transport.requests,4);assert.equal(report.transport.list,0);assert.equal(report.transport.head,0);
    assert.equal(report.storageWrites,0);assert.equal(report.deleteRequests,0);assert.equal(report.executionEnabled,false);
    for(const privateText of ['privateRaw','private.invalid','do-not-log','untrustedExtra','never copy raw lock'])assert.ok(!serialized.includes(privateText));
    assert.ok(serialized.length<4096);return true;
  });
  assert.equal(calls.length,4);
});
test('failure artifacts do not trust schema-shaped properties on arbitrary errors',async()=>{
  const {io}=fixture();
  io.listPage=async()=>{throw Object.assign(Error('raw_gc_s3_xml_unknown_field'),{schemaDiagnostic:{parent:'private-value'}});};
  await assert.rejects(()=>verifyRawStorageReadOnly({io}),(error:any)=>{
    assert.equal(error.report.reason,'raw_gc_s3_xml_unknown_field');assert.equal(error.report.schemaDiagnostic,undefined);
    assert.ok(!JSON.stringify(error.report).includes('private-value'));return true;
  });
});
for(const phase of ['receipt','list-schema'])test('native CLI writes its safe '+phase+' failure artifact and exits without further requests',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'raw-storage-check-'));
  try {
    const preload=path.join(directory,'mock-fetch.mjs'),output=path.join(directory,'report.json');
    fs.writeFileSync(preload,`import assert from 'node:assert/strict';
const target=${JSON.stringify(RAW_GC_TARGET)};
const phase=${JSON.stringify(phase)};
globalThis.fetch=async (url,options)=>{
  assert.equal(options.method,'GET');assert.equal(url.origin,target.endpoint);
  if(url.searchParams.get('list-type')==='2') {
    assert.equal(phase,'list-schema');assert.equal(url.pathname,'/'+target.bucket);
    assert.equal(url.searchParams.get('prefix'),target.prefix+${JSON.stringify(RAW_READONLY_CHECK_ROOT+'/')});
    assert.equal(url.searchParams.get('max-keys'),'2');
    return new Response('<ListBucketResult><VendorExtension>do-not-log-xml-body-token-key</VendorExtension></ListBucketResult>');
  }
  assert.equal(url.search,'');
  const prefix='/'+target.bucket+'/'+target.prefix;assert.ok(url.pathname.startsWith(prefix));
  const key=url.pathname.slice(prefix.length);let value;
  if(key==='catalog/raw-feed-coordination/v1/policy.json'||key==='catalog/raw-feed-coordination/v1/state.json')return new Response('',{status:404});
  if(key==='catalog/import-lock.json')value={operationType:'catalog_v3_publish_china',lockedUntil:'2099-01-01T00:00:00Z',privateOwner:'do-not-log-owner'};
  else if(key===${JSON.stringify(RAW_READONLY_CHECK_ROOT+'/complete.json')})value={...${JSON.stringify(legacyReceipt)},...(phase==='receipt'?{privateRaw:'do-not-log-receipt'}:{})};
  else throw Error('unexpected fixture request');
  const body=JSON.stringify(value);return new Response(body,{headers:{etag:'"fixture"','content-length':String(Buffer.byteLength(body))}});
};
`);
    const result=spawnSync(process.execPath,['--import',preload,'scripts/catalog-raw-storage-readonly-check.mjs','--output',output],{
      cwd:path.resolve(import.meta.dirname,'..'),encoding:'utf8',timeout:10000,env:{...process.env,
        YC_OBJECT_STORAGE_ENDPOINT:RAW_GC_TARGET.endpoint,YC_OBJECT_STORAGE_REGION:'us-east-1',
        YC_OBJECT_STORAGE_BUCKET:RAW_GC_TARGET.bucket,YC_OBJECT_STORAGE_PREFIX:RAW_GC_TARGET.prefix,
        YC_OBJECT_STORAGE_ACCESS_KEY_ID:'fixture-access',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'do-not-log-secret',
        GITHUB_REPOSITORY:'jeep-jim/AvtoCena',GITHUB_REF:'refs/heads/main',GITHUB_SHA:'a'.repeat(40),
        GITHUB_RUN_ID:'43890601103',GITHUB_RUN_ATTEMPT:'2'}});
    assert.equal(result.error,undefined);assert.equal(result.status,1);
    const artifact=fs.readFileSync(output,'utf8'),report=JSON.parse(artifact);
    assert.equal(report.reason,phase==='receipt'?'raw_storage_check_saved_receipt_changed':'raw_gc_s3_xml_unknown_field');
    assert.equal(report.controls.unchanged,null);
    assert.equal(report.transport.requests,phase==='receipt'?4:5);assert.equal(report.transport.head,0);
    assert.equal(report.storageWrites,0);assert.equal(report.executionEnabled,false);
    if(phase==='list-schema')assert.deepEqual(report.schemaDiagnostic,{parent:'ListBucketResult',unknownNames:['VendorExtension'],unknownFieldCount:1,omittedNameCount:0});
    else assert.equal(report.schemaDiagnostic,undefined);
    assert.deepEqual(JSON.parse(result.stdout),report);assert.equal(result.stderr,'');
    for(const privateText of ['do-not-log','fixture-access','privateRaw','privateOwner'])assert.ok(!(artifact+result.stdout+result.stderr).includes(privateText));
    assert.ok(artifact.length<8192);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});

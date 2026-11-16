import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyRawStorageReadOnly,RAW_READONLY_CHECK_ROOT} from '../scripts/catalog-raw-storage-readonly-check.mjs';
import {RAW_GC_TARGET} from '../scripts/lib/catalog-raw-gc.mjs';

function fixture({mismatch=false,changed=false,writePort=false}={}) {
  const calls:any[]=[];let controlReads=0;
  const rows=['complete.json','page-receipts/1.json','page-receipts/10.json','page-receipts/100.json']
    .map((leaf,index)=>({key:RAW_READONLY_CHECK_ROOT+'/'+leaf,etag:'"etag'+index+'"',size:100+index,lastModified:'2026-11-14T12:55:40.000Z'}));
  const io:any={target:RAW_GC_TARGET,
    async readJson({key}:any) {
      calls.push({method:'GET',key});
      if(key.endsWith('/complete.json'))return {found:true,etag:rows[0].etag,value:{version:1,provider:'auto_api_encar',runId:'43570782014',attempt:'1',pages:10270,count:205385}};
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
    stats(){return {requests:calls.length,get:calls.filter(row=>row.method==='GET').length,list:2,head:4,put:0,post:0,responseBytes:1000};},
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
  assert.ok(!JSON.stringify(result).includes('untrustedExtra'));
  assert.ok(calls.every(row=>['GET','LIST','HEAD'].includes(row.method)));
});
test('precision mismatch is preserved in the report and never silently accepted',async()=>{
  const result=await verifyRawStorageReadOnly({io:fixture({mismatch:true}).io});
  assert.equal(result.status,'blocked');assert.equal(result.reason,'head_list_metadata_mismatch');
  assert.notEqual(result.objects[0].head.lastModified,result.objects[0].list.lastModified);
});
test('changed coordination authority and mutation-capable ports fail closed',async()=>{
  await assert.rejects(()=>verifyRawStorageReadOnly({io:fixture({changed:true}).io}),/raw_storage_check_control_changed/);
  const {io,calls}=fixture({writePort:true});
  await assert.rejects(()=>verifyRawStorageReadOnly({io}),/raw_storage_check_no_mutation_port/);
  assert.equal(calls.length,0);
});

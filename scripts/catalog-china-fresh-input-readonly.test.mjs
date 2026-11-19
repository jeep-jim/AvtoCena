import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { inspectChinaFreshInput } from './catalog-china-fresh-input-readonly.mjs';
import { createReadOnlyRawGcS3Transport } from './lib/catalog-raw-gc-s3.mjs';
import { RAW_GC_TARGET as target } from './lib/catalog-raw-gc.mjs';
import { rawDigest as digest } from './lib/catalog-raw-provenance.mjs';

const now=Date.parse('2026-11-19T04:00:00Z');
const candidate='44404227672:1';
const root='catalog/nonjp-intake/v1/china/44404227672/1';
const sha='f'.repeat(64);
const env={YC_OBJECT_STORAGE_ENDPOINT:target.endpoint,YC_OBJECT_STORAGE_BUCKET:target.bucket,
  YC_OBJECT_STORAGE_PREFIX:target.prefix,YC_OBJECT_STORAGE_REGION:'us-east-1',
  YC_OBJECT_STORAGE_ACCESS_KEY_ID:'mock-id',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'mock-secret'};
function fixture({hours=2,complete=true,corrupt=false,omit=false}= {}) {
  const report={market:'china',completed:complete,completedAt:new Date(now-hours*3600000).toISOString(),
    sources:[{provider:'auto_api_che168',stopReason:'source_finished',completeInventory:complete,uniqueOffers:10000}],
    forbiddenOutput:'private listing data'};
  const body=Buffer.from(JSON.stringify(report));
  const hash=digest(report);
  const partKey=root+'/files/report.json/0-'+hash+'.json';
  const manifest={version:1,kind:'nonjp-intake',market:'china',
    owner:{runId:'44404227672',attempt:'1',revision:'a'.repeat(40)},
    collection:{complete,qualityStatus:'ok'},totalBytes:body.length,reportDigest:hash,files:[{
      name:'report.json',bytes:body.length,sha256:hash,parts:[{key:partKey,bytes:body.length,sha256:hash}]}]};
  const replicaRoot='catalog/provider-replicas/che168/f4b2068a-1587-49e9-85c7-eca0104acdc4';
  const replicaBody={version:1,binding:sha,cursor:8,parts:[{bytes:100,sha256:sha}]};
  const replies=new Map([['catalog/manifest.json',{markets:{china:{count:9950,updatedAt:'2026-10-22'}}}],
    ['catalog/intake-cursors/v1/china.json',{updatedAt:'2026-10-22',sources:[{provider:'auto_api_che168',
      cursor:8,snapshotBinding:sha,replica:{key:replicaRoot,sha256:digest(replicaBody),cursor:8,binding:sha}}]}],
    [replicaRoot+'/manifest.json',replicaBody]]);
  if(!omit) {
    replies.set(root+'/complete.json',manifest);
    replies.set(partKey,{version:1,encoding:'gzip-base64',sha256:hash,bytes:body.length,
      payload:gzipSync(corrupt ? Buffer.alloc(body.length) : body).toString('base64')});
  }
  const seen=[];
  const io=createReadOnlyRawGcS3Transport({environment:env,now:()=>now,limits:{requests:24,responseBytes:24*1024**2},
    fetchImpl:async (url, request)=>{
      assert.equal(request.method,'GET'); assert.equal(url.origin,target.endpoint); assert.equal(url.search,'');
      const key=url.pathname.slice(('/'+target.bucket+'/'+target.prefix).length);
      assert.ok(replies.has(key)||key===root+'/complete.json',key);
      seen.push(key);
      return replies.has(key) ? new Response(JSON.stringify(replies.get(key)),{status:200,headers:{etag:'"mock"'}})
        : new Response(null,{status:404});
    }});
  return {io,seen};
}
test('fresh bounded metadata probe only issues same-origin GET and emits aggregate candidate, not publication proof',async()=>{
  const {io,seen}=fixture();
  const output=await inspectChinaFreshInput({io,candidates:[candidate],now:()=>now});
  assert.equal(seen.length,5);
  assert.equal(output.archives[0].status,'candidate_for_full_verification');
  assert.equal(output.activeChina.count,9950);
  assert.equal(output.publishedCursor.hasMatchingReplicaMetadata,true);
  assert.equal(output.publishAuthorized,false);
  assert.equal(output.identityAndHandoffVerified,false);
  assert.doesNotMatch(JSON.stringify(output),/private listing data|replicas|f4b2068a/);
});
test('expired, future and partial report are not fresh complete candidates',async()=>{
  for(const options of [{hours:49},{hours:-1},{complete:false}]){
    const {io}=fixture(options);
    const output=await inspectChinaFreshInput({io,candidates:[candidate],now:()=>now});
    assert.equal(output.archives[0].status,'not_a_fresh_complete_candidate');
  }
});
test('missing marker is not proof no snapshots exist; corrupt report aborts',async()=>{
  const {io}=fixture({omit:true});
  const output=await inspectChinaFreshInput({io,candidates:[candidate],now:()=>now});
  assert.equal(output.archives[0].status,'missing_complete_manifest');
  assert.equal(output.coverage,'not_a_complete_storage_inventory');
  await assert.rejects(inspectChinaFreshInput({io:fixture({corrupt:true}).io,candidates:[candidate],now:()=>now}),/china_ro_report_part_hash/);
});
test('invalid or repeated run scope is refused before any request',async()=>{
  for(const candidates of [[candidate,candidate],['../../x:1'],['44404227672:0']]){
    const {io,seen}=fixture();
    await assert.rejects(inspectChinaFreshInput({io,candidates,now:()=>now}),/china_ro_candidates/);
    assert.equal(seen.length,0);
  }
});

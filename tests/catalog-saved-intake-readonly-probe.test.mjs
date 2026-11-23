import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {probeSavedIntakesReadOnly,SAVED_INTAKE_PROBE_ARCHIVES} from '../scripts/catalog-saved-intake-readonly-probe.mjs';
import {createReadOnlyRawGcS3Transport} from '../scripts/lib/catalog-raw-gc-s3.mjs';
import {RAW_GC_TARGET,RAW_GC_POLICY_KEY} from '../scripts/lib/catalog-raw-gc.mjs';
import {RAW_COORDINATION_KEY} from '../scripts/lib/catalog-raw-coordination.mjs';
import {rawDigest} from '../scripts/lib/catalog-raw-provenance.mjs';

const CURSOR='catalog/intake-cursors/v1/uae.json';
const date='2026-11-23T04:00:00.000Z';
function fixture({cursor=320763,snapshot='2026-11-17T00:34:23.387Z',changed=false,missing=false,
  extra=false,badHead=false,activeLease=false,privateError=false}={}) {
  const calls=[],objects=new Map(),json=new Map(),reads=new Map();
  const pins=SAVED_INTAKE_PROBE_ARCHIVES.map(pin=>{
    const files=['report.json','source-000001.jsonl'].map((name,index)=>{
      const sha256=String(index+1).repeat(64);
      return {name,bytes:16,sha256,parts:[{key:pin.root+'/files/'+name+'/0-'+sha256+'.json',bytes:16,sha256}]};
    });
    const value={version:1,kind:'nonjp-intake',market:pin.market,
      owner:{runId:pin.runId,attempt:pin.attempt,revision:pin.sourceSha},files,
      reportDigest:files[0].sha256,totalBytes:32,collection:{complete:true,qualityStatus:'finished'}};
    const key=pin.root+'/complete.json',bytes=Buffer.byteLength(JSON.stringify(value));
    json.set(key,{found:true,value,etag:'"manifest-'+pin.market+'"',bytes});
    for(const objectKey of [key,...files.flatMap(file=>file.parts.map(part=>part.key))])objects.set(objectKey,{
      key:objectKey,etag:objectKey===key?'"manifest-'+pin.market+'"':'"part"',
      size:objectKey===key?bytes:64,lastModified:date});
    return {...pin,manifestSha256:rawDigest(value)};
  });
  json.set(CURSOR,{found:true,etag:'"cursor"',value:{version:1,market:'uae',updatedAt:date,
    sources:[{sourceId:'dubicars_uae_exact',provider:'auto_api_dubicars',snapshotStartedAt:snapshot,cursor,
      privateRaw:'do-not-log-private-value'}]}});
  json.set('catalog/manifest.json',{found:true,etag:'"catalog"',value:{version:2,generationId:'gen_1790000000000_test',
    markets:{uae:{count:100},europe:{count:200}},privateRaw:'do-not-log-private-value'}});
  json.set('catalog/import-lock.json',{found:true,etag:'"lease"',value:{lockedUntil:activeLease?'2099-01-01T00:00:00Z':''}});
  if(missing)objects.delete(pins[0].root+'/files/source-000001.jsonl/0-'+'2'.repeat(64)+'.json');
  if(extra)objects.set(pins[0].root+'/untrusted-private-name.json',{key:pins[0].root+'/untrusted-private-name.json',
    etag:'"extra"',size:1,lastModified:date});
  const io={target:RAW_GC_TARGET,
    async readJson({key}) {
      calls.push({method:'GET',key});reads.set(key,(reads.get(key)||0)+1);
      if(privateError&&key.endsWith('/complete.json'))throw Error('supplier-token-do-not-log-private-value');
      assert.ok(!key.includes('/files/'),'the probe must never download raw or report payloads');
      const meta=structuredClone(json.get(key)||{found:false,value:null});
      if(changed&&key===CURSOR&&reads.get(key)>1)meta.etag='"changed"';
      return meta;
    },
    async listPage({prefix,cursor,maxKeys}) {
      calls.push({method:'LIST',prefix,cursor});assert.equal(maxKeys,1000);
      const rows=[...objects.values()].filter(row=>row.key.startsWith(prefix));
      const offset=cursor===null?0:Number(cursor),end=offset+2;
      return {prefix,objects:rows.slice(offset,end),truncated:end<rows.length,nextCursor:end<rows.length?String(end):null};
    },
    async headObject({key}) {
      calls.push({method:'HEAD',key});const row=objects.get(key);
      return row?{found:true,...row,...(badHead?{size:row.size+1}:{})}:{found:false};
    },
    stats(){return {requests:calls.length,get:calls.filter(row=>row.method==='GET').length,
      list:calls.filter(row=>row.method==='LIST').length,head:calls.filter(row=>row.method==='HEAD').length,
      put:0,post:0,responseBytes:1024};},
  };
  return {io,pins,calls,objects,json};
}

test('complete saved-root LIST and every HEAD are checked without requesting any payload',async()=>{
  const f=fixture(),report=await probeSavedIntakesReadOnly(f);
  assert.equal(report.status,'verified_metadata_only');assert.equal(report.cursor.cursor,320763);
  assert.equal(report.cursor.comparison,'matches_saved_delta_base');assert.equal(report.controls.unchanged,true);
  assert.equal(report.archives.length,2);
  for(const row of report.archives) {
    assert.equal(row.files,2);assert.equal(row.expectedObjects,3);assert.equal(row.listedObjects,3);
    assert.equal(row.headVerifiedObjects,3);assert.equal(row.completeInventory,true);assert.equal(row.manifestUnchanged,true);
    assert.equal(row.payloadIntegrityVerified,false);assert.match(row.inventorySha256,/^[a-f0-9]{64}$/);
  }
  assert.equal(report.transport.get,13);assert.equal(report.transport.list,4);assert.equal(report.transport.head,6);
  assert.equal(report.publicationAuthorized,false);assert.equal(report.storageWrites,0);assert.equal(report.supplierRequests,0);
  const serialized=JSON.stringify(report);
  assert.ok(!serialized.includes('private'));assert.ok(!serialized.includes('/files/'));assert.ok(serialized.length<8192);
});

test('already advanced, reached, behind and different-snapshot cursors never authorize saved delta reuse',async()=>{
  for(const [options,comparison] of [[{cursor:328970},'saved_cursor_already_reached'],
    [{cursor:400000},'advanced_since_saved_base'],[{cursor:320764},'advanced_since_saved_base'],
    [{cursor:320762},'behind_saved_base'],[{snapshot:'2026-11-18T00:00:00Z'},'snapshot_changed'],
    [{cursor:'320763'},'invalid_or_missing']]) {
    const report=await probeSavedIntakesReadOnly(fixture(options));
    assert.equal(report.status,'blocked');assert.equal(report.reason,'saved_intake_probe_cursor_base_mismatch');
    assert.equal(report.cursor.comparison,comparison);assert.equal(report.archives.every(row=>row.completeInventory),true);
  }
});

test('incomplete/extra inventory, changed metadata and a changed control fail with bounded safe evidence',async()=>{
  for(const [options,reason] of [[{missing:true},'saved_intake_probe_inventory_missing'],
    [{extra:true},'saved_intake_probe_inventory_scope'],[{badHead:true},'saved_intake_probe_head_changed'],
    [{changed:true},'saved_intake_probe_control_changed'],[{privateError:true},'saved_intake_probe_failed']]) {
    const report=await probeSavedIntakesReadOnly(fixture(options));
    assert.equal(report.status,'failed');assert.equal(report.reason,reason);
    assert.equal(report.publicationAuthorized,false);assert.equal(report.storageWrites,0);
    assert.ok(!JSON.stringify(report).includes('private'));assert.ok(!JSON.stringify(report).includes('supplier-token'));
  }
});

test('an active publication lease blocks reuse and mutation-capable ports fail before reads',async()=>{
  const active=await probeSavedIntakesReadOnly(fixture({activeLease:true}));
  assert.equal(active.status,'blocked');assert.equal(active.reason,'saved_intake_probe_publication_in_progress');
  const f=fixture();f.io.writeJson=()=>assert.fail('no write is authorized');
  const rejected=await probeSavedIntakesReadOnly(f);
  assert.equal(rejected.reason,'saved_intake_probe_mutation_port');assert.equal(f.calls.length,0);
});

test('the real S3 transport performs only exact signed REG GET/HEAD requests in the probe',async()=>{
  const f=fixture(),wire=[];
  const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const io=createReadOnlyRawGcS3Transport({environment:{
    YC_OBJECT_STORAGE_ENDPOINT:RAW_GC_TARGET.endpoint,YC_OBJECT_STORAGE_REGION:'us-east-1',
    YC_OBJECT_STORAGE_BUCKET:RAW_GC_TARGET.bucket,YC_OBJECT_STORAGE_PREFIX:RAW_GC_TARGET.prefix,
    YC_OBJECT_STORAGE_ACCESS_KEY_ID:'fixture-access',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'do-not-log-secret'},
    fetchImpl:async(url,options)=>{
      assert.equal(url.origin,RAW_GC_TARGET.endpoint);assert.ok(['GET','HEAD'].includes(options.method));
      assert.equal(options.redirect,'error');wire.push({method:options.method,url:url.href});
      if(url.searchParams.get('list-type')==='2') {
        assert.equal(options.method,'GET');const prefix=url.searchParams.get('prefix').slice(RAW_GC_TARGET.prefix.length);
        assert.ok(f.pins.some(pin=>prefix===pin.root+'/'));
        const rows=[...f.objects.values()].filter(row=>row.key.startsWith(prefix));
        return new Response('<ListBucketResult><Name>'+RAW_GC_TARGET.bucket+'</Name><Prefix>'+escape(RAW_GC_TARGET.prefix+prefix)
          +'</Prefix><KeyCount>'+rows.length+'</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated><EncodingType>url</EncodingType>'
          +rows.map(row=>'<Contents><Key>'+encodeURIComponent(RAW_GC_TARGET.prefix+row.key)+'</Key><LastModified>'+date+'</LastModified><ETag>'
            +escape(row.etag)+'</ETag><Size>'+row.size+'</Size><StorageClass>STANDARD</StorageClass></Contents>').join('')+'</ListBucketResult>');
      }
      const prefix='/'+RAW_GC_TARGET.bucket+'/'+RAW_GC_TARGET.prefix;
      assert.ok(url.pathname.startsWith(prefix));const key=url.pathname.slice(prefix.length);
      if(options.method==='HEAD') {
        const row=f.objects.get(key);assert.ok(row);
        return new Response(null,{headers:{etag:row.etag,'content-length':String(row.size),'last-modified':new Date(date).toUTCString()}});
      }
      assert.ok(!key.includes('/files/'),'raw data must not be fetched');
      assert.ok([CURSOR,'catalog/manifest.json','catalog/import-lock.json',RAW_GC_POLICY_KEY,RAW_COORDINATION_KEY,
        ...f.pins.map(pin=>pin.root+'/complete.json')].includes(key));
      const meta=f.json.get(key);if(!meta)return new Response(null,{status:404});
      const body=JSON.stringify(meta.value);return new Response(body,{headers:{etag:meta.etag,'content-length':String(Buffer.byteLength(body))}});
    }});
  const report=await probeSavedIntakesReadOnly({io,pins:f.pins});
  assert.equal(report.status,'verified_metadata_only');assert.equal(report.transport.put,0);assert.equal(report.transport.post,0);
  assert.equal(wire.filter(row=>row.method==='HEAD').length,6);
  assert.ok(!JSON.stringify(report).includes('do-not-log'));
});

test('workflow has only a manual main trigger and no data collection or mutation command',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/catalog-saved-intake-readonly-probe.yml',import.meta.url),'utf8');
  assert.match(workflow,/on:\n  workflow_dispatch:\npermissions:/);
  assert.match(workflow,/ref: \$\{\{ github\.sha \}\}/);assert.match(workflow,/persist-credentials: false/);
  assert.ok(!/^\s*(?:push|schedule|workflow_run):/m.test(workflow));
  assert.ok(!/catalog-(?:collect|publish|commit|archive)-|delete-batch|executeRawGc|npm (?:run|ci)/.test(workflow));
  assert.equal((workflow.match(/REGCLOUD_S3_/g)||[]).length,2);
});

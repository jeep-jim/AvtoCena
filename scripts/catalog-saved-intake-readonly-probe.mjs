import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createReadOnlyRawGcS3Transport} from './lib/catalog-raw-gc-s3.mjs';
import {RAW_GC_TARGET, RAW_GC_POLICY_KEY} from './lib/catalog-raw-gc.mjs';
import {RAW_COORDINATION_KEY, assertRawCoordination} from './lib/catalog-raw-coordination.mjs';
import {rawDigest} from './lib/catalog-raw-provenance.mjs';
import {validateIntakeArchive} from './lib/nonjp-intake-archive.mjs';
import {compareReadOnlyObjectMetadata} from './catalog-raw-storage-readonly-check.mjs';

// These identities come from the completed collectors and the original
// publisher's own_intake_archive_verified evidence, not a new supplier request.
// https://github.com/jeep-jim/AvtoCena/actions/runs/45076401719
// https://github.com/jeep-jim/AvtoCena/actions/runs/45076867904
export const SAVED_INTAKE_PROBE_ARCHIVES = Object.freeze([
  Object.freeze({market:'uae',runId:'45076401719',attempt:'1',
    sourceSha:'c90dea655470d2970f5f22cc7d7f98c086874738',
    root:'catalog/nonjp-intake/v1/uae/45076401719/1',
    manifestSha256:'5a43c05a34ccad1e1e98de11fe79738ae5d08b508b5c04f7b5f97ac1ab16a43e'}),
  Object.freeze({market:'europe',runId:'45076867904',attempt:'1',
    sourceSha:'c90dea655470d2970f5f22cc7d7f98c086874738',
    root:'catalog/nonjp-intake/v1/europe/45076867904/1',
    manifestSha256:'a78c30abb8c52b09b273699ebcba9fc57d7a7ddc0726533e40e5835ba5de8b78'}),
]);
const CURSOR_KEY='catalog/intake-cursors/v1/uae.json';
const CONTROL_KEYS=[RAW_GC_POLICY_KEY,RAW_COORDINATION_KEY,CURSOR_KEY,'catalog/manifest.json'];
const SHA=/^[a-f0-9]{64}$/;
const MAX_OBJECTS=4096,WORK_MS=300000;
const safeCount=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const safeTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const fingerprint=meta=>({found:meta.found,...(meta.found?{etag:meta.etag,sha256:rawDigest(meta.value)}:{})});
const safeReason=error=>{
  const first=String(error?.message||'').split('\n')[0];
  return /^(?:saved_intake_probe|raw_gc_s3|intake_archive|raw_coord)_[a-z0-9_]+$/.test(first)
    ?first:'saved_intake_probe_failed';
};
const fixedFlags={scope:'exact_saved_intake_metadata_only',payloadIntegrityVerified:false,
  publicationAuthorized:false,storageWrites:0,deleteRequests:0,supplierRequests:0};

function cursorSummary(meta) {
  const expected={initialCursor:320763,cursor:328970,snapshotStartedAt:'2026-11-17T00:34:23.387Z'};
  const value=meta.value,rows=Array.isArray(value?.sources)?value.sources:[];
  const matches=rows.filter(row=>row?.sourceId==='dubicars_uae_exact'&&row.provider==='auto_api_dubicars');
  const source=matches.length===1?matches[0]:null;
  const cursor=safeCount(source?.cursor),snapshotStartedAt=safeTime(source?.snapshotStartedAt);
  let comparison='invalid_or_missing';
  if(meta.found&&value?.version===1&&value.market==='uae'&&source&&cursor!==null) {
    comparison=snapshotStartedAt!==expected.snapshotStartedAt?'snapshot_changed'
      :cursor===expected.initialCursor?'matches_saved_delta_base'
      :cursor===expected.cursor?'saved_cursor_already_reached'
      :cursor>expected.initialCursor?'advanced_since_saved_base':'behind_saved_base';
  }
  return {...fingerprint(meta),sourceCount:safeCount(rows.length),cursor,snapshotStartedAt,
    updatedAt:safeTime(value?.updatedAt),expected,comparison};
}

function safeTransport(io) {
  try {const stats=io?.stats();return stats?Object.fromEntries(
    ['requests','get','list','head','put','post','responseBytes'].map(key=>[key,safeCount(stats[key])])):null;}
  catch {return null;}
}

/** The CLI uses the fixed production pins. The explicit pins argument lets
 * offline tests exercise complete control flow with synthetic manifests. Its
 * roots/owners remain restricted to the same two saved runs. No payload GET. */
export async function probeSavedIntakesReadOnly({io,pins=SAVED_INTAKE_PROBE_ARCHIVES,now=Date.now}={}) {
  const evidence={cursor:null,controls:null,archives:[]};
  try {
    assert.equal(rawDigest(io?.target),rawDigest(RAW_GC_TARGET),'saved_intake_probe_target');
    for(const method of ['readJson','listPage','headObject','stats'])assert.equal(typeof io[method],'function','saved_intake_probe_read_port');
    assert.ok(!io.writeJson&&!io.deleteBatch,'saved_intake_probe_mutation_port');
    assert.ok(Array.isArray(pins)&&pins.length===SAVED_INTAKE_PROBE_ARCHIVES.length,'saved_intake_probe_pins');
    pins.forEach((pin,index)=>{
      const fixed=SAVED_INTAKE_PROBE_ARCHIVES[index];
      assert.ok(['market','runId','attempt','sourceSha','root'].every(key=>pin[key]===fixed[key])
        &&SHA.test(pin.manifestSha256),'saved_intake_probe_pins');
    });
    const startedAt=now(),deadline=startedAt+WORK_MS;
    const allowedReads=new Set([...CONTROL_KEYS,'catalog/import-lock.json',...pins.map(pin=>pin.root+'/complete.json')]);
    const read=async key=>{
      assert.ok(allowedReads.has(key),'saved_intake_probe_read_scope');
      return io.readJson({target:RAW_GC_TARGET,key,maxBytes:key===RAW_GC_POLICY_KEY?4096:4*1024**2,deadline});
    };
    const before=new Map();
    for(const key of CONTROL_KEYS)before.set(key,await read(key));
    evidence.cursor=cursorSummary(before.get(CURSOR_KEY));
    const policy=before.get(RAW_GC_POLICY_KEY),registry=before.get(RAW_COORDINATION_KEY);
    evidence.controls={policy:fingerprint(policy),registry:fingerprint(registry),unchanged:null};
    if(policy.found) {
      assert.ok(policy.value?.version===1&&policy.value.mode==='required'&&policy.value.protocolVersion===1
        &&registry.found&&registry.value?.registryId===policy.value.registryId,'saved_intake_probe_coordination');
      assertRawCoordination(registry.value);
      evidence.controls.coordinationEnabled=true;
      evidence.controls.catalogPublicationPending=registry.value.catalog.pending!==null;
      evidence.controls.uaeCursorPending=registry.value.pointers.find(row=>row.id==='intake_cursor:uae')?.pending!==null;
    } else {
      assert.equal(registry.found,false,'saved_intake_probe_coordination');
      Object.assign(evidence.controls,{coordinationEnabled:false,catalogPublicationPending:false,uaeCursorPending:false});
    }
    const catalog=before.get('catalog/manifest.json');
    assert.ok(catalog.found&&catalog.value?.version===2&&/^gen_\d+_[a-z0-9-]+$/.test(catalog.value.generationId),
      'saved_intake_probe_catalog');
    evidence.catalog={...fingerprint(catalog),generationId:catalog.value.generationId,
      counts:Object.fromEntries(['uae','europe'].map(market=>[market,safeCount(catalog.value.markets?.[market]?.count)]))};
    const lock=await read('catalog/import-lock.json');
    evidence.publicationLease={...fingerprint(lock),activeAtRead:lock.found&&Date.parse(lock.value?.lockedUntil||'')>now(),
      lockedUntil:safeTime(lock.value?.lockedUntil)};
    let objectBudget=0;
    for(const pin of pins) {
      const key=pin.root+'/complete.json',meta=await read(key);
      assert.ok(meta.found,'saved_intake_probe_archive_missing');
      const manifest=validateIntakeArchive(meta.value,pin.root,pin.manifestSha256);
      assert.equal(manifest.owner.revision,pin.sourceSha,'saved_intake_probe_producer');
      assert.equal(manifest.collection.complete,true,'saved_intake_probe_collection_incomplete');
      const expected=new Set([key,...manifest.files.flatMap(file=>file.parts.map(part=>part.key))]);
      objectBudget+=expected.size;
      assert.ok(objectBudget<=MAX_OBJECTS,'saved_intake_probe_inventory_bound');
      const row={market:pin.market,runId:pin.runId,attempt:pin.attempt,...fingerprint(meta),
        reportSha256:manifest.reportDigest,files:manifest.files.length,uncompressedBytes:manifest.totalBytes,
        expectedObjects:expected.size,listedObjects:0,headVerifiedObjects:0,storedBytes:0,
        completeInventory:false,manifestUnchanged:false,payloadIntegrityVerified:false};
      evidence.archives.push(row);
      const listed=new Map(),tokens=new Set();let cursor=null;
      do {
        const page=await io.listPage({target:RAW_GC_TARGET,prefix:pin.root+'/',cursor,maxKeys:1000,deadline});
        assert.ok(page.prefix===pin.root+'/'&&Array.isArray(page.objects)&&page.objects.length<=1000
          &&typeof page.truncated==='boolean','saved_intake_probe_list');
        for(const object of page.objects) {
          assert.ok(expected.has(object.key)&&!listed.has(object.key),'saved_intake_probe_inventory_scope');
          assert.ok(safeCount(object.size)!==null&&object.size>0,'saved_intake_probe_inventory_size');
          listed.set(object.key,object);row.storedBytes+=object.size;
          assert.ok(safeCount(row.storedBytes)!==null,'saved_intake_probe_inventory_size');
        }
        row.listedObjects=listed.size;
        if(!page.truncated)break;
        assert.ok(page.objects.length>0&&typeof page.nextCursor==='string'&&page.nextCursor.length>0
          &&page.nextCursor!==cursor&&!tokens.has(page.nextCursor),'saved_intake_probe_inventory_cursor');
        tokens.add(page.nextCursor);cursor=page.nextCursor;
      } while(true);
      assert.equal(listed.size,expected.size,'saved_intake_probe_inventory_missing');
      assert.equal(listed.get(key)?.etag,meta.etag,'saved_intake_probe_manifest_list_changed');
      assert.equal(listed.get(key)?.size,meta.bytes,'saved_intake_probe_manifest_size_changed');
      const objects=[...listed.values()].sort((a,b)=>a.key.localeCompare(b.key));let index=0;
      const heads=await Promise.allSettled(Array.from({length:Math.min(4,objects.length)},async()=>{
        while(index<objects.length) {
          const object=objects[index++];
          const head=await io.headObject({target:RAW_GC_TARGET,key:object.key,deadline});
          assert.ok(head.found&&compareReadOnlyObjectMetadata(object,head).matches,'saved_intake_probe_head_changed');
          row.headVerifiedObjects++;
        }
      }));
      const failedHead=heads.find(result=>result.status==='rejected');
      if(failedHead)throw failedHead.reason;
      row.inventorySha256=rawDigest(objects.map(({key,etag,size,lastModified})=>({key,etag,size,lastModified})));
      row.completeInventory=true;
      const after=await read(key);
      row.manifestUnchanged=rawDigest(fingerprint(meta))===rawDigest(fingerprint(after));
      assert.ok(row.manifestUnchanged,'saved_intake_probe_manifest_changed');
    }
    const after=new Map();for(const key of CONTROL_KEYS)after.set(key,await read(key));
    evidence.controls.unchanged=CONTROL_KEYS.every(key=>rawDigest(fingerprint(before.get(key)))===rawDigest(fingerprint(after.get(key))));
    assert.ok(evidence.controls.unchanged,'saved_intake_probe_control_changed');
    assert.ok(now()<deadline,'saved_intake_probe_deadline');
    const transport=safeTransport(io);
    assert.ok(transport?.put===0&&transport?.post===0&&transport.requests<=8192,'saved_intake_probe_readonly_violation');
    const reason=evidence.cursor.comparison!=='matches_saved_delta_base'?'saved_intake_probe_cursor_base_mismatch'
      :evidence.publicationLease.activeAtRead||evidence.controls.catalogPublicationPending||evidence.controls.uaeCursorPending
        ?'saved_intake_probe_publication_in_progress':null;
    return {version:1,status:reason?'blocked':'verified_metadata_only',reason,checkedAt:new Date(now()).toISOString(),
      ...evidence,transport,...fixedFlags};
  } catch(error) {
    return {version:1,status:'failed',reason:safeReason(error),checkedAt:new Date(now()).toISOString(),
      ...evidence,transport:safeTransport(io),...fixedFlags};
  }
}

async function main() {
  assert.ok(process.argv.length===4&&process.argv[2]==='--output'&&path.isAbsolute(process.argv[3]),'saved_intake_probe_arguments');
  assert.ok(process.env.GITHUB_REPOSITORY==='jeep-jim/AvtoCena'&&process.env.GITHUB_REF==='refs/heads/main'
    &&process.env.GITHUB_EVENT_NAME==='workflow_dispatch'&&/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA||''),
  'saved_intake_probe_source');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),WORK_MS);
  try {
    let result;
    try {
      const io=createReadOnlyRawGcS3Transport({signal:controller.signal,limits:{requests:8192,responseBytes:32*1024**2}});
      result=await probeSavedIntakesReadOnly({io});
    } catch(error) {result={version:1,status:'failed',reason:safeReason(error),...fixedFlags};}
    const report={...result,sourceSha:process.env.GITHUB_SHA};
    await fs.writeFile(process.argv[3],JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify(report));
    if(report.status!=='verified_metadata_only')process.exitCode=1;
  } finally {clearTimeout(timer);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)void main().catch(error=>{
  console.error(JSON.stringify({status:'failed',reason:safeReason(error),...fixedFlags}));process.exitCode=1;
});

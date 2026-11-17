import test from 'node:test';
import {rawInternalPointerDescriptor} from '../scripts/publisher-runtime83/raw-internal-provenance.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {StorageConflictError} from '../apps/web/lib/data';
import {rawDigest, RAW_PREFIXES, rawGenerationKey, RAW_TRACKED_MARKETS, intakeRawReferences,
  buildRawGenerationProvenance, assertRawGenerationProvenance} from '../scripts/lib/catalog-raw-provenance.mjs';
import {archiveIntakeDirectory, verifyIntakeArchive, intakeArchiveRoot, validateIntakeArchive,
  attachIntakeArchiveReceipt, INTAKE_ARCHIVE_RECEIPT} from '../scripts/lib/nonjp-intake-archive.mjs';
import {captureDubicarsResponses, assertDubicarsPriorIntake} from '../scripts/lib/nonjp-intake-capture.mjs';
import {collectSourcePage, intakeState} from '../scripts/lib/catalog-source-intake.mjs';
import {publishedIntakeCheckpoint} from '../scripts/lib/catalog-intake-checkpoint.mjs';
import {prepareRawPublication} from '../scripts/lib/catalog-raw-publication.mjs';
import {planRawFeedRetention} from '../scripts/lib/catalog-raw-retention-plan.mjs';
import {RAW_COORDINATION_KEY,createRawCoordination,rawCatalogDescriptor,rawPointerDescriptor,RAW_COORDINATED_POINTERS} from '../scripts/lib/catalog-raw-coordination.mjs';
import {RAW_COORDINATION_POLICY_KEY} from '../scripts/publisher-runtime83/raw-coordination-gate.mjs';

const owner={runId:'123456',attempt:'1',revision:'a'.repeat(40)};
function storageFixture() {
  const objects=new Map<string,any>(), versions=new Map<string,number>(),writes:string[]=[];
  const storage={driver:'object',readJson:async(key:string,fallback:any)=>structuredClone(objects.has(key)?objects.get(key):fallback),
    listBucketObjects:async()=>[...objects].map(([key,value])=>({key,size:Buffer.byteLength(JSON.stringify(value))})),
    readJsonWithMeta:async(key:string,fallback:any)=>({found:objects.has(key),value:structuredClone(objects.has(key)?objects.get(key):fallback),
      etag:objects.has(key)?String(versions.get(key)):undefined}),
    writeJson:async(key:string,value:any,condition:any)=>{
      if (condition?.ifNoneMatch==='*'&&objects.has(key)||condition?.ifMatch&&condition.ifMatch!==String(versions.get(key))) throw new StorageConflictError();
      objects.set(key,structuredClone(value));versions.set(key,(versions.get(key)||0)+1);writes.push(key);
    }};
  return {storage,objects,writes};
}
async function directory(market='uae',partial=false) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nonjp-archive-test-')),input=path.join(root,'input');
  await fs.mkdir(input);
  await fs.writeFile(path.join(input,'report.json'),JSON.stringify({version:1,market,completed:!partial,completedAt:'2026-11-16T12:00:00Z',
    qualityStatus:partial?'partial':'configured_routes_finished',sources:[]}));
  const data=JSON.stringify({offer:{id:'sample',market,sourcePrice:12345,sourceCurrency:'AED',images:['https://images.example/car.jpg'],unknown:null}})+'\n';
  await fs.writeFile(path.join(input,'source-000001.jsonl'),data);
  return {root,input,data};
}

async function requiredFixture() {
  const f=storageFixture(),registryId='f'.repeat(32);
  await f.storage.writeJson(RAW_COORDINATION_KEY,createRawCoordination({registryId,current:rawCatalogDescriptor(null),
    previous:rawCatalogDescriptor(null),pointers:RAW_COORDINATED_POINTERS.map(id=>({id,current:id==='internal_catalog'
      ? rawInternalPointerDescriptor(null) : rawPointerDescriptor(null,[],{complete:true})}))}),{ifNoneMatch:'*'});
  await f.storage.writeJson(RAW_COORDINATION_POLICY_KEY,{version:1,mode:'required',protocolVersion:1,registryId},{ifNoneMatch:'*'});
  return f;
}

test('required archive records real queued writes, seals its grant, and restores through a separately drained read claim',async()=>{
  const f=await requiredFixture(),d=await directory();
  try {
    const receipt=await archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'uae',owner});
    const registry=f.objects.get(RAW_COORDINATION_KEY);
    assert.equal(registry.claims.length,1);
    assert.equal(registry.claims[0].phase,'ready');
    assert.equal(registry.claims[0].revision,receipt.handoff.coordination.ticket.revision);
    assert.equal(registry.claims[0].references[0].sha256,receipt.manifestSha256);
    const before=f.writes.filter(key=>key.startsWith(receipt.root+'/')).length;
    await verifyIntakeArchive({storage:f.storage,receipt,directory:path.join(d.root,'restored'),readerOwner:owner});
    assert.equal(f.writes.filter(key=>key.startsWith(receipt.root+'/')).length,before);
    assert.equal(f.objects.get(RAW_COORDINATION_KEY).claims.length,1,'the temporary read claim closes, the producer handoff stays protected');
    assert.equal(await fs.readFile(path.join(d.root,'restored','source-000001.jsonl'),'utf8'),d.data);
  } finally {await fs.rm(d.root,{recursive:true,force:true});}
});

test('archive resumes only exact sealed coordinator state after pin-ready persistence fails',async()=>{
  const f=await requiredFixture(),d=await directory(),write=f.storage.writeJson;
  f.storage.writeJson=async(key,value,condition)=>{
    if(key.startsWith('catalog/raw-feed-pins/')&&value.state==='ready')throw Error('pin_ready_write_failed');
    return write(key,value,condition);
  };
  try {
    await assert.rejects(archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'uae',owner}),/pin_ready_write_failed/);
    const root=intakeArchiveRoot('uae',owner),rawWrites=f.writes.filter(key=>key.startsWith(root+'/')).length;
    assert.equal(f.objects.get(RAW_COORDINATION_KEY).claims[0].phase,'ready');
    f.storage.writeJson=write;
    const receipt=await archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'uae',owner});
    assert.equal(f.writes.filter(key=>key.startsWith(root+'/')).length,rawWrites,'no raw byte is rewritten during sealed recovery');
    assert.equal(f.objects.get(receipt.handoff.key).state,'ready');
  } finally {await fs.rm(d.root,{recursive:true,force:true});}
});

test('each non-Japan intake is verified in own storage and restored byte-for-byte without source calls',async()=>{
  for(const market of ['china','korea','uae','europe','georgia']) {
    const f=storageFixture(),d=await directory(market);
    try {
      const receipt=await archiveIntakeDirectory({storage:f.storage,directory:d.input,market,owner});
      const target=path.join(d.root,'restored');
      const manifest=await verifyIntakeArchive({storage:f.storage,receipt,directory:target});
      assert.equal(await fs.readFile(path.join(target,'source-000001.jsonl'),'utf8'),d.data);
      assert.deepEqual(await fs.readFile(path.join(target,'report.json')),await fs.readFile(path.join(d.input,'report.json')));
      assert.equal(manifest.collection.complete,true);
      const before=f.writes.length;
      assert.deepEqual(await archiveIntakeDirectory({storage:f.storage,directory:d.input,market,owner}),receipt);
      assert.equal(f.writes.length,before,'a completed immutable archive is read-only');
      assert.ok(f.writes.every(k=>k.startsWith(receipt.root+'/')||k.startsWith('catalog/raw-feed-pins/v1/')));
      assert.ok(!f.writes.some(k=>/manifest\.json$|previous-manifest|offers\//.test(k)));
    } finally {await fs.rm(d.root,{recursive:true,force:true});}
  }
});

test('partial collection remains partial; complete archive is not a complete supplier claim',async()=>{
  const f=storageFixture(),d=await directory('europe',true);
  try {
    const receipt=await archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'europe',owner});
    const manifest=await verifyIntakeArchive({storage:f.storage,receipt});
    assert.deepEqual(manifest.collection,{complete:false,qualityStatus:'partial'});
    await fs.appendFile(path.join(d.input,'source-000001.jsonl'),'{}\n');
    await assert.rejects(archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'europe',owner}),/source_changed/);
  } finally {await fs.rm(d.root,{recursive:true,force:true});}
});

test('bounded multipart restoration preserves bytes across compression and part boundaries',async()=>{
  const f=storageFixture(),d=await directory();
  try {
    const bytes=Buffer.alloc(5*1024*1024+31);
    for(let offset=0;offset<bytes.length;offset++)bytes[offset]=33+(offset%90);
    await fs.writeFile(path.join(d.input,'source-000001.jsonl'),bytes);
    const receipt=await archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'uae',owner});
    const manifest=await verifyIntakeArchive({storage:f.storage,receipt,directory:path.join(d.root,'restored')});
    assert.equal(manifest.files.find((row:any)=>row.name.endsWith('.jsonl')).parts.length,3);
    assert.deepEqual(await fs.readFile(path.join(d.root,'restored','source-000001.jsonl')),bytes);
  } finally {await fs.rm(d.root,{recursive:true,force:true});}
});

test('missing, corrupt, substituted and unsafe storage groups cannot restore readiness',async()=>{
  const f=storageFixture(),d=await directory();
  try {
    const receipt=await archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'uae',owner});
    const manifest=f.objects.get(receipt.root+'/complete.json'),part=manifest.files.find((x:any)=>x.name.endsWith('.jsonl')).parts[0];
    const saved=f.objects.get(part.key);f.objects.delete(part.key);
    await assert.rejects(verifyIntakeArchive({storage:f.storage,receipt}),/part_wire/);
    f.objects.set(part.key,{...saved,sha256:'f'.repeat(64)});
    await assert.rejects(verifyIntakeArchive({storage:f.storage,receipt}),/part_wire/);
    f.objects.set(part.key,saved);
    await assert.rejects(verifyIntakeArchive({storage:f.storage,receipt:{...receipt,market:'japan'}}),/market/);
    const bad=structuredClone(manifest);bad.files[0].name='../escape.json';
    assert.throws(()=>validateIntakeArchive(bad,receipt.root,rawDigest(bad)),/archive_file/);
    const target=path.join(d.root,'not-empty');await fs.mkdir(target);await fs.writeFile(path.join(target,'existing'),'keep');
    await assert.rejects(verifyIntakeArchive({storage:f.storage,receipt,directory:target}),/restore_not_empty/);
    assert.equal(await fs.readFile(path.join(target,'existing'),'utf8'),'keep');
  } finally {await fs.rm(d.root,{recursive:true,force:true});}
});

test('failed or changed source writes never produce a locally usable receipt',async()=>{
  const f=storageFixture(),d=await directory(),write=f.storage.writeJson;
  f.storage.writeJson=async(key,value,condition)=>{if(key.includes('/files/'))throw Error('write_failed');return write(key,value,condition);};
  try {
    await assert.rejects(archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'uae',owner}),/write_failed/);
    assert.ok(!f.objects.has(intakeArchiveRoot('uae',owner)+'/complete.json'));
    await assert.rejects(fs.stat(path.join(d.input,INTAKE_ARCHIVE_RECEIPT)),{code:'ENOENT'});
    assert.equal([...f.objects.values()][0].state,'loading');
  } finally {await fs.rm(d.root,{recursive:true,force:true});}
});

test('new archives preserve the existing 1 TB / 200 GB reserve before any pin or object write',async()=>{
  const f=storageFixture(),d=await directory();
  f.storage.listBucketObjects=async()=>[{key:'existing',size:900_000_000_000}];
  try {
    await assert.rejects(archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'uae',owner}),/reserve_insufficient/);
    assert.equal(f.writes.length,0);
    f.storage.listBucketObjects=async()=>[{key:'existing',size:100_000_000_000}];
    const receipt=await archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'uae',owner});
    const count=f.writes.length;
    f.storage.listBucketObjects=async()=>{throw Error('must_not_request_capacity_for_read_only_reuse');};
    assert.deepEqual(await archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'uae',owner}),receipt);
    assert.equal(f.writes.length,count);
    const manifest=f.objects.get(receipt.root+'/complete.json'),oversize={...manifest,excess:'x'.repeat(2*1024*1024)};
    assert.throws(()=>validateIntakeArchive(oversize,receipt.root,rawDigest(oversize)),/manifest_bytes/);
  } finally {await fs.rm(d.root,{recursive:true,force:true});}
});

test('Japan, arbitrary files and symbolic links are rejected before archive writes',async()=>{
  assert.throws(()=>intakeArchiveRoot('japan',owner),/market/);
  const f=storageFixture(),d=await directory();
  try {
    await fs.symlink(path.join(d.input,'report.json'),path.join(d.input,'other-000002.jsonl'));
    await assert.rejects(archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'uae',owner}),/local_path/);
    assert.equal(f.writes.length,0);
  } finally {await fs.rm(d.root,{recursive:true,force:true});}
});

test('crash after ready or published pin but before a local receipt reuses immutable storage with zero writes',async()=>{
  for(const terminal of ['ready','published']) {
    const f=storageFixture(),d=await directory();
    try {
      const expected=await archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'uae',owner});
      await fs.unlink(path.join(d.input,INTAKE_ARCHIVE_RECEIPT));
      if(terminal==='published') {
        const pin=f.objects.get(expected.handoff.key);
        f.objects.set(expected.handoff.key,{...pin,state:'published',generationId:'gen_123_abc',terminalAt:pin.updatedAt});
      }
      const count=f.writes.length;
      const receipt=await archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'uae',owner});
      assert.deepEqual(receipt,expected);assert.equal(f.writes.length,count);
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(d.input,INTAKE_ARCHIVE_RECEIPT),'utf8')),receipt);
    } finally {await fs.rm(d.root,{recursive:true,force:true});}
  }
});

test('crash after complete but before ready can resume only its unchanged loading archive',async()=>{
  const f=storageFixture(),d=await directory(),write=f.storage.writeJson;
  f.storage.writeJson=async(key,value,condition)=>{if(value?.state==='ready')throw Error('crash_before_ready');return write(key,value,condition);};
  try {
    await assert.rejects(archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'uae',owner}),/crash_before_ready/);
    assert.ok(f.objects.has(intakeArchiveRoot('uae',owner)+'/complete.json'));
    f.storage.writeJson=write;
    const receipt=await archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'uae',owner});
    assert.equal(f.objects.get(receipt.handoff.key).state,'ready');
    await verifyIntakeArchive({storage:f.storage,receipt});
  } finally {await fs.rm(d.root,{recursive:true,force:true});}
});

test('receipt reaches actual conversion and published cursor without changing saved observations or report time',async()=>{
  const f=storageFixture(),d=await directory('europe');
  try {
    const receipt=await archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'europe',owner});
    const original=JSON.parse(await fs.readFile(path.join(d.input,'report.json'),'utf8'));
    const root=path.join(d.root,'restore');await fs.mkdir(root);
    await verifyIntakeArchive({storage:f.storage,receipt,directory:path.join(root,'catalog-intake-europe')});
    const out=path.join(d.root,'converted');
    execFileSync(process.execPath,['--import','tsx','scripts/catalog-intake-to-publication.mjs'],{
      env:{...process.env,CATALOG_INTAKE_INPUT_DIR:root,CATALOG_REBUILD_INPUT_DIR:out},stdio:'pipe'});
    const converted=JSON.parse(await fs.readFile(path.join(out,'catalog-rebuild-europe-0001.json'),'utf8'));
    assert.equal(converted.offers[0].sourcePrice,12345);
    assert.deepEqual(converted.report.durableIntakeArchive,receipt);
    assert.equal(converted.report.completedAt,original.completedAt);
    const saved=publishedIntakeCheckpoint(attachIntakeArchiveReceipt(original,receipt),{market:'europe',published:true,generationId:'gen_200_abc'});
    assert.deepEqual(saved.durableIntakeArchive,receipt);assert.equal(saved.updatedAt,original.completedAt);
    assert.deepEqual(saved.rawStoragePins,[receipt.handoff]);
    assert.throws(()=>attachIntakeArchiveReceipt({...original,completedAt:'2026-11-17T00:00:00Z'},receipt),/report_changed/);
    assert.throws(()=>publishedIntakeCheckpoint({...original,mode:'saved_snapshot_technical_repair'},
      {market:'europe',published:true,generationId:'gen_201_abc'}),/must_not_advance_cursor/);
  } finally {await fs.rm(d.root,{recursive:true,force:true});}
});

test('generic parsed page is saved before normalization and failed archive leaves its cursor unmoved',async()=>{
  for(const failed of [false,true]) {
    const events=[],raw={id:'one',market:'europe',sourceId:'mobile_de',year:2024,unrecognised:'kept'},saved=[];
    const adapter={fetchPage:async()=>{events.push('request');return {items:[raw],nextCursor:'next'};},
      normalizeOffer:row=>{events.push('normalize');row.unrecognised='changed';return row;},fetchImages:async()=>[]};
    const state=intakeState(adapter,{sourceId:'mobile_de'});
    const collect=()=>collectSourcePage(state,{market:'europe',deadline:Date.now()+10000,maxRows:10,maxPages:10,minYear:2020,
      archivePage:async page=>{events.push('archive');if(failed)throw Error('archive_failed');saved.push(structuredClone(page));},
      snapshot:offer=>({offer}),writeObservation:async()=>{},checkpoint:async()=>{}});
    if(failed) {await assert.rejects(collect(),/archive_failed/);assert.equal(state.cursor,null);assert.equal(state.pages,0);}
    else {await collect();assert.equal(saved[0].items[0].unrecognised,'kept');assert.equal(state.cursor,'next');}
    assert.deepEqual(events.slice(0,2),['request','archive']);assert.equal(events.includes('normalize'),!failed);
  }
});

test('Dubicars capture keeps the complete parsed response and never adds provider calls or request credentials',async()=>{
  const events=[],saved=[],response={result:[{id:7,unmapped:'retained'}],meta:{page:1},unknown:{field:true}};
  const request=captureDubicarsResponses(async(endpoint,params)=>{events.push({endpoint,params});return response;},async row=>saved.push(structuredClone(row)),
    {now:()=> '2026-11-16T12:00:00Z'});
  assert.equal(await request('offers',{page:1,api_key:'private',headers:{authorization:'private'},url:'https://private.invalid'}),response);
  assert.equal(events.length,1);assert.deepEqual(saved[0].payload,response);assert.deepEqual(saved[0].params,{page:1});
  assert.ok(!JSON.stringify(saved).includes('private'));
  const bad=captureDubicarsResponses(async()=>{events.push('one-more');return response;},async()=>{throw Error('archive_failed');});
  await assert.rejects(bad('offers',{page:2}),/archive_failed/);assert.equal(events.length,2);
  const prior={market:'uae',sources:[{sourceId:'dubizzle_uae_open'},{sourceId:'carswitch_uae_open'}]};
  assertDubicarsPriorIntake(['report.json','dubizzle_uae_open-000001.jsonl','raw-carswitch_uae_open-000001.jsonl'],prior);
  assert.throws(()=>assertDubicarsPriorIntake(['report.json','raw-foreign-000001.jsonl'],prior),/output_not_empty/);
});

const publicationManifest=(n,markets={})=>({version:2,generationId:`gen_${100+n}_archive${n}`,markets});
const emptyPaid=manifest=>({generationId:manifest.generationId,manifestSha256:rawDigest(manifest),market:'korea',count:0,paidCount:0,chunkProofs:[],observations:[],references:[]});

test('v2 covers five markets, derives mandatory archive roots and refuses to promote legacy v1 missing-market provenance',async()=>{
  const f=storageFixture(),d=await directory('europe',true);
  try {
    const receipt=await archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'europe',owner});
    const intake=attachIntakeArchiveReceipt(JSON.parse(await fs.readFile(path.join(d.input,'report.json'),'utf8')),receipt);
    const manifest=publicationManifest(1,{europe:{count:1,chunks:['chunk-1']}}),sources=intakeRawReferences(intake);
    assert.equal(sources.complete,true,'all observed input is archived even when source traversal remains partial');
    sources.references=[];
    const value=buildRawGenerationProvenance({manifest,marketSources:{europe:sources},paidReports:emptyPaid(manifest)});
    assert.equal(value.version,2);assert.deepEqual(Object.keys(value.markets),RAW_TRACKED_MARKETS);
    assert.equal(value.markets.europe.references[0].root,receipt.root);
    const bad=structuredClone(value);bad.markets.europe.references=[];
    assert.throws(()=>assertRawGenerationProvenance(bad,manifest),/inconsistent/);
    const legacy=buildRawGenerationProvenance({manifest,paidReports:emptyPaid(manifest),schemaVersion:1});
    assert.equal(legacy.complete,true,'historical schema only knew China and Korea');
    assertRawGenerationProvenance(legacy,manifest,{requireComplete:false});
    assert.throws(()=>assertRawGenerationProvenance(legacy,manifest),/missing_or_unknown/);
    const plan=planRawFeedRetention({inventory:{complete:true,prefixes:Object.values(RAW_PREFIXES),objects:[]},
      pinInventory:{complete:true,pins:[]},cursorInventory:{complete:true,references:[]},producerProtocolComplete:true,
      currentManifest:manifest,previousManifest:manifest,currentProvenance:legacy,previousProvenance:legacy});
    assert.equal(plan.summary.status,'protected_unknown');assert.deepEqual(plan.selected,[]);
  } finally {await fs.rm(d.root,{recursive:true,force:true});}
});

test('publication retains prior target and borrowed-market archive dependencies and does not turn historic unknown into complete',async()=>{
  const f=storageFixture(),first=await directory('europe'),second=await directory('europe');
  try {
    const receipt1=await archiveIntakeDirectory({storage:f.storage,directory:first.input,market:'europe',owner});
    const receipt2=await archiveIntakeDirectory({storage:f.storage,directory:second.input,market:'europe',owner:{...owner,runId:'123457'}});
    const report=async(d,receipt)=>attachIntakeArchiveReceipt(JSON.parse(await fs.readFile(path.join(d.input,'report.json'),'utf8')),receipt);
    const manifest1=publicationManifest(1,{europe:{count:1,chunks:['chunk-1']}});
    const stage1=await prepareRawPublication({storage:f.storage,manifest:manifest1,expectedBaseGenerationId:'empty',market:'europe',intake:await report(first,receipt1)});
    await stage1.verify();await f.storage.writeJson('catalog/manifest.json',manifest1,undefined);await stage1.releasePins();
    const manifest2=publicationManifest(2,{europe:{count:2,chunks:['catalog/generations/'+manifest1.generationId+'/offers/europe/chunk-1.json','chunk-2']}});
    const stage2=await prepareRawPublication({storage:f.storage,manifest:manifest2,expectedBaseGenerationId:manifest1.generationId,market:'europe',intake:await report(second,receipt2)});
    await stage2.verify();
    const proof=f.objects.get(rawGenerationKey(manifest2.generationId));
    assert.deepEqual(proof.markets.europe.references.map(row=>row.root).sort(),[receipt1.root,receipt2.root].sort());
    assert.equal(proof.complete,true);
    await f.storage.writeJson('catalog/manifest.json',manifest2,undefined);
    const manifest3=publicationManifest(3,manifest2.markets);
    await prepareRawPublication({storage:f.storage,manifest:manifest3,expectedBaseGenerationId:manifest2.generationId,market:'uae',intake:null});
    assert.deepEqual(f.objects.get(rawGenerationKey(manifest3.generationId)).markets.europe.references,proof.markets.europe.references);
    f.objects.delete(rawGenerationKey(manifest2.generationId));
    const unknown=publicationManifest(4,manifest2.markets);
    await prepareRawPublication({storage:f.storage,manifest:unknown,expectedBaseGenerationId:manifest2.generationId,market:'europe',intake:await report(second,receipt2)});
    const unknownProof=f.objects.get(rawGenerationKey(unknown.generationId));
    assert.equal(unknownProof.complete,false);assert.ok(unknownProof.markets.europe.unknownSources.includes('historic_provenance_missing'));
    assert.ok(unknownProof.markets.europe.references.some(row=>row.root===receipt2.root));
  } finally {await fs.rm(first.root,{recursive:true,force:true});await fs.rm(second.root,{recursive:true,force:true});}
});

test('whole-group planner recognises bounded generic archives and keeps missing-part groups unproven',async()=>{
  const f=storageFixture(),d=await directory('europe');
  try {
    const receipts=[];
    for(let i=0;i<3;i++) {
      await fs.rm(path.join(d.input,INTAKE_ARCHIVE_RECEIPT),{force:true});
      receipts.push(await archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'europe',owner:{...owner,runId:String(120+i)}}));
    }
    const rawObjects=[],receiptMap={};
    for(const [index,receipt] of receipts.entries()) {
      const complete=f.objects.get(receipt.root+'/complete.json');receiptMap[receipt.root]=complete;
      for(const [key,value] of f.objects)if(key.startsWith(receipt.root+'/'))rawObjects.push({key,size:Buffer.byteLength(JSON.stringify(value)),lastModified:`2026-01-0${index+1}T00:00:00Z`});
    }
    const current=publicationManifest(1),previous=publicationManifest(2);
    const config={inventory:{complete:true,prefixes:Object.values(RAW_PREFIXES),objects:rawObjects,receipts:receiptMap},
      pinInventory:{complete:true,pins:[]},cursorInventory:{complete:true,references:[]},producerProtocolComplete:true,
      currentManifest:current,previousManifest:previous,
      currentProvenance:buildRawGenerationProvenance({manifest:current,paidReports:emptyPaid(current)}),
      previousProvenance:buildRawGenerationProvenance({manifest:previous,paidReports:emptyPaid(previous)}),now:Date.parse('2026-11-16T12:00:00Z')};
    const ready=planRawFeedRetention(config);
    assert.deepEqual(ready.summary.selectedGroups,[receipts[0].root]);
    assert.ok(ready.selected.every(row=>row.root===receipts[0].root));
    const missing=structuredClone(config);missing.inventory.objects=rawObjects.filter(row=>row.key!==receiptMap[receipts[0].root].files[0].parts[0].key);
    const blocked=planRawFeedRetention(missing);assert.equal(blocked.selected.length,0);assert.ok(blocked.summary.unprovenRoots.includes(receipts[0].root));
  } finally {await fs.rm(d.root,{recursive:true,force:true});}
});

test('large China withdrawal report uses bounded parts and round trips without widening observation limits', async t => {
  const f=storageFixture(),d=await directory('china'); t.after(()=>fs.rm(d.root,{recursive:true,force:true}));
  const report={version:1,market:'china',completed:true,sources:[],confirmedWithdrawals:'x'.repeat(40*1024*1024)};
  const bytes=Buffer.from(JSON.stringify(report)); await fs.writeFile(path.join(d.input,'report.json'),bytes);
  const receipt=await archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'china',owner});
  const manifest=f.objects.get(receipt.root+'/complete.json'),entry=manifest.files.find(row=>row.name==='report.json');
  assert.equal(entry.bytes,bytes.length); assert.ok(entry.parts.length>16); assert.ok(entry.parts.every(part=>part.bytes<=2*1024*1024));
  await verifyIntakeArchive({storage:f.storage,receipt,directory:path.join(d.root,'restored'),readerOwner:owner});
  assert.deepEqual(await fs.readFile(path.join(d.root,'restored','report.json')),bytes);
});

test('oversized reports and observation shards fail closed with actionable sizes before storage writes', async t => {
  for(const [name,limit] of [['report.json',128*1024*1024],['source-000001.jsonl',32*1024*1024]] as const){
    const f=storageFixture(),d=await directory('china'); t.after(()=>fs.rm(d.root,{recursive:true,force:true}));
    await fs.truncate(path.join(d.input,name),limit+1);
    await assert.rejects(()=>archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'china',owner}),new RegExp(`intake_archive_local_size:name=${name}:actual=${limit+1}:maximum=${limit}`));
    assert.equal(f.writes.length,0);
  }
});

test('saved China incident report archives and restores byte-for-byte when supplied', {skip:!process.env.CHINA_INCIDENT_REPORT}, async t=>{
  const f=storageFixture(),d=await directory('china'); t.after(()=>fs.rm(d.root,{recursive:true,force:true}));
  const bytes=await fs.readFile(process.env.CHINA_INCIDENT_REPORT!); assert.ok(bytes.length>32*1024*1024);
  await fs.writeFile(path.join(d.input,'report.json'),bytes);
  const receipt=await archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'china',owner});
  await verifyIntakeArchive({storage:f.storage,receipt,directory:path.join(d.root,'restored'),readerOwner:owner});
  assert.deepEqual(await fs.readFile(path.join(d.root,'restored','report.json')),bytes);
  const part=f.objects.get(receipt.root+'/complete.json').files.find(row=>row.name==='report.json').parts[0];
  f.objects.get(part.key).sha256='0'.repeat(64);
  await assert.rejects(()=>verifyIntakeArchive({storage:f.storage,receipt,readerOwner:owner}),/intake_archive_part_wire/);
});

test('saved China missing optional witness retains ancestry under required raw coordination', {skip:!process.env.CHINA_INCIDENT_REPORT}, async()=>{
 const report=JSON.parse(await fs.readFile(process.env.CHINA_INCIDENT_REPORT!,'utf8'));
 assert.equal(report.sourceInputWitness,undefined);
 assert.equal(report.sourceInputWitnessUnavailable,'che168_replica_witness_local_file_size');
 const {prepareChe168InternalContribution,prepareChe168PublicContribution}=await import('../scripts/lib/catalog-che168-contributions.mjs');
 const {prepareRawInternalPublication}=await import('../scripts/lib/catalog-raw-internal-publication.mjs');
 const f=await requiredFixture();
 assert.equal(await prepareChe168InternalContribution({storage:f.storage,manifest:null,contributions:null}),null);
 assert.equal(await prepareChe168PublicContribution({storage:f.storage,manifest:null,contributions:null}),null);
 const refs=intakeRawReferences(report).references;
 assert.ok(refs.some(r=>r.kind==='che168-snapshot')&&refs.some(r=>r.kind==='che168-journal'));
 assert.equal(refs.filter(r=>r.kind==='che168-replica').length,2);
 const internal={version:1,generationId:'gen_12345678_abc12345',updatedAt:new Date().toISOString(),sources:{autohome_used_china_open:{count:288619,chunks:['catalog/internal/offers/autohome_used_china_open/china-1.json']}}};
 const staged=await prepareRawInternalPublication({storage:f.storage,manifest:internal,baseManifest:null,intake:report,owner,operationId:'saved-china-required-test'});
 assert.ok(staged.ticket,'required raw gate remains active');
 for(const r of refs) assert.ok(staged.provenance.references.some(x=>x.root===r.root));
 await staged.verifyBeforeCommit();
 const manifest=publicationManifest(10,{china:{count:288619,chunks:['china-part']}});
 const published=await prepareRawPublication({storage:f.storage,manifest,expectedBaseGenerationId:'empty',market:'china',intake:report,owner,operationId:'saved-china-public-test'});
 assert.ok(published.binding,'required public reservation remains active');
 await published.verify();
 const proof=f.objects.get(rawGenerationKey(manifest.generationId));
 for(const r of refs)assert.ok(proof.markets.china.references.some(x=>x.root===r.root));
 assert.equal(report.sourceInputWitness,undefined,'never fabricates a producer witness');
});

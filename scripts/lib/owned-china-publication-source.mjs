import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {RAW_PIN_PREFIX,rawDigest,rawProducerOwner} from './catalog-raw-provenance.mjs';
import {validateIntakeArchive,receiptFromReadyPin,verifyIntakeArchive,readIntakeArchiveManifest,
  attachIntakeArchiveReceipt} from './nonjp-intake-archive.mjs';
import {classifyChinaRefresh,verifyOwnedChinaDownload} from './owned-china-verification.mjs';

export const OWNED_CHINA_PREPARED = 'catalog/owned-feed/v1/china/prepared.json';
export const OWNED_CHINA_PUBLIC_CONTROL = 'catalog/independent-market-public-v1/china/control.json';
const REPOSITORY_ID=1289722938, REPOSITORY='jeep-jim/AvtoCena';
const HASH=/^[a-f0-9]{64}$/, RUN=/^[1-9]\d{0,19}$/, GEN=/^gen_\d{13}_[a-z0-9]{1,64}$/;
// Existing China daily contract: daily-core.mjs decideTerminal uses the
// supplier terminal clock + 2 days; rev5-successor-core strictSource caps 48h.
// A later materialization/report clock never starts a new freshness window.
const MAX_SOURCE_AGE_MS=48*3600_000;
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const opaque=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\r\n]/.test(value);
const equal=(a,b,code)=>assert.equal(rawDigest(a),rawDigest(b),code);

async function convertedShard(directory,name){
  assert(/^catalog-rebuild-china-[0-9]{4,}\.json$/.test(name),'owned_china_conversion_path');
  const filename=path.join(directory,name),stat=await fs.lstat(filename);
  assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0,'owned_china_conversion_file');
  const bytes=await fs.readFile(filename);
  assert(bytes.length===stat.size,'owned_china_conversion_file_changed');
  const value=JSON.parse(bytes);
  assert(value.market==='china'&&Array.isArray(value.offers)&&value.count===value.offers.length&&
    value.offers.length>0&&value.offers.length<=500&&value.offers.every(row=>row?.market==='china'&&typeof row.id==='string'&&row.id),
    'owned_china_conversion_shard');
  return {entry:{name,bytes:bytes.length,sha256:digest(bytes),rows:value.offers.length},value};
}

function preparedHead(meta){
  const value=meta?.value;
  assert(meta?.found===true&&opaque(meta.etag)&&value?.version===1&&value.market==='china'&&RUN.test(value.runId??'')&&
    value.rateRun===value.runId&&integer(value.cursor)&&Number.isSafeInteger(value.observations)&&value.observations>0&&
    value.observations<=1_000_000&&HASH.test(value.archiveSha256??'')&&
    /^catalog\/nonjp-intake\/v1\/china\/[1-9]\d{0,19}\/[1-9]\d{0,5}$/.test(value.archiveRoot??''),
    'owned_china_prepared_identity');
  return structuredClone(value);
}

function publicTarget(value){
  if(!value||Object.keys(value).length!==3||!GEN.test(value.generationId??''))return false;
  return value.kind==='legacy-unmodified'?HASH.test(value.manifestSha256??''):
    /^[a-z0-9][a-z0-9-]{4,63}$/.test(value.runId??'')&&HASH.test(value.readySha256??'');
}

/** Capture actual control bytes plus opaque ETag; equal content with a changed
 * ETag is still a changed authority. No global catalogue pointer is read. */
export async function captureOwnedChinaControl(storage){
  const before=await storage.readJsonWithMeta(OWNED_CHINA_PUBLIC_CONTROL,null);
  assert(before?.found===true&&opaque(before.etag),'owned_china_control_missing');
  const object=await storage.getBinary(OWNED_CHINA_PUBLIC_CONTROL);
  assert(Buffer.isBuffer(object?.data)&&object.data.length>0&&object.data.length<=64*1024,
    'owned_china_control_bytes');
  const checksum=digest(object.data),state=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(object.data));
  assert((object.checksum===undefined||object.checksum===checksum)&&state?.version===1&&state.market==='china'&&
    Number.isSafeInteger(state.revision)&&state.revision>0&&publicTarget(state.active)&&
    (state.previous===null||publicTarget(state.previous)&&state.previous.generationId!==state.active.generationId),
    'owned_china_control_identity');
  equal(before.value,state,'owned_china_control_readback');
  const after=await storage.readJsonWithMeta(OWNED_CHINA_PUBLIC_CONTROL,null);
  assert(after?.found===true&&after.etag===before.etag,'owned_china_control_changed');
  equal(after.value,state,'owned_china_control_changed');
  return {key:OWNED_CHINA_PUBLIC_CONTROL,etag:before.etag,sha256:checksum,
    activeSha256:rawDigest(state.active),state};
}

/** readActions must fetch authenticated official GitHub REST metadata, not
 * return caller-authored attestations. Its paths are fixed to this repository. */
async function officialOwner(readActions,owner,operation){
  rawProducerOwner({GITHUB_RUN_ID:owner?.runId,GITHUB_RUN_ATTEMPT:owner?.attempt,GITHUB_SHA:owner?.revision});
  const run=await readActions(`runs/${owner.runId}`);
  const jobs=await readActions(`runs/${owner.runId}/attempts/${owner.attempt}/jobs?per_page=100`);
  assert(run?.repository?.id===REPOSITORY_ID&&run.repository.full_name===REPOSITORY&&run.head_repository?.id===REPOSITORY_ID&&
    String(run.id)===owner.runId&&String(run.run_attempt)===owner.attempt&&run.head_sha===owner.revision&&
    run.head_branch==='main'&&run.status==='completed'&&run.conclusion==='success','owned_china_producer_identity');
  if(operation==='download')assert(classifyChinaRefresh(run,jobs,run)==='mirror','owned_china_source_not_mirror');
  else assert(run.path==='.github/workflows/catalog-prepare-owned-china.yml'&&
    ['workflow_run','workflow_dispatch','push'].includes(run.event)&&jobs?.total_count===1&&jobs.jobs?.length===1&&
    jobs.jobs[0].name==='prepare'&&jobs.jobs[0].run_id===run.id&&jobs.jobs[0].head_sha===run.head_sha&&
    jobs.jobs[0].status==='completed'&&jobs.jobs[0].conclusion==='success','owned_china_prepare_authority');
  return {runId:owner.runId,attempt:owner.attempt,revision:owner.revision,workflow:run.path};
}

function sourceReport(report,head,download,cut,clock){
  const rows=report?.sources;
  assert(report?.version===1&&report.market==='china'&&report.provider==='auto_api_che168'&&report.completed===true&&
    !report.partial&&!report.failure&&Array.isArray(rows)&&rows.length===1,
    'owned_china_report_complete');
  const source=rows[0];
  assert(source.sourceId==='autohome_used_china_open'&&source.provider==='auto_api_che168'&&
    source.ownedFeedRun===head.runId&&source.completeInventory===true&&source.stopReason==='source_finished'&&
    source.rejectedIdentity===0&&!source.partial&&!source.failure&&
    source.initialCursor===download.startCursor&&source.cursor===head.cursor&&source.cursor===download.cursor&&
    source.changes===download.sourceEvents&&source.observations===head.observations&&source.uniqueOffers===head.observations&&
    HASH.test(source.snapshotBinding??'')&&source.replica?.binding===source.snapshotBinding&&
    source.replica.cursor===source.cursor&&HASH.test(source.replica.sha256??'')&&
    /^catalog\/provider-replicas\/che168\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(source.replica.key??''),
    'owned_china_report_lineage');
  const observedAt=Date.parse(download.sourceObservedAt),completedAt=Date.parse(report.completedAt),now=clock();
  const maximumValidUntil=observedAt+MAX_SOURCE_AGE_MS,deadlines=[];
  // Honour any shorter deadline already sealed in the source cut/report.
  // These fields are optional in today's owned-cut schema, never renewed here.
  for(const [field,value] of [['cut.source.validUntil',cut.source?.validUntil],['cut.sourceExpiresAt',cut.sourceExpiresAt],
    ['report.sources[0].validUntil',source.validUntil],['report.sourceExpiresAt',report.sourceExpiresAt]]){
    if(value===undefined)continue;
    const until=typeof value==='string'?Date.parse(value):value;
    assert(Number.isSafeInteger(until)&&until>observedAt,'owned_china_source_deadline');deadlines.push({field,validUntil:until});
  }
  const validUntil=Math.min(maximumValidUntil,...deadlines.map(row=>row.validUntil));
  assert(Number.isSafeInteger(now)&&now>0&&Number.isSafeInteger(observedAt)&&observedAt>0&&
    observedAt<=now&&Number.isFinite(completedAt)&&completedAt>=observedAt&&completedAt<=now&&now<validUntil,
    'owned_china_source_stale');
  const withdrawals=report.confirmedWithdrawals,ids=new Set();
  assert(Array.isArray(withdrawals)&&withdrawals.length<=download.sourceEvents,'owned_china_report_withdrawals');
  for(const row of withdrawals){
    assert(row?.sourceId===source.sourceId&&row.market==='china'&&row.status==='removed'&&
      typeof row.sourceOfferId==='string'&&/^\d{1,32}$/.test(row.sourceOfferId)&&
      row.id===digest(source.sourceId+':'+row.sourceOfferId).slice(0,24)&&!ids.has(row.id)&&
      Number.isFinite(Date.parse(row.observedAt))&&Date.parse(row.observedAt)<=completedAt,'owned_china_report_withdrawals');
    ids.add(row.id);
  }
  return {source,observedAt,validUntil,freshness:{policy:'che168-terminal-max-48h',maximumValidUntil,deadlines},
    withdrawals:{records:withdrawals.length,uniqueIds:ids.size,sha256:rawDigest(withdrawals),
      coverage:'reported_removal_events',publicRetirementVerified:false}};
}

async function replicaDescriptor(storage,source,readerOwner){
  const {withRawReadProtection}=await import('./catalog-raw-session.mjs');
  return withRawReadProtection({storage,owner:readerOwner,
    references:[{kind:'che168-replica',root:source.replica.key,sha256:source.replica.sha256}],read:async scoped=>{
      const manifest=await scoped.readJson(source.replica.key+'/manifest.json',null),chunk=16*1024**2;
      // Same manifest bounds as CHE168_REPLICA_WITNESS_LIMITS. This binds the
      // immutable replica generation; its full SQLite readback remains a gate.
      assert(manifest?.version===1&&rawDigest(manifest)===source.replica.sha256&&manifest.binding===source.snapshotBinding&&
        manifest.cursor===source.cursor&&integer(manifest.bytes)&&manifest.bytes>0&&manifest.bytes<=16*1024**3&&
        Array.isArray(manifest.parts)&&manifest.parts.length>0&&manifest.parts.length<=1024&&
        manifest.parts.length===Math.ceil(manifest.bytes/chunk)&&manifest.parts.every((part,index)=>
          part?.bytes===Math.min(chunk,manifest.bytes-index*chunk)&&HASH.test(part.sha256??'')),
        'owned_china_replica_manifest');
      return {...source.replica,bytes:manifest.bytes,parts:manifest.parts.length,inventoryReadbackVerified:false};
    }});
}

/** Restore/convert exactly one independently authenticated saved China intake.
 * This returns an input plan, not a staging seal or permission to publish.
 * The archive verifier keeps the existing raw read/retention coordination.
 * Only private read claims may write to storage; no publication/cursor writes. */
export async function prepareOwnedChinaPublicationSource({storage,readActions,downloadOwner,readerOwner,directory,outputDirectory,clock=Date.now}){
  assert(storage?.driver==='object'&&typeof storage.getBinary==='function'&&typeof readActions==='function'&&
    typeof directory==='string'&&typeof outputDirectory==='string'&&path.resolve(directory)!==path.resolve(outputDirectory),
    'owned_china_adapter_configuration');
  rawProducerOwner({GITHUB_RUN_ID:readerOwner?.runId,GITHUB_RUN_ATTEMPT:readerOwner?.attempt,GITHUB_SHA:readerOwner?.revision});
  const captured=await storage.readJsonWithMeta(OWNED_CHINA_PREPARED,null),head=preparedHead(captured);
  const control=await captureOwnedChinaControl(storage);
  const manifest=validateIntakeArchive(await storage.readJson(head.archiveRoot+'/complete.json',null),head.archiveRoot,head.archiveSha256);
  assert(manifest.collection.complete===true,'owned_china_archive_incomplete');
  const producer=await officialOwner(readActions,manifest.owner,'prepare');
  const downloader=await officialOwner(readActions,downloadOwner,'download');
  const download=await verifyOwnedChinaDownload(storage,{runId:downloader.runId,attempt:downloader.attempt,producerSha:downloader.revision});
  assert(download.sourceRunId===head.runId&&download.cursor===head.cursor,'owned_china_download_lineage');
  const pinKey=RAW_PIN_PREFIX+`nonjp-intake-china-${manifest.owner.runId}-${manifest.owner.attempt}.json`;
  const receipt=receiptFromReadyPin({market:'china',owner:manifest.owner,root:head.archiveRoot,manifest,
    pin:await storage.readJson(pinKey,null)});
  await fs.mkdir(outputDirectory,{recursive:true});
  assert((await fs.readdir(outputDirectory)).length===0,'owned_china_output_not_empty');
  await verifyIntakeArchive({storage,receipt,directory,readerOwner});
  const report=JSON.parse(await fs.readFile(path.join(directory,'report.json'),'utf8'));
  const attached=attachIntakeArchiveReceipt(report,receipt);
  const attachedSha256=rawDigest(attached);
  const ratesKey=`catalog/feed-rates/v1/china/${head.rateRun}.json`,rates=await storage.readJson(ratesKey,null);
  assert(rawDigest(rates)===download.rateSnapshotSha256,'owned_china_frozen_rates_changed');
  const cut=await storage.readJson(`catalog/owned-feed/v1/china/runs/${head.runId}/complete.json`,null);
  assert(rawDigest(cut)===download.completeSha256,'owned_china_download_changed');
  const {source,observedAt,validUntil,freshness,withdrawals}=sourceReport(report,head,download,cut,clock);
  const replica=await replicaDescriptor(storage,source,readerOwner);
  assert(manifest.files.filter(file=>file.name.endsWith('.jsonl')).every(file=>
    new RegExp('^'+source.sourceId+'-[0-9]{6,}\\.jsonl$').test(file.name)),'owned_china_source_files');
  const {convertMarketOnDisk}=await import('./catalog-disk-conversion.mjs');
  const conversion=await convertMarketOnDisk({market:'china',directory,files:manifest.files.map(file=>file.name),out:outputDirectory,report:attached});
  assert(conversion.uniqueObservations===head.observations&&conversion.shards>0,'owned_china_conversion_census');
  const converted=[];
  for(const name of (await fs.readdir(outputDirectory)).sort())converted.push((await convertedShard(outputDirectory,name)).entry);
  assert(converted.length===conversion.shards&&converted.reduce((sum,file)=>sum+file.rows,0)===head.observations,
    'owned_china_conversion_census');
  const evidence={version:1,kind:'owned-china-source-evidence-v1',producer,downloader,
    prepared:{...head,etag:captured.etag},download,archive:{root:receipt.root,manifestSha256:receipt.manifestSha256,
      reportSha256:receipt.reportDigest,owner:receipt.owner,handoffSha256:rawDigest(receipt.handoff)},
    rateSnapshot:{key:ratesKey,sha256:rawDigest(rates)},freshness,replica,withdrawals};
  const plan={version:1,kind:'owned-china-publication-input-plan-v1',market:'china',verifiedInput:true,
    publicationAuthorized:false,activationReady:false,cursorAdvanceAuthorized:false,
    control,source:{receiptSha256:rawDigest(evidence),observedAt,validUntil,
      cursor:{stream:'che168',sequence:source.cursor,anchorSha256:source.replica.sha256}},
    sourceArchiveRows:head.observations,sourceArchiveShards:manifest.files.filter(file=>file.name.endsWith('.jsonl')).length,
    conversion,converted,evidence,requiredNext:['native-independent-lease-and-incumbent-cursor',
      'native-full-active-snapshot-and-retirement-proof','frozen-rate-price-replay-and-private-seal',
      'prepared-card-and-filter-readback','native-runtime-private-preview','unchanged-control-etag-before-cas']};
  const seal=rawDigest(plan);
  const assertCurrent=async()=>{
    assert(rawDigest(plan)===seal,'owned_china_plan_changed');
    assert(rawDigest(attached)===attachedSha256,'owned_china_report_changed');
    const now=clock();assert(Number.isSafeInteger(now)&&now>=observedAt&&now<validUntil,'owned_china_source_stale');
    const current=await storage.readJsonWithMeta(OWNED_CHINA_PREPARED,null);preparedHead(current);
    assert(current.etag===captured.etag,'owned_china_prepared_changed');equal(current.value,head,'owned_china_prepared_changed');
    const publicState=await captureOwnedChinaControl(storage);equal(publicState,control,'owned_china_control_changed');
    await officialOwner(readActions,manifest.owner,'prepare');await officialOwner(readActions,downloadOwner,'download');
    const verified=await readIntakeArchiveManifest({storage,receipt,readerOwner});equal(verified,manifest,'owned_china_archive_changed');
    equal(await replicaDescriptor(storage,source,readerOwner),replica,'owned_china_replica_changed');
    assert(rawDigest(await storage.readJson(ratesKey,null))===evidence.rateSnapshot.sha256,'owned_china_frozen_rates_changed');
    assert(rawDigest(rates)===evidence.rateSnapshot.sha256,'owned_china_frozen_rates_changed');
    assert(rawDigest(await storage.readJson(`catalog/owned-feed/v1/china/runs/${head.runId}/complete.json`,null))===download.completeSha256,
      'owned_china_download_changed');
  };
  await assertCurrent();
  // The price builder may stream this repeatedly. Each consumed shard is tied
  // to the verified archive conversion; edited local JSON never becomes input.
  const chunks=async function*(){
    await assertCurrent();let count=0;
    for(const expected of converted){
      const {entry,value}=await convertedShard(outputDirectory,expected.name);
      equal(entry,expected,'owned_china_conversion_changed');count+=entry.rows;
      yield value.offers;
    }
    assert(count===head.observations,'owned_china_conversion_census');await assertCurrent();
  };
  return {plan,planSha256:seal,receipt,report:attached,rates,conversion,directory,outputDirectory,chunks,assertCurrent};
}

import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {guard as need,digest,REV5,OLD_BASE,RELEASE,CALC} from '../rev5-successor-core.mjs';
import {EXACT,EXACT_PARTIAL_SHA,deriveReadPlan,exactProducerReadPlan} from '../terminal-native-intake-local.mjs';
import {LINKED_PRODUCER,authenticateCompletedSource} from './scoped-runtime.mjs';
import {reconcileVerifiedV3,makeFixedReader,exact as archiveExact} from './archive-readonly-reconcile.mjs';
import {createArchivePhaseMeter} from './archive-diagnostics.mjs';
const H=/^[a-f0-9]{64}$/,M=1024**2,G=1024**3;
const sha=b=>createHash('sha256').update(b).digest('hex'),json=b=>JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(b));
export const VERIFIED_ARCHIVE=Object.freeze({
 observerRun:'44868906428',observerJob:'136738751232',observerHead:'4e0a1c50d510009b458767f7f514d079989b3a1a',
 previousOwner:{runId:'44866682279',attempt:'1',revision:'8e4edcd606b0ee70b9a9f90d30f795f84ef43950'},
 archiveManifestSha256:'c438e8f3476783d0e0d0b567199f635e40c3089eff8806ca2f2d6c54c482cb46',
 reportSha256:'4bd587f31c60d8f31c3a8a32b6df4f4eaf51a04e26896e1682271571509601bc',files:575,parts:1723,totalBytes:2688516745,reportBytes:4629047,
 pinReadyAt:'2026-11-21T04:52:21.790Z',pinRefs:8,terminalCursor:13196544,observations:286546,confirmedRemoved:25707,
});
const equal=(a,b)=>digest(a)===digest(b);
const rawPolicy='catalog/raw-feed-coordination/v1/policy.json',rawState='catalog/raw-feed-coordination/v1/state.json';
export async function validateSourceTerminalMetadata({storage,producer,first,token,fetchImpl,expires,assertLive}){
 const official=await authenticateCompletedSource(producer,{token,fetchImpl,expires});
 const [p0,p1]=await Promise.all([authenticateCompletedSource(first,{token,fetchImpl,expires}),
  authenticateCompletedSource(LINKED_PRODUCER,{token,fetchImpl,expires})]);
 let metadataReads=0;
 const get=async k=>{
  need(++metadataReads<=6&&Date.now()<expires,'source_terminal_metadata_limit');await assertLive();
  const x=await storage.getBinaryBounded(k,32*1024);
  need(x.data.length<=32*1024&&sha(x.data)===x.checksum,'exact_private_metadata_wire');return json(x.data);
 };
 const immutable=(x,h,kind,g)=>{
  need(x?.sha256===h&&digest(x.record)===h&&x.record.kind===kind&&x.record.genesisSha256===g,'immutable_terminal_authority');
  return x.record;
 };
 const fp=exactProducerReadPlan();
 const [g0,p]=await Promise.all([get(fp.genesis),get(fp.partial)]);
 need(g0.genesisSha256===fp.genesisSha256&&g0.binding===fp.binding&&digest(g0.genesis)===fp.genesisSha256,'exact_first_genesis');
 const a=immutable(p,p0.partialSha256,'china_v4_ordinary_continuation_partial',fp.genesisSha256);
 need(a.lastDurableCursor===13182101&&a.durableEvents===1260&&a.durablePages===63&&H.test(a.persistedPageHeadSha256),'first_checkpoint_meta');
 const firstPrior={resumeCursor:a.lastDurableCursor,events:a.durableEvents,headSha256:a.persistedPageHeadSha256,priorPartialSha256:p0.partialSha256};
 const mode=(x,prior)=>{
  const owner={repositoryId:'1289722938',runId:x.runId,attempt:'1',revision:x.revision,ownerApprovalSha256:x.ownerApprovalSha256};
  return deriveReadPlan({owner,genesis:{...g0.genesis,continuationId:'verified-v4-che168-'+x.runId,
    newCollectionStartCursor:prior.resumeCursor,priorPrivateCheckpoint:prior}},x,prior);
 };
 const sp=mode(LINKED_PRODUCER,firstPrior),b=immutable(await get(sp.partial),p1.partialSha256,'china_v4_ordinary_continuation_partial',sp.genesisSha256);
 need(b.lastDurableCursor===13186101&&b.durableEvents===4000&&b.durablePages===200&&b.baseCursor===a.lastDurableCursor&&H.test(b.persistedPageHeadSha256),'second_checkpoint_meta');
 const secondPrior={resumeCursor:b.lastDurableCursor,events:5260,headSha256:b.persistedPageHeadSha256,priorPartialSha256:p1.partialSha256};
 const ep=mode(producer,secondPrior);
 const [tr,r,claim]=await Promise.all([get(ep.terminal),get(ep.ready),get(ep.claim)]);
 const t=immutable(tr,official.terminalSha256,'china_che168_terminal_empty_wire_receipt',ep.genesisSha256);
 const ready=immutable(r,r.sha256,'china_v4_ordinary_continuation_source_ready',ep.genesisSha256);
 const asOf=Date.parse(t.observedAt),validUntil=asOf+48*3600_000;
 need(typeof t.observedAt==='string'&&new Date(asOf).toISOString()===t.observedAt&&asOf>=Date.parse(official.stageStart)&&
  asOf<Date.parse(official.stageEnd)+1000&&asOf<=Date.now()&&Date.now()<validUntil&&t.terminalCursor===13196544&&t.providerRequestAttempts===556&&
  H.test(t.responseWireSha256)&&H.test(t.persistedPageHeadSha256)&&t.publicationAuthorized===false&&t.cursorAdvanceAuthorized===false&&
  ready.terminalReceiptSha256===tr.sha256&&ready.sourceObservedAt===t.observedAt&&ready.startCursor===13186101&&ready.acceptedPublicCursor===13123821&&
  ready.terminalCursor===13196544&&ready.priorChanges===57020&&Number.isSafeInteger(ready.appendedChanges)&&ready.appendedChanges>0&&
  ready.headSha256===t.persistedPageHeadSha256&&[ready.replicaSha256,ready.inventorySha256,ready.journalSha256,ready.withdrawalsSha256].every(x=>H.test(x))&&
  ready.publicationAuthorized===false&&ready.cursorAdvanceAuthorized===false&&claim?.kind==='china_v4_owned_continuation_replica_claim'&&
  claim.terminalReceiptSha256===tr.sha256&&/^catalog\/provider-replicas\/che168\/[a-f0-9-]{36}$/.test(claim.privateReplicaRoot),'protected_terminal_exact_source');
 return {validUntil,terminal:t,terminalSha:tr.sha256,ready,readySha:r.sha256,replicaRoot:claim.privateReplicaRoot,priorPartialMetadata:2,metadataReads};
}
export function matchVerifiedNativeReport(r,terminal){
 const {ready,readySha,terminal:t}=terminal,cut=r?.sourceMaterialization,src=r?.sources?.[0],withdrawn=r?.confirmedWithdrawals;
 need(r?.version===1&&r.provider==='auto_api_che168'&&r.market==='china'&&r.productionWrites===false&&r.completed===true&&
  r.completedAt===t.observedAt&&r.startedAt==='2026-11-21T03:45:53Z'&&r.sources.length===1&&src.sourceId==='autohome_used_china_open'&&
  cut.kind==='china_rev5_local_source_only_input_v1'&&cut.terminalWitnessSha256===terminal.terminalSha&&cut.privateReadySha256===readySha&&
  cut.inventoryLedgerSha256===ready.inventorySha256&&cut.priorJournalSha256==='36c279e55fd61db002a85b7720fd32980124ce4d60ea08cb8f985d9f2359f9c2'&&
  cut.journalSha256===ready.journalSha256&&cut.withdrawalsSha256===ready.withdrawalsSha256&&Date.parse(cut.expireAt)===terminal.validUntil&&
  cut.terminalEmptyWireNotRelabeled===true&&cut.nativeCloudArchiveSealed===false&&src.initialCursor===13123821&&src.cursor===13196544&&
  src.replica.key===terminal.replicaRoot&&src.replica.sha256===ready.replicaSha256&&src.replica.binding===src.snapshotBinding&&src.replica.cursor===src.cursor&&
  src.completeInventory===true&&src.stopReason==='source_finished'&&src.observations===286546&&src.uniqueOffers===286546&&src.rejectedIdentity===0&&
  H.test(src.snapshotBinding)&&H.test(src.baseReplica.sha256)&&src.changes===57020+5260+ready.appendedChanges&&Array.isArray(withdrawn)&&withdrawn.length===25707,
  'exact_archived_report_terminal_lineage');
 const ids=new Set();
 for(const w of withdrawn)need(w.sourceId===src.sourceId&&w.market==='china'&&w.status==='removed'&&w.id===sha(src.sourceId+':'+w.sourceOfferId).slice(0,24)&&
  /^\d{1,32}$/.test(w.sourceOfferId)&&typeof w.observedAt==='string'&&Date.parse(w.observedAt)<=Date.parse(r.completedAt)&&
  !ids.has(w.id)&&ids.add(w.id),'native_explicit_removed_rows');
 return true;
}
async function removePrivate(file,expected){
 const st=await fs.lstat(file);need(st.isFile()&&st.nlink===1&&st.size===expected.bytes&&await fs.realpath(file)===file,'readonly_reuse_private_file');
 const d=createHash('sha256');for await(const x of createReadStream(file))d.update(x);
 const f=await fs.lstat(file);
 need(d.digest('hex')===expected.sha256&&st.ino===f.ino&&st.mtimeMs===f.mtimeMs&&st.ctimeMs===f.ctimeMs,'verified_reuse_file_digest');
 await fs.unlink(file);
}
export async function restoreV3AndConvert({storage,archiveModule,rawProvenance,converter,sourceTerminal,scratch,scratchMeter,readerOwner,assertLive,access,secret,fetchImpl}){
 const diag=createArchivePhaseMeter();
 try{
  await assertLive(true);
  const {validUntil,terminal:t}=sourceTerminal,cut=()=>need(Date.now()<validUntil,'exact_source_expired');
  cut();
  const metadata=makeFixedReader({access,secret,fetchImpl}),values=new Map();
  const observed=await reconcileVerifiedV3({read:async(k,cap)=>{const o=await metadata(k,cap);values.set(k,o);return o;}});
  need(observed.result==='durable_archive_and_ready_pin_recovery_candidate'&&
   ['archiveManifestSha256','reportSha256','files','parts','totalBytes','reportBytes','pinReadyAt','pinRefs'].every(k=>VERIFIED_ARCHIVE[k]===observed[k]),
   'reconciled_exact_ready_archive_drift');
  const a=values.get(archiveExact.ARCHIVE+'/complete.json').json,pin=rawProvenance.assertRawPin(values.get(archiveExact.PIN).json);
  need(equal(a.owner,VERIFIED_ARCHIVE.previousOwner)&&!pin.coordination,'exact_old_ready_archive_producer');
  const refs=rawProvenance.rawReferences(pin.references);
  need(refs.some(x=>x.kind==='che168-replica'&&x.root===sourceTerminal.replicaRoot&&x.sha256===sourceTerminal.ready.replicaSha256),
    'archive_retains_exact_terminal_replica');
  const receipt=rawProvenance.assertDurableIntakeArchive({version:1,market:'china',owner:a.owner,root:archiveExact.ARCHIVE,
   manifestSha256:observed.archiveManifestSha256,reportDigest:observed.reportSha256,
   handoff:{version:1,key:archiveExact.PIN,operationId:pin.operationId,owner:pin.owner,readyAt:pin.readyAt,references:refs,referencesSha256:digest(refs)}});
  const parts=new Map(a.files.flatMap(f=>f.parts.map(p=>[p.key,p]))),seen=new Set(),outputRoot=path.join(scratch,'native-v3-readonly-archive');
  const meta=new Set([archiveExact.ARCHIVE+'/complete.json',archiveExact.PIN,rawPolicy,rawState]);
  let bodyReads=0,readBytes=0;
  const reader={driver:'object',async readJson(k,f){
   cut();await assertLive();
   const part=parts.get(k);need(part||meta.has(k),'only_exact_existing_v3_archive');
   if(k===rawPolicy||k===rawState){
    const p=await storage.readJson(k,null);need(p===null,'new_raw_coordination_needs_review');return p;
   }
   if(part){
    need(++bodyReads<=1723&&!seen.has(k),'exact_once_archive_part_read');seen.add(k);
    const res=await storage.getBinaryBounded(k,4*M);
    need(res?.data.length>0&&res.data.length<=4*M&&(readBytes+=res.data.length)<=2*G&&sha(res.data)===res.checksum,'archive_part_wire_cap');
    diag.accepted('read',res.data.length);
    if(bodyReads%75===0)await scratchMeter.check('archive_readonly_restore');
    return json(res.data);
   }
   const o=await storage.getBinaryBounded(k,k===archiveExact.PIN?32*1024:2*M);
   const expected=values.get(k);
   need(o.checksum===expected.sha256&&sha(o.data)===expected.sha256,'archive_control_changed');
   return json(o.data);
  }};
  diag.phase('verify_durable_archive');
  const v=await archiveModule.verifyIntakeArchive({storage:reader,receipt,directory:outputRoot,readerOwner});
  need(bodyReads===1723&&seen.size===parts.size&&digest(v)===receipt.manifestSha256,'native_full_archive_readback');
  await assertLive(true);cut();
  const reportFile=path.join(outputRoot,'report.json'),raw=await fs.readFile(reportFile);
  need(raw.length===VERIFIED_ARCHIVE.reportBytes&&sha(raw)===receipt.reportDigest,'exact_archive_report_wire');
  const report=json(raw);matchVerifiedNativeReport(report,sourceTerminal);
  console.log(JSON.stringify({stage:'reused_exact_v3_native_archive_verified',archiveSha256:receipt.manifestSha256,parts:bodyReads,reportSha256:receipt.reportDigest,
    observations:VERIFIED_ARCHIVE.observations,terminalCursor:VERIFIED_ARCHIVE.terminalCursor,noArchiveWrites:true}));
  const attached=archiveModule.attachIntakeArchiveReceipt(report,receipt),converted=path.join(scratch,'input-converted');
  await fs.mkdir(converted,{mode:0o700});
  const catalog=new Map(a.files.filter(x=>x.name.endsWith('.jsonl')).map(x=>[x.name,x]));
  const sourceByteCount=[...catalog.values()].reduce((n,x)=>n+x.bytes,0);
  diag.phase('convert_archive_files');
  await scratchMeter.check('convert_verified_v3_archive',{force:true,needBytes:Math.ceil(sourceByteCount*1.25)+640*M});
  const out=await converter.convertMarketOnDisk({market:'china',directory:outputRoot,files:[...catalog.keys()],out:converted,report:attached,
   async afterConsumedFile(name){need(catalog.has(name),'restored_v3_file_scope');await fs.chmod(path.join(outputRoot,name),0o600);
    await removePrivate(path.join(outputRoot,name),catalog.get(name));catalog.delete(name);await scratchMeter.check('convert_verified_v3_archive');await assertLive();}});
  need(catalog.size===0&&out.market==='china'&&out.uniqueObservations===286546&&out.shards>0&&out.shards<=1200,'native_verified_v3_census');
  let outputBytes=0;const shards=[];
  for(const file of (await fs.readdir(converted)).sort()){
   const f=path.join(converted,file),st=await fs.lstat(f);
   need(/^catalog-rebuild-china-[0-9]+\.json$/.test(file)&&st.isFile()&&st.nlink===1&&st.size>0&&st.size<=128*M&&(outputBytes+=st.size)<=7*G,'owned_reuse_shards');
   await fs.chmod(f,0o600);shards.push({file,bytes:st.size,sha256:sha(await fs.readFile(f))});cut();
  }
  need(shards.length===out.shards,'readonly_reuse_shard_count');
  const receiptSha256=digest(receipt),admission={version:1,kind:'china-local-confirmed-input-only',sourceCompletedAt:t.observedAt,
   sourceExpiresAt:new Date(validUntil).toISOString(),sourceRows:out.uniqueObservations,archiveManifestSha256:receipt.manifestSha256,
   receiptSha256,reportSha256:receipt.reportDigest,shards,shardsSha256:digest(shards),outputBytes,inventoryV2SealIssued:false,priced:false,
   providerRequests:0,publicationAuthorized:false,cursorAdvanceAuthorized:false};
  const admitted=Buffer.from(JSON.stringify(admission));await fs.writeFile(path.join(converted,'LOCAL_ADMISSION.json'),admitted,{mode:0o600,flag:'wx'});
  await assertLive(true);cut();diag.finished();
  let released=0;
  return Object.freeze({admission,admissionSha256:sha(admitted),receipt,receiptSha256,converted,reportFile,outputRoot,scratchMeter,assertLive,
   sourceSeal:{officialTerminalSha256:sourceTerminal.terminalSha,sourceObservedAt:t.observedAt,sourceExpiresAt:validUntil,terminalCursor:13196544,observations:286546},
   async releaseVerifiedConvertedShard(i,expected){const x=shards[i];need(i===released&&x?.sha256===expected,'controlled_reuse_shard_release');
    await removePrivate(path.join(converted,x.file),x);released++;}});
 }catch(e){throw diag.held(e);}
}

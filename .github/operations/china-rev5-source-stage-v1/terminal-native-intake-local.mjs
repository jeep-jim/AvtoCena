// Reconstructs native *local input*, never creates an archive/receipt, source
// authority, bucket pin, provider call, publication or cursor update.
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {digest,guard as need,REV5,OLD_BASE} from './rev5-successor-core.mjs';
const H=/^[a-f0-9]{64}$/,I=/^\d{1,32}$/,G=1024**3,M=1024**2;
const ORIGIN_CURSOR=13123821,PRIVATE_CURSOR=13180841,OLD_PAGES=57020;
const ORIGINAL_JOURNAL='36c279e55fd61db002a85b7720fd32980124ce4d60ea08cb8f985d9f2359f9c2';
const ORIGINAL_REPLICA='e55a984351971929609780d2aa588215b78eb51c1debb4da07e13621481e9a0d';
const ORIGINAL_INV='c6ca74a1071f078e633d84b9b928338ab69c73dde29a5d50c43a255471d8dc5f';
export const EXACT=Object.freeze({
 runId:'44860270709',jobId:'136711801920',revision:'78a7a0b0a316d80315f173ff4afa034167540129',attempt:'1',
 workflow:'.github/workflows/china-v4-continuation-once.yml',ownerApprovalSha256:'31070225bdb8c62b8f884c0ade8785b7d904e0495838a7228b8e9e481553b528',
 snapshotSha256:'25abfa4b8f1b053b12a1fcd86f01dc42de65eb8cb74f3863abf1a49115dfdb27',
 oldWithdrawalSha256:'25f24d9e17b4bdcabe0a1f89fa8b2b8a76f7f573a4d69dccd4a2dea9f56a524f',
 protectedStepStartedAt:'2026-11-21T03:17:25Z',
});
export const EXACT_PARTIAL_SHA='373984db2a76029a599e7969e871af41fdbcb2fbe3d9589366bb6810f70edbba';
const SOURCE='autohome_used_china_open',kind='china_rev5_local_source_only_input_v1';
const sha=v=>createHash('sha256').update(v).digest('hex');
const id=v=>sha(SOURCE+':'+v).slice(0,24);
const iso=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const replica=x=>/^catalog\/provider-replicas\/che168\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const typedInt=n=>Number.isSafeInteger(n)&&n>=0;
const shape=(x,k)=>x&&typeof x==='object'&&Object.keys(x).length===k.length&&k.every(y=>Object.hasOwn(x,y));
const activeKey='catalog/intake-working/che168-v1/';
const uuid=s=>[s.slice(0,8),s.slice(8,12),s.slice(12,16),s.slice(16,20),s.slice(20,32)].join('-');
export function deriveReadPlan({owner,genesis},p=EXACT,prior=null){
 need(owner?.repositoryId==='1289722938'&&owner.runId===p.runId&&owner.attempt===p.attempt&&
  owner.revision===p.revision&&owner.ownerApprovalSha256===p.ownerApprovalSha256,'continuation_owner');
 const expected={version:1,kind:'china_v4_verified_candidate_continuation',continuationId:'verified-v4-che168-'+p.runId,market:'china',
  baseCursor:ORIGIN_CURSOR,cursor:PRIVATE_CURSOR,changes:OLD_PAGES,
  oldPinSha256:'a14bda5ccf4c4e8a3920ff8858d6bad6a8d5307fad0d706dd8236650a9b4f4d2',
  oldJournalHeadSha256:ORIGINAL_JOURNAL,replicaManifestSha256:ORIGINAL_REPLICA,inventorySha256:ORIGINAL_INV,newCollectionStartCursor:prior?.resumeCursor??PRIVATE_CURSOR,
  ...(prior?{priorPrivateCheckpoint:prior}:{})};
 const genesisSha256=digest(expected);
 need(digest(genesis)===genesisSha256,'exact_genesis_or_private_resume_binding');
 const binding=digest([owner.repositoryId,owner.runId,owner.attempt,owner.revision,owner.ownerApprovalSha256,genesisSha256]);
 const root=activeKey+BigInt('0x'+binding.slice(0,16)).toString();
 const key=(k,n=0)=>root+'/'+uuid(sha('china-v4-continuation-v1:'+k+':'+n))+'.json';
 return {root,binding,genesisSha256,genesis:key('genesis'),terminal:key('terminal'),claim:key('claim'),ready:key('ready'),partial:key('partial'),
  page:n=>{need(typedInt(n)&&n>=1&&n<=(p.expectedChangeRequests?p.expectedChangeRequests-1:256),'part_scope');return key('page',n);}};
}
export function exactProducerReadPlan(){
 const p=EXACT,owner={repositoryId:'1289722938',runId:p.runId,attempt:p.attempt,revision:p.revision,ownerApprovalSha256:p.ownerApprovalSha256};
 // Match the literal order in the deployed controller, not just same keys.
 const genesis={version:1,kind:'china_v4_verified_candidate_continuation',continuationId:'verified-v4-che168-'+p.runId,market:'china',baseCursor:ORIGIN_CURSOR,cursor:PRIVATE_CURSOR,changes:OLD_PAGES,
  oldPinSha256:'a14bda5ccf4c4e8a3920ff8858d6bad6a8d5307fad0d706dd8236650a9b4f4d2',
  oldJournalHeadSha256:ORIGINAL_JOURNAL,replicaManifestSha256:ORIGINAL_REPLICA,inventorySha256:ORIGINAL_INV,newCollectionStartCursor:PRIVATE_CURSOR};
 return deriveReadPlan({owner,genesis});
}
const boundJson=(v,max)=>{need(Buffer.isBuffer(v)&&v.length>0&&v.length<=max,'local_evidence_byte_scope');return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(v));};
const checkWire=(b,pin,cap)=>{const o=boundJson(b,cap);need(H.test(pin)&&sha(b)===pin,'independent_wire_pin');return o;};
const checkReceipt=(wire,cap=32*1024)=>{
 const r=boundJson(wire,cap);need(shape(r,['record','sha256'])&&H.test(r.sha256)&&digest(r.record)===r.sha256,'immutable_wrapped_receipt');return r;
};
/** Exact legacy partial approval: report empty READY rather than synthesize it.
 * Future terminal policy has independent actual run/attempt/head pins. */
export function verifyExactKnownPartial(input,policy=EXACT,partialSha=EXACT_PARTIAL_SHA){
 return verifyOnePartial(input,policy,partialSha,null);
}
function verifyOnePartial({official,genesisWire,partialWire,pageWires,genesisWireSha},policy,partialSha,prior){
 const start=prior?.resumeCursor??PRIVATE_CURSOR;

 need(official?.completedPartial===true&&official.runId===policy.runId&&official.jobId===policy.jobId&&official.revision===policy.revision&&
  official.attempt===policy.attempt&&official.workflow===policy.workflow&&official.partialSha256===partialSha,'official_prior_partial_only');
 const g=checkWire(genesisWire,genesisWireSha,32*1024),plan=deriveReadPlan(g,policy,prior);
 need(plan.genesisSha256===g.genesisSha256&&plan.binding===g.binding,'prior_partial_genesis_storage_binding');
 const q=checkReceipt(partialWire),r=q.record;
 need(q.sha256===partialSha&&r?.version===1&&r.kind==='china_v4_ordinary_continuation_partial'&&r.genesisSha256===plan.genesisSha256&&
  r.ordinaryContinuationHasNotReachedTerminal===true&&r.publicationAuthorized===false&&r.cursorAdvanceAuthorized===false&&
  r.baseCursor===start&&typedInt(r.durablePages)&&r.durablePages>0&&r.durablePages<=256&&
  typedInt(r.providerRequestAttempts)&&r.providerRequestAttempts>=r.durablePages&&r.providerRequestAttempts<=(policy.allowLinkedDetails?1200:256)&&
  typedInt(r.durableEvents)&&r.durableEvents>0&&r.durableEvents<=50000&&Array.isArray(pageWires)&&pageWires.length===r.durablePages,'exact_prior_partial_census');
 let head=plan.genesisSha256,cursor=start,n=0,bytes=0;
 const pages=[];
 for(const wire of pageWires){
  bytes+=wire.length;need(bytes<=256*M,'partial_wire_bound');
  const x=boundJson(wire,16*M),p=x.record;
  need(p?.version===1&&p.kind==='china_v4_append_only_normalized_page'&&p.genesisSha256===plan.genesisSha256&&p.previousHeadSha256===head&&
    p.from===cursor&&typedInt(p.to)&&p.to>cursor&&H.test(p.sourceWireSha256)&&x.sha256===digest(p)&&
    Array.isArray(x.events)&&x.events.length===p.changeCount&&p.changeCount>0&&p.normalizedEventsSha256===digest(x.events)&&
    (n+=x.events.length)<=50000,'prior_partial_pages');
  head=x.sha256;cursor=p.to;pages.push(x);
 }
 need(head===r.persistedPageHeadSha256&&cursor===r.lastDurableCursor&&n===r.durableEvents,'prior_partial_terminal_checkpoint');
 return {priorCheckpoint:{resumeCursor:cursor,events:(prior?.events??0)+n,headSha256:head,priorPartialSha256:partialSha},pages,bytes};
}
/** At most eight explicitly reviewed consecutive partial runs followed by
 * one terminal. Each entry contains separately authenticated run facts and
 * SHA pins; the first entry is irreducibly bound to the observed 44860270709. */
export function verifiedLatestPartialChain(input){return verifyPartialChain(input,EXACT_PARTIAL_SHA);}
function verifyPartialChain(input,firstPin){
 const a=input.priorPartials??(input.priorPartial?[input.priorPartial]:[]);
 need(Array.isArray(a)&&a.length<=8&&!(input.priorPartials&&input.priorPartial),'bounded_prior_checkpoint_depth');
 if(!a.length)return null;
 const seen=new Set();const pages=[];
 let prior=null,bytes=0;
 for(let i=0;i<a.length;i++){
  const item=a[i],p=i===0?EXACT:item?.policy,sha=i===0?firstPin:item?.reviewedPartialSha256;
  need(p&&/^[1-9][0-9]{0,19}$/.test(p.runId)&&/^[1-9][0-9]{0,19}$/.test(p.jobId)&&/^[a-f0-9]{40}$/.test(p.revision)&&
   p.attempt==='1'&&H.test(p.ownerApprovalSha256)&&H.test(sha)&&!seen.has(p.runId)&&
   (i===0||BigInt(p.runId)>BigInt(a[i-1].policy?.runId??EXACT.runId)),'independent_prior_run_pin');
  seen.add(p.runId);
  const proof=verifyOnePartial(item,p,sha,prior);
  prior=proof.priorCheckpoint;bytes+=proof.bytes;pages.push(...proof.pages);
  need(prior.events<=100000&&bytes<=512*M&&pages.length<=1024,'cumulative_prior_bounds');
 }
 return {priorCheckpoint:prior,bytes,pages,seen};
}
export function verifyLocalTerminalProof(input,policy=EXACT){return verifyTerminal(input,policy,EXACT_PARTIAL_SHA);}
// A fixture cannot create live authority. Runtime integrations use the exact-pin public entry.
export function rehearseResumedTerminal(input,policy,syntheticPartialSha){return verifyTerminal(input,policy,syntheticPartialSha);}
function verifyTerminal(input,policy,partialPin){
 const {official,genesisWire,terminalWire,claimWire,readyWire,pageWires,oldLedgerWire,configWire,manifestWire,approvedPins,now}=input;
 need(official?.completedSuccess===true&&official.runId===policy.runId&&official.jobId===policy.jobId&&official.revision===policy.revision&&official.workflow===policy.workflow&&
  official.attempt===policy.attempt&&official.stageStart===policy.protectedStepStartedAt&&iso(official.stageEnd)&&H.test(official.terminalSha256),'official_source_attempt_not_successful');
 const prior=verifyPartialChain(input,partialPin);
 need((!prior&&policy.runId===EXACT.runId)||(prior&&!prior.seen.has(policy.runId)&&BigInt(policy.runId)>BigInt([...prior.seen].at(-1))),'new_terminal_must_bind_known_prior_partial');
 const start=prior?.priorCheckpoint.resumeCursor??PRIVATE_CURSOR;
 const g=checkWire(genesisWire,approvedPins.genesisWire,32*1024),r=deriveReadPlan(g,policy,prior?.priorCheckpoint);
 need(r.genesisSha256===g.genesisSha256&&r.binding===g.binding,'genesis_storage_binding');
 const t=checkReceipt(terminalWire),a=checkReceipt(readyWire),w=t.record,ready=a.record;
 need(t.sha256===official.terminalSha256&&sha(readyWire)===approvedPins.readyWire&&w?.version===1&&w.kind==='china_che168_terminal_empty_wire_receipt'&&
  w.genesisSha256===r.genesisSha256&&H.test(w.persistedPageHeadSha256)&&H.test(w.responseWireSha256)&&w.publicationAuthorized===false&&
  w.cursorAdvanceAuthorized===false&&typedInt(w.terminalCursor)&&w.terminalCursor>=start&&typedInt(w.providerRequestAttempts)&&
  w.providerRequestAttempts>=1&&w.providerRequestAttempts<=(policy.allowLinkedDetails?1200:256)&&iso(w.observedAt),'signed_terminal_wire_binding');
 const observed=Date.parse(w.observedAt),expiry=observed+48*3600_000;
 need(typedInt(now)&&observed>=Date.parse(official.stageStart)&&observed<Date.parse(official.stageEnd)+1000&&observed<=now&&now<expiry,'real_terminal_clock');
 need(ready?.version===1&&ready.kind==='china_v4_ordinary_continuation_source_ready'&&ready.genesisSha256===r.genesisSha256&&
   ready.terminalReceiptSha256===t.sha256&&ready.headSha256===w.persistedPageHeadSha256&&ready.startCursor===start&&ready.acceptedPublicCursor===ORIGIN_CURSOR&&
   ready.terminalCursor===w.terminalCursor&&ready.priorChanges===OLD_PAGES&&typedInt(ready.appendedChanges)&&ready.appendedChanges<=50000&&
   ready.sourceObservedAt===w.observedAt&&[ready.replicaSha256,ready.journalSha256,ready.withdrawalsSha256,ready.inventorySha256].every(x=>H.test(x))&&
   ready.publicationAuthorized===false&&ready.cursorAdvanceAuthorized===false,'signed_success_source_ready');
 const claim=checkWire(claimWire,approvedPins.claimWire,32*1024);
 need(shape(claim,['kind','terminalReceiptSha256','privateReplicaRoot'])&&claim.kind==='china_v4_owned_continuation_replica_claim'&&claim.terminalReceiptSha256===t.sha256&&replica(claim.privateReplicaRoot),'immutable_replica_claim');
 const config=checkWire(configWire,policy.snapshotSha256,128*1024),binding=digest(config);
 need(config.version===1&&iso(config.modifiedAt)&&typedInt(config.initialCursor)&&config.initialCursor<=ORIGIN_CURSOR,'snapshot_identity');
 const manifest=boundJson(manifestWire,512*1024);
 need(digest(manifest)===ready.replicaSha256&&manifest.version===1&&manifest.binding===binding&&manifest.cursor===ready.terminalCursor&&
  typedInt(manifest.bytes)&&manifest.bytes>0&&manifest.bytes<=4*G&&Array.isArray(manifest.parts)&&manifest.parts.length>0&&manifest.parts.length<=256&&
  manifest.parts.length===Math.ceil(manifest.bytes/(16*M))&&manifest.parts.every((x,i)=>typedInt(x?.bytes)&&x.bytes===Math.min(16*M,manifest.bytes-i*16*M)&&H.test(x.sha256)),'exact_native_replica_manifest');
 const old=boundJson(oldLedgerWire,16*M);
 need(Array.isArray(old)&&old.length<=50000&&digest(old)===policy.oldWithdrawalSha256,'historical_withdrawal_body');
 const rows=new Map();
 for(const v of old) {
  need(I.test(v?.sourceOfferId??'')&&v.id===id(v.sourceOfferId)&&v.sourceId===SOURCE&&v.market==='china'&&v.status==='removed'&&
   typedInt(v.confirmedRemovalEvent)&&v.confirmedRemovalEvent<=PRIVATE_CURSOR&&iso(v.observedAt)&&!rows.has(v.sourceOfferId),'historical_removal_row');
  rows.set(v.sourceOfferId,{...v});
 }
 let head=r.genesisSha256,cursor=start,n=0,wireBytes=prior?.bytes??0,last=PRIVATE_CURSOR,pages=prior?.pages.length??0;
 const eventsDigest=createHash('sha256').update('china_v4_native_immutable_chain_and_continuation_v1\n').update(ORIGINAL_JOURNAL+'\n');
 need(Array.isArray(pageWires)&&pageWires.length<=(policy.expectedChangeRequests?policy.expectedChangeRequests-1:255)&&
  (policy.expectedChangeRequests?policy.expectedChangeRequests===pageWires.length+1&&
   policy.expectedChangeRequests+policy.expectedLinkedOfferRequests===w.providerRequestAttempts:
   policy.allowLinkedDetails?pageWires.length+1<=w.providerRequestAttempts:pageWires.length+1===w.providerRequestAttempts),'every_committed_page');
 const apply=(events,record)=>{
  for(const e of events){
   const inner=e?.kind==='offer'?e.offer?.sourceOfferId:e?.innerId;
   need(typeof inner==='string'&&I.test(inner)&&['offer','price','removed','quarantine','missing_detail'].includes(e.kind)&&
    typedInt(e.event)&&e.event>=last&&e.event>=record.from&&e.event<=record.to&&iso(e.at),'normalized_delta_row');
   last=e.event;eventsDigest.update(digest(e)+'\n');
   if(e.kind==='removed'){
    rows.set(inner,{id:id(inner),sourceId:SOURCE,sourceOfferId:inner,market:'china',status:'removed',observedAt:e.at,
     confirmedRemovalEvent:e.event,terminalChangedEvent:e.event,terminalCandidateStatus:'absent'});
   }else if(rows.has(inner)&&e.kind!=='missing_detail'){
    const q=rows.get(inner);q.terminalChangedEvent=e.event;q.terminalCandidateStatus=e.kind==='price'||e.kind==='offer'?'present_reinserted':'absent';
   }
  }
 };
 if(prior)for(const x of prior.pages)apply(x.events,x.record);
 for(const wire of pageWires){
  wireBytes+=wire.length;need(wireBytes<=512*M,'append_wire_bound');
  const page=boundJson(wire,16*M),{record,events,sha256}=page;
  need(++pages<=1280&&record?.kind==='china_v4_append_only_normalized_page'&&record.version===1&&record.genesisSha256===r.genesisSha256&&
    record.previousHeadSha256===head&&record.from===cursor&&typedInt(record.to)&&record.to>cursor&&H.test(record.sourceWireSha256)&&
    sha256===digest(record)&&Array.isArray(events)&&events.length===record.changeCount&&events.length>0&&
    record.normalizedEventsSha256===digest(events)&&(n+=events.length)<=50000,'ordered_normalized_page_wire');
  apply(events,record);
  head=sha256;cursor=record.to;
 }
 need(head===ready.headSha256&&cursor===ready.terminalCursor&&n===ready.appendedChanges&&n+(prior?.priorCheckpoint.events??0)<=100000&&
  eventsDigest.update(t.sha256).digest('hex')===ready.journalSha256&&digest([...rows.values()])===ready.withdrawalsSha256,'final_journal_or_withdrawal_digest');
 return {r,t,ready,w,a,observed,expiry,binding,config,pages,rows,replicaDescriptor:{key:claim.privateReplicaRoot,sha256:ready.replicaSha256,binding,cursor},replicaBytes:manifest.bytes,parts:manifest.parts,priorPartialChanges:prior?.priorCheckpoint.events??0};
}
async function openMaskedReplica(file,proof){
 need(path.isAbsolute(file)&&await fs.realpath(file)===file,'replica_local_path');
 const f=await fs.open(file,'r');
 try{
  const meta=await f.stat();
  need(meta.isFile()&&meta.nlink===1&&(meta.mode&0o077)===0&&meta.size===proof.replicaBytes,'replica_private_file');
  let offset=0;
  for(const part of proof.parts){
   const b=Buffer.alloc(part.bytes);const x=await f.read(b,0,b.length,offset);
   need(x.bytesRead===part.bytes&&sha(b)===part.sha256,'exact_sqlite_part_digest');
   if(offset===0)need(b.subarray(0,16).equals(Buffer.from('SQLite format 3\0'))&&b[18]===1&&b[19]===1,'closed_sqlite_replica');
   offset+=b.length;
  }
  need(offset===meta.size,'exact_sqlite_size');
  return {f,meta};
 }catch(e){await f.close();throw e;}
}
export async function buildLocalNativeIntake(input,policy=EXACT){
 const proof=verifyLocalTerminalProof(input,policy);
 const {observed,expiry,w,ready,binding,config,rows,replicaDescriptor,pages}=proof;
 
 const {nativeReplicaFile,outputRoot,acceptedBase,assertAuthenticatedReadonlyAuthority,clock=Date.now,scratchMeter}=input;
 need(typeof assertAuthenticatedReadonlyAuthority==='function'&&typedInt(clock())&&observed<=clock()&&clock()<expiry,'readonly_source_authority');
 need(acceptedBase?.provenFromExactRev5===true&&acceptedBase.controlSha256===REV5&&acceptedBase.activeRefSha256===OLD_BASE&&
  acceptedBase.cursor===ORIGIN_CURSOR&&replica(acceptedBase.replica?.key)&&H.test(acceptedBase.replica.sha256)&&
  acceptedBase.replica.binding===binding&&acceptedBase.replica.cursor===ORIGIN_CURSOR,'accepted_base_replica_lineage');
 await assertAuthenticatedReadonlyAuthority({phase:'before_stream',expectedRev5:REV5,terminalSha256:proof.t.sha256,sourceReady:proof.a.sha256,archiveAuthorized:false});
 need(path.isAbsolute(outputRoot)&&await fs.realpath(path.dirname(outputRoot))===path.dirname(outputRoot),'private_output');
 const parent=await fs.stat(path.dirname(outputRoot));
 need(parent.isDirectory()&&(parent.mode&0o077)===0,'private_output_parent');
 await fs.mkdir(outputRoot,{mode:0o700});
 const replicaHandle=await openMaskedReplica(nativeReplicaFile,proof);
 let db;try{db=new DatabaseSync(nativeReplicaFile,{readOnly:true,allowExtension:false});}catch(e){await replicaHandle.f.close();throw e;}
 const assertClock=()=>need(observed<=clock()&&clock()<expiry,'terminal_expired_during_local_conversion');
 const results=[],lineage=createHash('sha256').update('[');
 let count=0,n=0,bytes=0,batch=[],batchBytes=0;
 const stamp={
  method:'snapshot_and_complete_change_stream',snapshotBinding:binding,initialCursor:config.initialCursor,
  cursor:w.terminalCursor,verifiedAt:w.observedAt,
 };
 async function flush(){
  if(!batch.length)return;
  const wire=Buffer.from(batch.join('')),name=SOURCE+'-'+String(++n).padStart(6,'0')+'.jsonl';
  need(n<=1200&&(bytes+=wire.length)<=5*G,'local_native_shards_bound');
  await fs.writeFile(path.join(outputRoot,name),wire,{flag:'wx',mode:0o600});
  results.push({name,bytes:wire.length,sha256:sha(wire)});
  batch=[];batchBytes=0;assertClock();if(scratchMeter)await scratchMeter.check('materialize_native_jsonl');
 }
 const gone=[];
 try{
  assertClock();db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA cache_size=-16384;');
  const schema=db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name COLLATE BINARY').all();
  const t=schema.find(x=>x.type==='table'&&x.name==='inventory');
  need(schema.length===2&&t?.tbl_name==='inventory'&&t.sql.replace(/\s/g,'').toLowerCase()==='createtableinventory(idtextprimarykey,payloadtextnotnull,eventintegernotnull)'&&
   schema.some(r=>r.type==='index'&&r.name==='sqlite_autoindex_inventory_1'&&r.sql===null)&&db.prepare('PRAGMA quick_check').get()?.quick_check==='ok','native_replica_integrity');
  const presence=db.prepare('SELECT event FROM inventory WHERE id=?');
  for(const row of rows.values()){
   const present=presence.get(row.sourceOfferId);
   need((row.terminalCandidateStatus==='present_reinserted')===Boolean(present)&&
    (row.terminalCandidateStatus==='absent'||row.terminalCandidateStatus==='present_reinserted'),'withdrawal_candidate_agreement');
   // Native ledger may remember an earlier explicit withdrawal even after
   // another change. Emit a confirmed removal only if it is still the last
   // decisive action; quarantine/unknown does not become removed or sold.
   if(row.terminalCandidateStatus==='absent'&&row.terminalChangedEvent===row.confirmedRemovalEvent){
    need(iso(row.observedAt)&&Date.parse(row.observedAt)<=observed,'observed_withdrawal_timestamp');
    const {id,market,sourceId,sourceOfferId,observedAt}=row;
    gone.push({id,market,sourceId,sourceOfferId,status:'removed',observedAt});
   }
  }
  for(const row of db.prepare('SELECT id,payload,event FROM inventory ORDER BY id COLLATE BINARY').iterate()){
   need(I.test(row?.id??'')&&typeof row.payload==='string'&&Buffer.byteLength(row.payload)<=M&&typedInt(row.event)&&
     row.event<=w.terminalCursor&&count<400000,'native_typed_inventory_row');
   const o=JSON.parse(row.payload);
   need(o?.id===id(row.id)&&o.market==='china'&&o.status==='active'&&o.sourceId===SOURCE&&String(o.sourceOfferId)===row.id&&
     o.operational?.provider==='auto-api.com'&&o.operational?.detailIdentityVerified===true,'native_source_offer_identity');
   if(count++)lineage.update(',');lineage.update(JSON.stringify([row.id,sha(row.payload),row.event]));
   // Same native bulk checkpoint contract. No alteration to detail-date,
   // seller price, fuel, power or any estimate/price logic.
   o.operational={...o.operational,lastSeenAt:w.observedAt,che168ActiveVerification:stamp};
   const l=JSON.stringify({stage:'detail',observedAt:w.observedAt,offer:o})+'\n',b=Buffer.byteLength(l);
   if(batch.length&&(batch.length>=500||batchBytes+b>8*M))await flush();
   batch.push(l); batchBytes+=b;
  }
  await flush();need(count>0&&lineage.update(']').digest('hex')===ready.inventorySha256,'native_sqlite_row_ledger');
  const st=await replicaHandle.f.stat(),file=await fs.stat(nativeReplicaFile);
  need(st.mtimeMs===replicaHandle.meta.mtimeMs&&st.ctimeMs===replicaHandle.meta.ctimeMs&&st.ino===file.ino&&st.size===replicaHandle.meta.size,'local_replica_changed');
  await assertAuthenticatedReadonlyAuthority({phase:'before_local_report',expectedRev5:REV5,terminalSha256:proof.t.sha256,sourceReady:proof.a.sha256,archiveAuthorized:false});
  assertClock();
  const report={version:1,provider:'auto_api_che168',market:'china',productionWrites:false,
   startedAt:input.official.stageStart,completed:true,completedAt:w.observedAt,
   sourceMaterialization:{kind,terminalWitnessSha256:proof.t.sha256,privateReadySha256:proof.a.sha256,inventoryLedgerSha256:ready.inventorySha256,
    priorJournalSha256:ORIGINAL_JOURNAL,journalSha256:ready.journalSha256,withdrawalsSha256:ready.withdrawalsSha256,expireAt:new Date(expiry).toISOString(),
    terminalEmptyWireNotRelabeled:true,nativeCloudArchiveSealed:false},
   sources:[{sourceId:SOURCE,provider:'auto_api_che168',snapshotBinding:binding,snapshotStartedAt:config.modifiedAt,
    syncMode:'snapshot',mode:'snapshot',pages,observations:count,rejectedIdentity:0,stopReason:'source_finished',changes:OLD_PAGES+proof.priorPartialChanges+ready.appendedChanges,
    completeInventory:true,uniqueOffers:count,initialCursor:ORIGIN_CURSOR,cursor:w.terminalCursor,replica:replicaDescriptor,
    baseReplica:{key:acceptedBase.replica.key,sha256:acceptedBase.replica.sha256}}],
   confirmedWithdrawals:gone};
  const wire=Buffer.from(JSON.stringify(report));need(wire.length<=128*M,'native_local_report_bound');
  // No false raw pin/sourceInputWitness/durable intake receipt. Native
  // protected preparation/archiver owns these independently after approval.
  await fs.writeFile(path.join(outputRoot,'report.json'),wire,{flag:'wx',mode:0o600});
  const safe={status:kind,officialTerminalSha256:proof.t.sha256,sourceReadySha256:proof.a.sha256,sourceObservedAt:w.observedAt,sourceExpiresAt:expiry,
   acceptedPublicCursor:ORIGIN_CURSOR,terminalCursor:w.terminalCursor,observations:count,confirmedLastActionRemoved:gone.length,
   rawChunks:results.length,rawBytes:bytes,orderedLocalFilesSha256:digest(results),localReportSha256:sha(wire),
   archiveReceiptIssued:false,approvedForPublication:false,cursorAdvanced:false};
  await fs.writeFile(path.join(path.dirname(outputRoot),path.basename(outputRoot)+'.seal.json'),JSON.stringify(safe),{mode:0o600,flag:'wx'});
  return safe;
 }finally{db.close();await replicaHandle.f.close();}
}

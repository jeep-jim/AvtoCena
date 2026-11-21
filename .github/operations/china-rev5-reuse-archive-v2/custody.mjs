// Forensic, local-only object custody. No provider, live storage, publisher,
// report.json, guessed observation date or writer capability exists here.
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {constants as fsConstants} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createChe168MissingDetails} from './exact-missing-details.mjs';
const M=1024**2, CHUNK=16*M, RAW_CHUNK=64*M;
const REF='catalog/provider-replicas/che168/', SNAP='catalog/provider-snapshots/che168/', J='catalog/intake-working/che168-v1/';
const SOURCE='autohome_used_china_open', SHA=/^[a-f0-9]{64}$/, UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const ID=/^\d{1,32}$/;
const hash=()=>createHash('sha256');
const sha=x=>hash().update(x).digest('hex');
const digest=x=>sha(JSON.stringify(x));
const stable=id=>sha(SOURCE+':'+id).slice(0,24);
const uint=(x,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
const check=(x,c)=>{if(!x)throw Error('china_v4_custody_'+c);};
const validDate=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const decode=(b,cap)=>{check(Buffer.isBuffer(b)&&b.length>0&&b.length<=cap,'local_wire_bound');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));};
const pinContext=Object.freeze({
 runId:'44765240609',attempt:'1',operator:'891a5e3ed885872b99487a47b7d88edd172b1665',
 workerHead:'f4dc98aaab916b29419d173994d66562aa5901f1',workerTree:'4dbbe41885deab5ab80002147aa04738d1048e67',
 pinWireSha:'a14bda5ccf4c4e8a3920ff8858d6bad6a8d5307fad0d706dd8236650a9b4f4d2',
 activeControlSha:'9e3f73d6282465019f43dcd0370bf9c71688445a0e361dccf641bd45acc5be62',
 activeControlRev:5,baseCursor:13123821,
 snapshotConfigWireSha:'25abfa4b8f1b053b12a1fcd86f01dc42de65eb8cb74f3863abf1a49115dfdb27',
 lowerBound:'2026-11-20T15:38:59.000Z',readyAt:'2026-11-20T17:45:03.110Z',
});
function derive(raw,p){
 const x=decode(raw,32*1024);
 check(sha(raw)===p.pinWireSha&&x.version===1&&x.operationId==='che168-intake-'+p.runId+'-'+p.attempt&&x.state==='ready'&&
  x.owner?.runId===p.runId&&x.owner.attempt===p.attempt&&x.owner.revision===p.operator&&x.readyAt===p.readyAt&&x.updatedAt===p.readyAt&&
  x.releasePolicy==='published_generation_references'&&!x.coordination&&Array.isArray(x.references)&&x.references.length===4,
 'old_ready_custody_pin');
 check(x.references.every(r=>typeof r?.root==='string')&&new Set(x.references.map(r=>r.root)).size===4,'exact_reference_roles');
 const snapshots=x.references.filter(r=>r.kind==='che168-snapshot'),replicas=x.references.filter(r=>r.kind==='che168-replica'),
   journal=x.references.filter(r=>r.kind==='che168-journal');
 check(snapshots.length===1&&replicas.length===2&&journal.length===1&&snapshots[0].root.startsWith(SNAP)&&
  replicas.every(r=>r.root.startsWith(REF)&&UUID.test(r.root.slice(REF.length))),'exact_reference_roles');
 const binding=snapshots[0].root.slice(SNAP.length), oldRoots=replicas.filter(r=>SHA.test(r.sha256??'')),
  candidateRoots=replicas.filter(r=>!Object.hasOwn(r,'sha256'));
 check(SHA.test(binding)&&oldRoots.length===1&&candidateRoots.length===1,'reference_binding_shape');
 // Exact historical collector/checkpoint property order is a protocol input.
 // Reordering to key,sha256,binding,cursor generates a different namespace.
 const previous={key:oldRoots[0].root,binding,cursor:p.baseCursor,sha256:oldRoots[0].sha256};
 const journalBinding=digest({binding,initialCursor:p.baseCursor,base:previous,replayVersion:2});
 const journalId=BigInt('0x'+journalBinding.slice(0,14)).toString();
 check(journal[0].root===J+journalId,'exact_historical_journal_binding');
 return {binding,previous,journalBinding,journalRoot:journal[0].root,candidateRoot:candidateRoots[0].root};
}
function attestInputs(inputs,p,derived){
 const a=inputs.attested;
 // A read-only authority outside this pure/local adapter must pin these two
 // object digests under the exact old producer and current private control.
 // Do not derive their expected values from these same unauthenticated files.
 check(a?.producerRun===p.runId&&a.producerOperator===p.operator&&a.workerTree===p.workerTree&&
   a.controlSha256===p.activeControlSha&&a.controlRev===p.activeControlRev&&a.pinWireSha256===p.pinWireSha&&
   SHA.test(a.candidateManifestSha256??'')&&SHA.test(a.journalHeadSha256??'')&&
   a.pinAndHeadsRechecked===true&&a.privateObjectScopeAuthenticated===true,'separately_read_verified_object_authority_required');
 const m=decode(inputs.candidateManifestWire,2*M),j=decode(inputs.journalHeadWire,2*M);
 check(digest(m)===a.candidateManifestSha256&&digest(j)===a.journalHeadSha256,'candidate_or_journal_digest_drift');
 check(m.version===1&&m.binding===derived.binding&&uint(m.cursor,p.baseCursor+1)&&uint(m.bytes,1,16*1024*M)&&
   Array.isArray(m.parts)&&m.parts.length===Math.ceil(m.bytes/CHUNK)&&m.parts.length<=1024&&
   m.parts.every((part,i)=>part?.bytes===Math.min(CHUNK,m.bytes-i*CHUNK)&&SHA.test(part.sha256??'')),'candidate_manifest_binding');
 check(j.version===2&&j.binding===derived.journalBinding&&j.initialCursor===p.baseCursor&&j.cursor===m.cursor&&
   uint(j.changes,1,500000)&&uint(j.bytes,1,512*M)&&uint(j.rawBytes,1,8*1024*M)&&Array.isArray(j.chunks)&&
   j.chunks.length>=1&&j.chunks.length<=10000&&j.chunks.every(r=>UUID.test(r?.id??'')&&SHA.test(r.sha??''))&&
   new Set(j.chunks.map(r=>r.id)).size===j.chunks.length,'exact_terminal_head');
 return {m,j};
}
function verifyOffer(o,id){
 check(obj(o)&&typeof id==='string'&&ID.test(id)&&o.id===stable(id)&&o.sourceOfferId===id&&o.sourceId===SOURCE&&o.market==='china'&&
  o.operational?.provider==='auto-api.com'&&o.operational?.detailIdentityVerified===true,'replica_offer_identity');
}
function nonPriceHash(offer){
 const {sourcePrice,totalRub,calculationStatus,updatedAt,operational,...rest}=offer;
 const {lastSeenAt,che168PriceChangeId,...operations}=operational;
 return digest({rest,operations});
}
async function reconstructJournal(j,derived,readLocalJournalChunk){
 let cursor=j.initialCursor,changes=0,encBytes=0,rawBytes=0;
 const states=new Map(), withdrawals=new Map(), lastRemovalEvent=new Map(), missing=createChe168MissingDetails();
 const tally={offer:0,price:0,removed:0,quarantine:0,missing_detail:0};
 for(const descriptor of j.chunks){
  // Fixture/owner-approved offline port only receives one previously verified
  // immutable descriptor at a time. No arbitrary network or bucket name.
  const b=await readLocalJournalChunk(descriptor.id);
  const stored=decode(b,RAW_CHUNK);
  check(stored?.encoding==='gzip-base64'&&typeof stored.data==='string'&&digest(stored)===descriptor.sha,'journal_chunk_digest');
  const compressed=Buffer.from(stored.data,'base64');
  check(compressed.length>0&&compressed.toString('base64')===stored.data,'canonical_journal_compression');
  const decoded=gunzipSync(compressed,{maxOutputLength:RAW_CHUNK});
  const chunk=decode(decoded,RAW_CHUNK);
  check(chunk.binding===derived.journalBinding&&chunk.from===cursor&&uint(chunk.to,cursor+1,j.cursor)&&uint(chunk.changes,1,j.changes)&&
   Array.isArray(chunk.events)&&chunk.events.length===chunk.changes,'full_accepted_v4_one_event_per_change');
  encBytes+=Buffer.byteLength(JSON.stringify(stored));rawBytes+=Buffer.byteLength(JSON.stringify(chunk));changes+=chunk.changes;
  check(encBytes<=j.bytes&&rawBytes<=j.rawBytes&&changes<=j.changes,'journal_length_overrun');
  let previousEvent=cursor;
  for(const e of chunk.events){
   check(Object.hasOwn(tally,e?.kind)&&uint(e.event,previousEvent,chunk.to)&&validDate(e.at),'journal_order_or_event');
   const id=e.kind==='offer'?e.offer?.sourceOfferId:e.innerId;
   check(typeof id==='string'&&ID.test(id),'journal_source_id');
   previousEvent=e.event;
   tally[e.kind]++;
   missing.apply(e);
   const prior=states.get(id);
   if(e.kind==='offer'){
    verifyOffer(e.offer,id);
    states.set(id,{kind:'offer',event:e.event,offerSha:digest(e.offer),preservedNonPrice:nonPriceHash(e.offer)});
   }else if(e.kind==='price'){
    check(Number.isFinite(e.price)&&e.price>0&&prior?.kind!=='removed'&&prior?.kind!=='quarantine','price_cannot_reinsert');
    states.set(id,{kind:'price',event:e.event,price:e.price,at:e.at,preservedNonPrice:prior?.preservedNonPrice});
   }else if(e.kind==='removed'){
    // First occurrence seeds insertion order; newer removals replace the value.
    // A later re-add does NOT erase the historical report ledger.
    withdrawals.set(id,{id:stable(id),sourceId:SOURCE,sourceOfferId:id,market:'china',status:'removed',observedAt:e.at});
    lastRemovalEvent.set(id,e.event);states.set(id,{kind:'removed',event:e.event});
   }else if(e.kind==='quarantine'){
    check(['missing_model','invalid_year'].includes(e.reason),'unsupported_quarantine_reason');
    states.set(id,{kind:'quarantine',event:e.event,reason:e.reason});
   }
  }
  check(states.size<=500000&&withdrawals.size<=500000,'working_inventory_budget');
  cursor=chunk.to;
 }
 check(cursor===j.cursor&&changes===j.changes&&encBytes===j.bytes&&rawBytes===j.rawBytes,'journal_terminal_fence');
 missing.assertResolved();
 return {states,withdrawals,lastRemovalEvent,changes,tally};
}
async function replicaWire(pathname,manifest){
 check(typeof pathname==='string'&&path.isAbsolute(pathname)&&await fs.realpath(pathname)===pathname,'local_replica_only');
 const f=await fs.open(pathname,fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW),h=hash();
 try{
  const before=await f.stat();
  check(before.isFile()&&(before.mode&0o077)===0&&before.size===manifest.bytes,'read_only_private_replica_shape');
  let offset=0;
  for(let i=0;i<manifest.parts.length;i++){
    const part=manifest.parts[i],b=Buffer.allocUnsafe(part.bytes);
    let position=0;
    while(position<b.length){const {bytesRead}=await f.read(b,position,b.length-position,offset+position);
      check(bytesRead>0,'replica_part_short');position+=bytesRead;}
    if(i===0)check(b.subarray(0,16).equals(Buffer.from('SQLite format 3\0'))&&b[18]===1&&b[19]===1,'closed_sqlite_replica');
    check(sha(b)===part.sha256,'ordered_candidate_part_hash');h.update(b);offset+=part.bytes;
  }
  const after=await f.stat();
  check(after.size===before.size&&after.ino===before.ino&&after.ctimeMs===before.ctimeMs&&after.mtimeMs===before.mtimeMs&&offset===manifest.bytes,'replica_file_changed');
  return {before,bytes:offset,sha256:h.digest('hex')};
 }finally{await f.close();}
}
async function inspectCandidate(filename,manifest,chain,earliestEvent){
 const asFile=await replicaWire(filename,manifest),db=new DatabaseSync(filename,{readOnly:true,allowExtension:false});
 const seenChanges=new Set(),inventory=hash().update('[');
 let count=0,activeChanged=0,unchangedNotIndependentlyReplayed=0,priceOnlyBaseFieldsUnproved=0,reappearanceCount=0;
 try{
  db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA cache_size=-16384;');
  const schema=db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name COLLATE BINARY').all();
  const tbl=schema.find(x=>x.type==='table'&&x.name==='inventory');
  check(schema.length===2&&tbl?.tbl_name==='inventory'&&tbl.sql.replace(/\s/g,'').toLowerCase()===
   'createtableinventory(idtextprimarykey,payloadtextnotnull,eventintegernotnull)'&&
   schema.some(r=>r.type==='index'&&r.name==='sqlite_autoindex_inventory_1'&&r.tbl_name==='inventory'&&r.sql===null),'replica_schema');
  const integrity=db.prepare('PRAGMA integrity_check').all();
  check(integrity.length===1&&integrity[0].integrity_check==='ok','replica_integrity');
  const pageSize=Number(db.prepare('PRAGMA page_size').get().page_size),pageCount=Number(db.prepare('PRAGMA page_count').get().page_count);
  check(uint(pageSize,512,65536)&&uint(pageCount,1)&&pageSize*pageCount===asFile.bytes,'replica_page_length');
  let prev='';
  for(const row of db.prepare('SELECT id,payload,event FROM inventory ORDER BY id COLLATE BINARY').iterate()){
   check(row.id>prev&&ID.test(row.id)&&typeof row.payload==='string'&&Buffer.byteLength(row.payload)<=M&&uint(row.event,earliestEvent,manifest.cursor),
      'candidate_inventory_row_bounds');prev=row.id;
   const o=JSON.parse(row.payload);verifyOffer(o,row.id);check(JSON.stringify(o)===row.payload,'candidate_payload_order');
   if(count++)inventory.update(',');
   check(count<=500000,'candidate_row_budget');inventory.update(JSON.stringify([row.id,sha(row.payload),row.event]));
   const change=chain.states.get(row.id);
   if(!change){unchangedNotIndependentlyReplayed++;continue;}
   check(change.kind==='offer'||change.kind==='price','journal_removed_or_quarantined_present');
   check(change.event===row.event,'candidate_latest_event_mismatch');
   if(change.kind==='offer')check(change.offerSha===digest(o),'journal_offer_body_mismatch');
   else{
    check(o.sourcePrice===change.price&&o.updatedAt===change.at&&o.operational.lastSeenAt===change.at&&
      o.operational.che168PriceChangeId===change.event&&o.totalRub===null&&o.calculationStatus==='needs_data','journal_latest_price_mismatch');
    if(change.preservedNonPrice)check(change.preservedNonPrice===nonPriceHash(o),'price_changed_non_price_fields');
    else priceOnlyBaseFieldsUnproved++;
   }
   seenChanges.add(row.id);activeChanged++;
   if(chain.withdrawals.has(row.id))reappearanceCount++;
  }
  check(count>0,'candidate_empty_inventory');
  for(const [id,s] of chain.states)if(s.kind==='offer'||s.kind==='price')check(seenChanges.has(id),'active_journal_id_missing_from_candidate');
 }finally{db.close();}
 const after=await fs.lstat(filename);
 check(after.ino===asFile.before.ino&&after.size===asFile.before.size&&after.ctimeMs===asFile.before.ctimeMs&&after.mtimeMs===asFile.before.mtimeMs,
   'replica_file_changed');
 return {inventoryRows:count,activeChanged,unchangedNotIndependentlyReplayed,priceOnlyBaseFieldsUnproved,reappearanceCount,
   inventoryPayloadLedgerSha256:inventory.update(']').digest('hex'),candidateReplicaBytes:asFile.bytes,candidateReplicaFileSha256:asFile.sha256};
}

// Only the independently authenticated runner needs opaque next keys. Keep
// these functions out of ordinary stdout and never let a supplied URL choose.
export function exactV4PinRoles(pinWire){return derive(pinWire,pinContext);}
export function exactV4SealedReadPlan(input){
 const expected=derive(input.pinWire,pinContext);
 const {m,j}=attestInputs(input,pinContext,expected);
 return {expected,manifest:m,journal:j};
}
// Existing old pin and historical parts must be independently authorized.
export async function reconstructExactOldWithdrawalsOnly(input){
 const derived=derive(input.pinWire,pinContext),{j}=attestInputs(input,pinContext,derived);
 check(j.chunks.length===91&&j.changes===57020&&j.cursor===13180841&&
   digest(j)==='36c279e55fd61db002a85b7720fd32980124ce4d60ea08cb8f985d9f2359f9c2','exact_prior_journal');
 const chain=await reconstructJournal(j,derived,input.readLocalJournalChunk);
 const rows=[...chain.withdrawals.entries()].map(([id,w])=>({...w,confirmedRemovalEvent:chain.lastRemovalEvent.get(id),
   terminalChangedEvent:chain.states.get(id)?.event??null,
   ...(chain.states.has(id)&&['offer','price'].includes(chain.states.get(id).kind)?{terminalCandidateStatus:'present_reinserted'}:{terminalCandidateStatus:'absent'})}));
 check(rows.length===19547&&digest(rows)==='25f24d9e17b4bdcabe0a1f89fa8b2b8a76f7f573a4d69dccd4a2dea9f56a524f','prior_withdrawal_typed_digest');
 return {privateByteWire:Buffer.from(JSON.stringify(rows)),acceptedBaseNativeDescriptor:derived.previous};
}
export function inspectExactV4Custody(input){return build(input,pinContext);}
export function rehearseCustody(input,p){return build(input,p);}
async function build(input,p){
 check(validDate(p.lowerBound)&&validDate(p.readyAt)&&Date.parse(p.lowerBound)<Date.parse(p.readyAt),'completion_interval_authentication');
 const derived=derive(input.pinWire,p),{m,j}=attestInputs(input,p,derived);
 // Bind the exact original snapshot config bytes; a caller must never
 // nominate a different old cursor or interpret event time as as-of UTC.
 const config=decode(input.snapshotConfigWire,128*1024);
 check(typeof input.readLocalJournalChunk==='function'&&sha(input.snapshotConfigWire)===p.snapshotConfigWireSha&&digest(config)===derived.binding&&
   config.version===1&&uint(config.initialCursor,1,p.baseCursor)&&validDate(config.modifiedAt),'snapshot_ancestry');
 const chain=await reconstructJournal(j,derived,input.readLocalJournalChunk);
 const inventory=await inspectCandidate(input.localCandidateReplica,m,chain,config.initialCursor-1);
 const nativeLedger=[...chain.withdrawals.values()];
 const privateLedger=[...chain.withdrawals.entries()].map(([id,w])=>({...w,confirmedRemovalEvent:chain.lastRemovalEvent.get(id),terminalChangedEvent:chain.states.get(id)?.event??null,
   ...(chain.states.has(id)&&['offer','price'].includes(chain.states.get(id).kind)?{terminalCandidateStatus:'present_reinserted'}:{terminalCandidateStatus:'absent'})}));
 const quarantine={missing_model:0,invalid_year:0};
 for(const s of chain.states.values())if(s.kind==='quarantine')quarantine[s.reason]++;
 const receipt={
   version:1,kind:'china_v4_private_forensic_custody_v1',oldProducerRun:p.runId,oldWorkerTree:p.workerTree,
   acceptedStartCursor:p.baseCursor,candidateTerminalCursor:m.cursor,
   candidateManifestSha256:digest(m),journalHeadSha256:digest(j),journalChanges:chain.changes,journalEventKinds:chain.tally,
   ...inventory,withdrawalLedgerCount:privateLedger.length,nativeWithdrawalFieldSha256:digest(nativeLedger),custodyReconciledWithdrawalSha256:digest(privateLedger),quarantine,
   absentAfterConfirmedRemove:privateLedger.length-inventory.reappearanceCount,
   completionInterval:{notBefore:p.lowerBound,notAfter:p.readyAt,notAnExactObservationUtc:true,
     lowerProof:'official_protected_step_earliest',upperProof:'authenticated_old_ready_pin_after_collection'},
   exactCompletedAt:null,wholeSourceFreshnessWitness:false,providerEndResponsePersisted:false,
   sourceCompletenessAdmissionsAuthorized:false,untouchedBaseInventoryEqualityProven:false,
   nativeReportReconstructed:false,archivalCustodyOnly:true,providerRequests:0,storageWrites:0,publicationAuthorized:false,cursorAdvanced:false,
 };
 // Keep raw source keys/IDs out of formatted stdout. This data is only for the
 // caller's approved private custody process; it cannot function as a report.
 return {receipt,privateLedger,nativeWithdrawalsForPrivateEvidenceOnly:nativeLedger};
}

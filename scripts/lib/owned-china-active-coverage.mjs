import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {rawDigest} from './catalog-raw-provenance.mjs';
import {withRawReadProtection} from './catalog-raw-session.mjs';
import {assertChe168ReplicaInputWitness,verifyChe168ReplicaInput} from './che168-replica-witness.mjs';

const sourceId='autohome_used_china_open';
const identity=id=>createHash('sha256').update(sourceId+':'+id).digest('hex').slice(0,24);

// An immutable archived producer witness is usable only in the exact report
// and invocation that produced it. Otherwise restore the actual SQLite replica.
export async function verifiedOwnedReplica({prepared,storage,readerOwner,config,temporaryParent}){
 const raw=JSON.parse(await fs.readFile(path.join(prepared.directory,'report.json'),'utf8'));
 assert.equal(rawDigest(raw),prepared.receipt.reportDigest,'owned_replica_report');
 const {sourceInputWitness,...original}=raw;
 const source=raw.sources[0],owner=prepared.receipt.owner;
 const producer={runId:owner.runId,attempt:owner.attempt,sourceSha:owner.revision};
 const reference=source.replica;
 const witness=sourceInputWitness?assertChe168ReplicaInputWitness(sourceInputWitness):
  await withRawReadProtection({storage,owner:readerOwner,references:[
   {kind:'che168-replica',root:reference.key,sha256:reference.sha256},
   {kind:'che168-journal',root:source.workingJournal.key},
  ],read:scoped=>verifyChe168ReplicaInput({storage:scoped,directory:prepared.directory,config,producer,temporaryParent})});
 const {snapshot,replicaReadback}=witness;
 assert.deepEqual(witness.producer,producer,'owned_replica_owner');
 assert.equal(replicaReadback.completion.reportSha256,rawDigest(original),'owned_replica_report_binding');
 assert.equal(snapshot.root,reference.key,'owned_replica_root');
 assert.equal(snapshot.completeSha256,reference.sha256,'owned_replica_digest');
 assert.equal(snapshot.rows,prepared.plan.sourceArchiveRows,'owned_replica_count');
 assert.equal(snapshot.completedAt,raw.completedAt,'owned_replica_clock');
 assert.equal(replicaReadback.binding,source.snapshotBinding,'owned_replica_binding');
 assert.equal(replicaReadback.cursor,prepared.plan.source.cursor.sequence,'owned_replica_cursor');
 assert.equal(replicaReadback.replayInitialCursor,source.initialCursor,'owned_replica_initial');
 assert.equal(replicaReadback.completion.changes,source.changes,'owned_replica_changes');
 return witness;
}

export async function ownedChinaCoverage({prepared,witness,incumbentIds,incumbent,onConfirmedRemoval}){
 const activeIds=new Set(),previousIds=new Set(),withdrawals=new Set(prepared.report.confirmedWithdrawals.map(row=>row.id));
 const src=prepared.report.sources[0];
 for await(const rows of prepared.chunks())for(const row of rows){
  assert(row?.market==='china'&&row.sourceId===sourceId&&row.status==='active'&&
   typeof row.sourceOfferId==='string'&&/^\d{1,32}$/.test(row.sourceOfferId)&&row.id===identity(row.sourceOfferId)&&
   row.operational?.detailIdentityVerified===true&&row.operational.provider==='auto-api.com','owned_active_identity');
  const v=row.operational.che168ActiveVerification;
  assert(v?.method==='snapshot_and_complete_change_stream'&&v.snapshotBinding===src.snapshotBinding&&
   v.cursor===src.cursor&&v.verifiedAt===prepared.report.completedAt&&!activeIds.has(row.id),'owned_active_verification');
  activeIds.add(row.id);
 }
 assert.equal(activeIds.size,witness.normalized.rows,'owned_active_count');
 assert.equal(rawDigest([...activeIds].sort()),witness.normalized.idsSha256,'owned_active_set');
 let retained=0,explicitlyRemoved=0,absentFromReplica=0;
 for await(const id of incumbentIds()){
  assert(typeof id==='string'&&id.length>0&&!previousIds.has(id),'owned_incumbent_duplicate');
  previousIds.add(id);
  if(activeIds.has(id))retained++;
  else if(withdrawals.has(id)){explicitlyRemoved++;onConfirmedRemoval?.(id);}
  else absentFromReplica++;
 }
 assert.equal(previousIds.size,incumbent.rows,'owned_incumbent_count');
 await prepared.assertCurrent();
 return {generationId:incumbent.generationId,previouslyPublished:previousIds.size,sourceActive:activeIds.size,
  previouslyPublishedStillInSource:retained,previouslyPublishedExplicitlyRemoved:explicitlyRemoved,
  previouslyPublishedAbsentWithoutRemovalEvent:absentFromReplica,sourceIdsOutsidePublishedInventory:activeIds.size-retained,
  activeIdsSha256:witness.normalized.idsSha256};
}

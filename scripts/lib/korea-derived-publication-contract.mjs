import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
export const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');const sha=x=>createHash('sha256').update(x).digest('hex');
const PARENT_RUN='44056968938',PARENT_SHA='32fe1c71a4d102c677a1f67686f2190d4102f086';
const absent=(o,k)=>!Object.prototype.hasOwnProperty.call(o,k);
function nondate(row){const x=structuredClone(row);delete x.offer.productionDate;delete x.offer.productionYear;delete x.offer.operational.semanticEvidence.productionDate;return x;}
/** Read-only publication prerequisite, NOT authority to publish. expectedPins must
 * come from separately approved external pins file, never incoming report. Adapter
 * verifies remote own archives and passes exhaustive before/after shard bytes. */
export async function verifyKoreaDerivedPublication({expectedPins,actualPublisherSourceSha,intake,incomingReport,ownReceipt,parentReport,parentReceipt,parentPreparation,shardPairs}){
 const p=expectedPins;assert.ok(p&&p.version===1&&p.kind==='approved_korea_derived_publication_pins','derived_external_pins_required');
 for(const k of ['derivedReceiptSha256','overlayReceiptSha256','parentReceiptSha256','parentPreparationSha256'])assert.match(p[k]||'',/^[a-f0-9]{64}$/,'derived_missing_pin');
 for(const k of ['workerSha','publisherSourceSha'])assert.match(p[k]||'',/^[a-f0-9]{40}$/,'derived_missing_source_pin');
 assert.equal(actualPublisherSourceSha,p.publisherSourceSha,'derived_publisher_source');
 assert.equal(digest(ownReceipt),p.derivedReceiptSha256,'derived_own_receipt');assert.equal(ownReceipt.owner?.revision,p.workerSha,'derived_worker_source');assert.equal(ownReceipt.market,'korea');assert.notEqual(ownReceipt.owner?.runId,PARENT_RUN);
 assert.equal(digest(parentReceipt),p.parentReceiptSha256,'derived_parent_receipt');assert.equal(parentReceipt.owner?.runId,PARENT_RUN);assert.equal(parentReceipt.owner?.attempt,'1');assert.equal(parentReceipt.owner?.revision,PARENT_SHA);assert.equal(parentReceipt.market,'korea');
 assert.equal(digest(parentPreparation),p.parentPreparationSha256,'derived_parent_preparation');
 assert.equal(digest(parentReport),parentReceipt.reportDigest,'derived_parent_report');assert.equal(digest(intake),ownReceipt.reportDigest,'derived_report');
 assert.ok(incomingReport&&absent(incomingReport,'paidInputWitness'),'derived_incoming_witness_forbidden');
 // Exact attachIntakeArchiveReceipt + catalog disk conversion shape. No other
 // mutation (including authority metadata) is permitted on incoming report.
 assert.ok(Array.isArray(intake.rawStoragePins)&&intake.rawStoragePins.length<64,'derived_pin_limit');
 const byOperation=new Map();for(const pin of intake.rawStoragePins){assert.ok(typeof pin.operationId==='string'&&pin.operationId,'derived_pin_identity');const prior=byOperation.get(pin.operationId);assert.ok(!prior||digest(prior)===digest(pin),'derived_pin_conflict');byOperation.set(pin.operationId,pin);}
 const ownHandoff=ownReceipt.handoff;assert.ok(ownHandoff&&typeof ownHandoff.operationId==='string'&&ownHandoff.operationId,'derived_own_pin');
 const priorOwn=byOperation.get(ownHandoff.operationId);assert.ok(!priorOwn||digest(priorOwn)===digest(ownHandoff),'derived_own_pin_conflict');byOperation.set(ownHandoff.operationId,ownHandoff);
 assert.ok(Array.isArray(intake.sources),'derived_sources');
 const expectedIncoming={...intake,durableIntakeArchive:ownReceipt,rawStoragePins:[...byOperation.values()],sources:intake.sources.map(source=>({...source,mode:'live',freshSaved:source.observations||0}))};
 assert.deepEqual(incomingReport,expectedIncoming,'derived_incoming_report_changed');
 assert.ok(absent(intake,'paidInputWitness'),'derived_outer_witness_forbidden');assert.equal(intake.completeSourceReplacement,false,'derived_complete_replacement_forbidden');
 const d=intake.savedDateOverlay;assert.ok(d&&d.version===1,'derived_lineage_required');assert.equal(d.kind,'derived_encar_manufacture_overlay');assert.equal(d.independentNormalizedWitnessReused,false);assert.deepEqual(d.sourceArchive,parentReceipt);assert.deepEqual(d.sourceReport,parentReport);
 const r=d.receipt;assert.equal(digest(r),p.overlayReceiptSha256,'derived_overlay_pin');assert.equal(d.overlayReceiptSha256,p.overlayReceiptSha256);assert.equal(r.sourceReportSha256,digest(parentReport),'derived_source_report_bytes');
 assert.equal(r.kind,d.kind);assert.equal(r.publicationAcceptance,false);assert.equal(r.retirementAcceptance,false);
 assert.equal(parentReport.snapshotRun,'43989797288');assert.equal(String(parentReport.snapshotAttempt),'1');assert.equal(parentReport.savedRevisionSelection.snapshotSha256,'c34e0546b1214a3829b7b6317f87c2ff3be05ff8bc9cd7c0ec5db0e212b7ac43');
 assert.deepEqual(intake.savedRevisionSelection,parentReport.savedRevisionSelection);assert.deepEqual(r.selection,parentReport.savedRevisionSelection);assert.deepEqual(intake.savedRevisionQuarantine,parentReport.savedRevisionQuarantine);assert.equal(r.quarantineSha256,digest(parentReport.savedRevisionQuarantine));
 assert.equal(intake.rawRetirementBlocked,r.selection.quarantinedIds?'saved_revision_quarantine':'derived_manufacture_overlay');
 const {paidInputWitness,durableIntakeArchive,...original}=parentReport;const pins=[...(original.rawStoragePins||[])];assert.ok(parentReceipt.handoff?.key);if(!pins.some(x=>x.key===parentReceipt.handoff.key))pins.push(parentReceipt.handoff);
 const expectedIntake={...original,rawStoragePins:pins,rawRetirementBlocked:intake.rawRetirementBlocked,completeSourceReplacement:false,savedDateOverlay:d};assert.deepEqual(intake,expectedIntake,'derived_report_nondate_change');
 assert.ok(Array.isArray(r.shards)&&r.shards.length>0&&r.shards.length<=10000);const entries=new Map(r.shards.map(x=>[x.name,x]));assert.equal(entries.size,r.shards.length,'derived_duplicate_shards');
 const seenShards=new Set(),seenIds=new Set(),quarantined=new Set(parentReport.savedRevisionQuarantine.entries.map(x=>x.sourceOfferId));let observations=0,changed=0;
 assert.equal(r.observedAt,parentReport.completedAt);assert.equal(intake.completedAt,r.observedAt);
 for await(const pair of shardPairs){const entry=entries.get(pair.name);assert.ok(entry&&!seenShards.has(pair.name),'derived_shard_coverage');assert.match(pair.name,/^encar_direct-\d{6}\.jsonl$/);seenShards.add(pair.name);
  const [a,b]=[pair.beforeBytes,pair.afterBytes].map(x=>{assert.ok(Buffer.isBuffer(x)&&x.length>0&&x.length<=16*1024*1024,'derived_shard_bound');assert.equal(x.at(-1),10);return x;});assert.equal(sha(a),entry.beforeSha256,'derived_before_hash');assert.equal(sha(b),entry.afterSha256,'derived_after_hash');
  const [before,after]=[a,b].map(x=>x.toString('utf8').slice(0,-1).split('\n'));assert.equal(before.length,after.length);assert.equal(before.length,entry.rows);
  for(let i=0;i<before.length;i++){const x=JSON.parse(before[i]),y=JSON.parse(after[i]);assert.equal(JSON.stringify(x),before[i],'derived_noncanonical');assert.equal(JSON.stringify(y),after[i],'derived_noncanonical');assert.equal(JSON.stringify(nondate(x)),JSON.stringify(nondate(y)),'derived_nondate_changed');const o=y.offer;
   assert.equal(y.stage,'detail');assert.equal(y.observedAt,r.observedAt);assert.equal(o.market,'korea');assert.equal(o.sourceId,'encar_direct');assert.ok(!seenIds.has(o.sourceOfferId)&&!quarantined.has(o.sourceOfferId),'derived_duplicate_quarantine');seenIds.add(o.sourceOfferId);observations++;
   if(before[i]!==after[i]){changed++;const e=o.operational.semanticEvidence.productionDate;assert.equal(e.status,'exact');assert.equal(e.source,'auto_api_encar:v3:year_month:production');assert.equal(e.observedAt,r.observedAt);assert.match(e.value,/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/);assert.equal(o.productionDate,e.value);assert.equal(o.productionYear,Number(e.value.slice(0,4)));assert.ok(Date.parse(e.value+'-01T00:00:00Z')<=Date.parse(r.observedAt));}
  }
 }
 assert.equal(seenShards.size,entries.size,'derived_missing_shard');assert.equal(observations,r.observations);assert.equal(changed,r.changed);assert.equal(observations,parentReport.sources[0].observations);assert.equal(seenIds.size,parentReport.sources[0].uniqueOffers);
 return Object.freeze({verified:true,publicationAuthorized:false,retirementAuthorized:false,observations,changed,derivedReceiptSha256:p.derivedReceiptSha256,selectionSha256:r.selection.selectionSha256});
}

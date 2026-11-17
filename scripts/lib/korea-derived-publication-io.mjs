import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {verifyKoreaDerivedPublication,digest} from './korea-derived-publication-contract.mjs';
import {assertLocalIntakeArchive,verifyIntakeArchive} from './nonjp-intake-archive.mjs';import {withRawReadProtection} from './catalog-raw-session.mjs';import {verifySavedEncarActualCoverage} from './saved-encar-actual-coverage.mjs';
const guardAuthorities=new WeakMap();
export async function verifyDerivedDateGuard({guard,operationId,intake}){const a=guardAuthorities.get(guard);assert.ok(a,'derived_guard_capability_required');assert.equal(digest(intake),a.intakeSha256,'derived_guard_intake_changed');await guard.verifyAuthority({operationId});return structuredClone(a);}
const sha=x=>createHash('sha256').update(x).digest('hex');
async function bytes(file,max=16*1024*1024){const stat=await fs.lstat(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=max,'derived_local_file_bound');const b=await fs.readFile(file);assert.equal(b.length,stat.size);return b;}
import {assertDerivedPricingRuntime} from './korea-derived-runtime-parity.mjs';
/** Must be created before any derived input can enter publication. Missing
 * external pins, original archives, full coverage or serving parity is fatal. */
export async function createDerivedDatePublicationGuard({storage,intakeDirectory,incomingReport,incomingOffers,expectedFile,expectedFileSha256,preparationFile,publisherRoot=process.cwd(),runtimeRoot,expectedRuntimeRelease,onProgress=()=>{}}){
 assert.match(expectedFileSha256||'',/^[a-f0-9]{64}$/,'derived_external_file_pin');assert.ok(intakeDirectory&&expectedFile&&preparationFile,'derived_required_paths');const approvedBytes=await bytes(expectedFile,65536);assert.equal(sha(approvedBytes),expectedFileSha256,'derived_external_file_changed');const expectedPins=JSON.parse(approvedBytes);
 const sourceSha=execFileSync('git',['rev-parse','HEAD'],{cwd:publisherRoot,encoding:'utf8'}).trim();assert.equal(sourceSha,expectedPins.publisherSourceSha);
 const runtimeClosure=assertDerivedPricingRuntime({publisherRoot,runtimeRoot,expectedRelease:expectedRuntimeRelease});
 const ownReceipt=JSON.parse(await bytes(path.join(intakeDirectory,'own-storage-receipt.json'),4*1024*1024));assert.equal(digest(ownReceipt),expectedPins.derivedReceiptSha256);const ownManifest=await assertLocalIntakeArchive({storage,directory:intakeDirectory,receipt:ownReceipt});
 const intake=JSON.parse(await bytes(path.join(intakeDirectory,'report.json'),4*1024*1024)),parentReceipt=intake.savedDateOverlay?.sourceArchive;assert.equal(digest(parentReceipt),expectedPins.parentReceiptSha256);const parentPreparation=JSON.parse(await bytes(preparationFile,4*1024*1024));assert.equal(digest(parentPreparation),expectedPins.parentPreparationSha256);
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'derived-parent-'));const parentDir=path.join(tmp,'archive');
 let proof,coverage;const incoming=new Map();assert.ok(Array.isArray(incomingOffers)&&incomingOffers.length<=500000);for(const o of incomingOffers){assert.ok(o?.id&&!incoming.has(o.id),'derived_incoming_duplicate');incoming.set(o.id,digest(o));}
 try{
  onProgress({stage:'derived_restore_parent'});const parentManifest=await verifyIntakeArchive({storage,receipt:parentReceipt,directory:parentDir});const parentReport=JSON.parse(await bytes(path.join(parentDir,'report.json'),4*1024*1024));
  const ownShards=ownManifest.files.filter(x=>x.name.endsWith('.jsonl')),parentShards=parentManifest.files.filter(x=>x.name.endsWith('.jsonl'));assert.deepEqual(ownShards.map(x=>x.name).sort(),parentShards.map(x=>x.name).sort());
  async function* pairs(){let rows=0;for(const [i,f] of ownShards.entries()){const beforeBytes=await bytes(path.join(parentDir,f.name)),afterBytes=await bytes(path.join(intakeDirectory,f.name));assert.equal(sha(afterBytes),f.sha256);for(const line of afterBytes.toString('utf8').trimEnd().split('\n')){const o=JSON.parse(line).offer;assert.equal(incoming.get(o.id),digest(o),'derived_converted_offer_changed');incoming.delete(o.id);rows++;}yield{name:f.name,beforeBytes,afterBytes};if((i+1)%100===0)onProgress({stage:'derived_publication_lineage',shards:i+1,rows});}assert.equal(incoming.size,0,'derived_incoming_coverage');}
  proof=await verifyKoreaDerivedPublication({expectedPins,actualPublisherSourceSha:sourceSha,intake,incomingReport,ownReceipt,parentReport,parentReceipt,parentPreparation,shardPairs:pairs()});
  const sourceRoot='catalog/intake-staging/encar/43989797288/1',snapshot=await storage.readJson(sourceRoot+'/complete.json',null);
  async function* observations(){for(const f of ownShards){const b=await bytes(path.join(intakeDirectory,f.name));assert.equal(sha(b),f.sha256);for(const line of b.toString('utf8').trimEnd().split('\n'))yield JSON.parse(line);}}
  const coverageExpected={run:'43989797288',attempt:'1',producerSha:'e51f589f892babdcd6c1251e1ebb06c6d7c91e6d',snapshotSha256:'c34e0546b1214a3829b7b6317f87c2ff3be05ff8bc9cd7c0ec5db0e212b7ac43',intakeSha256:digest(intake),preparationSha256:expectedPins.parentPreparationSha256};
  onProgress({stage:'derived_publication_actual_coverage'});coverage=await withRawReadProtection({storage,references:[{kind:'encar-reports',root:parentPreparation.root.replace(/\/$/,''),sha256:parentPreparation.completeDigest}],read:async scoped=>{
   const after=await verifySavedEncarActualCoverage({readJson:key=>scoped.readJson(key,null),observations:observations(),intake,preparation:parentPreparation,snapshot,expected:coverageExpected});
   async function* parentObservations(){for(const f of parentShards){const b=await bytes(path.join(parentDir,f.name));assert.equal(sha(b),f.sha256);for(const line of b.toString('utf8').trimEnd().split('\n'))yield JSON.parse(line);}}
   const before=await verifySavedEncarActualCoverage({readJson:key=>scoped.readJson(key,null),observations:parentObservations(),intake:parentReport,preparation:parentPreparation,snapshot,expected:{...coverageExpected,intakeSha256:digest(parentReport)}});
   assert.equal(before.reportIdsSha256,after.reportIdsSha256);assert.equal(before.normalizedIdsSha256,after.normalizedIdsSha256);return{before,after};
  }});
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
 let operation;
 const guard=Object.freeze({proof,coverage,runtimeClosure,async verifyAuthority({operationId}){assert.ok(operationId);if(operation)assert.equal(operationId,operation,'derived_operation_changed');operation=operationId;assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:publisherRoot,encoding:'utf8'}).trim(),expectedPins.publisherSourceSha,'derived_publisher_source_changed');assert.equal(sha(await bytes(expectedFile,65536)),expectedFileSha256);assert.equal(assertDerivedPricingRuntime({publisherRoot,runtimeRoot,expectedRelease:expectedRuntimeRelease}),runtimeClosure);assert.equal(digest(await storage.readJson(ownReceipt.root+'/complete.json',null)),ownReceipt.manifestSha256);assert.equal(digest(await storage.readJson(parentReceipt.root+'/complete.json',null)),parentReceipt.manifestSha256);assert.equal(digest(await storage.readJson(parentPreparation.root+'complete.json',null)),parentPreparation.completeDigest);await assertLocalIntakeArchive({storage,directory:intakeDirectory,receipt:ownReceipt});}});
 guardAuthorities.set(guard,{intakeSha256:digest(incomingReport),inputRows:incomingOffers.map(o=>({id:o.id,sourceOfferId:o.sourceOfferId,sha256:digest(o)})),
   authority:{publisherSourceSha:sourceSha,workerSha:expectedPins.workerSha,expectedPinsFileSha256:expectedFileSha256,derivedReceiptSha256:expectedPins.derivedReceiptSha256,parentReceiptSha256:expectedPins.parentReceiptSha256,
    parentPreparationSha256:expectedPins.parentPreparationSha256,overlayReceiptSha256:expectedPins.overlayReceiptSha256,
    selectionSha256:proof.selectionSha256,quarantineSha256:digest(intake.savedRevisionQuarantine),runtimeClosure,
    parentRoot:parentReceipt.root,parentManifestSha256:parentReceipt.manifestSha256,derivedRoot:ownReceipt.root,derivedManifestSha256:ownReceipt.manifestSha256,coverageSha256:digest(coverage)},
   quarantinedIds:intake.savedRevisionQuarantine.entries.map(x=>x.sourceOfferId),rawRetirementAuthorized:false});
 return guard;
}

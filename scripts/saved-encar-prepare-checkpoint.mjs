import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {execFileSync} from 'node:child_process';
import {getJsonStorage} from '../apps/web/lib/data.ts';import {readCollectionControls} from '../apps/web/lib/catalog/collection-controls.ts';
import {collectionEnabled} from '../apps/web/lib/catalog/collection-controls-schema.ts';
import {rawDigest,assertRawHandoff} from './lib/catalog-raw-provenance.mjs';
import {assertLocalIntakeArchive} from './lib/nonjp-intake-archive.mjs';
const mode=process.argv[2];assert.ok(['before','after'].includes(mode));
const sourceSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.equal(sourceSha,process.env.GITHUB_SHA);
const expected={run:'43989797288',attempt:'1',producer:'e51f589f892babdcd6c1251e1ebb06c6d7c91e6d',snapshot:'c34e0546b1214a3829b7b6317f87c2ff3be05ff8bc9cd7c0ec5db0e212b7ac43'};
assert.equal(process.env.ENCAR_SNAPSHOT_RUN,expected.run);assert.equal(process.env.ENCAR_SNAPSHOT_ATTEMPT,expected.attempt);
assert.equal(process.env.ENCAR_SNAPSHOT_PRODUCER_SHA,expected.producer);assert.equal(process.env.ENCAR_SNAPSHOT_SHA256,expected.snapshot);
const storage=getJsonStorage(),controls=await readCollectionControls(storage);assert.ok(collectionEnabled(controls,'encar_feed'),'prepare_source_disabled');
const sourceControls={market:controls.markets.korea,source:controls.sources.encar_feed};
const snapshot=await storage.readJson(`catalog/intake-staging/encar/${expected.run}/${expected.attempt}/complete.json`,null);
assert.equal(rawDigest(snapshot),expected.snapshot);assert.equal(snapshot.producerSha,expected.producer);assert.equal(snapshot.pages,10198);assert.equal(snapshot.count,203948);
const manifest=await storage.readJson('catalog/manifest.json',null);assert.ok(manifest?.generationId);
await fs.mkdir('saved-encar-checkpoint',{recursive:true});
if(mode==='before'){
 await fs.writeFile('saved-encar-checkpoint/before.json',JSON.stringify({sourceSha,expected,sourceControls,controlsRevision:controls.revision,manifestSha256:rawDigest(manifest),generationId:manifest.generationId,prepared:false,published:false,installed:false,retirementReady:false},null,2));
 console.log(JSON.stringify({stage:'saved_encar_before',sourceSha,generationId:manifest.generationId,controlsRevision:controls.revision,sourceEnabled:true}));
}else{
 const before=JSON.parse(await fs.readFile('saved-encar-checkpoint/before.json','utf8'));assert.equal(before.sourceSha,sourceSha);assert.deepEqual(sourceControls,before.sourceControls,'prepare_source_controls_changed');
 const dir=process.env.CATALOG_INTAKE_DIR||'catalog-intake-korea',report=JSON.parse(await fs.readFile(dir+'/report.json','utf8'));
 const receipt=JSON.parse(await fs.readFile(dir+'/own-storage-receipt.json','utf8'));
 const preparation=JSON.parse(await fs.readFile(process.env.PAID_REPORT_OUTPUT||'paid-encar-report-preparation.json','utf8'));
 const s=report.savedRevisionSelection,q=report.savedRevisionQuarantine,source=report.sources[0];
 assert.equal(report.market,'korea');assert.equal(report.snapshotRun,expected.run);assert.equal(report.snapshotAttempt,expected.attempt);assert.equal(report.completed,true);
 assert.equal(s.snapshotSha256,expected.snapshot);assert.equal(s.rawRows,203948);assert.equal(s.uniqueIds,203925);
 assert.equal(s.rawRows,s.publishableIds+s.supersededRows+s.quarantinedRows);assert.equal(s.uniqueIds,s.publishableIds+s.quarantinedIds);
 assert.equal(rawDigest(q),s.quarantineSha256);assert.equal(q.entries.length,s.quarantinedIds);
 assert.equal(q.entries.reduce((n,x)=>n+x.versions.length,0),s.quarantinedRows);
 assert.equal(source.observations+source.excluded+source.superseded+source.quarantined,s.rawRows);
 assert.equal(source.uniqueOffers,source.observations);assert.equal(source.superseded,s.supersededRows);assert.equal(source.quarantined,s.quarantinedRows);
 assert.equal(preparation.completed,true);assert.equal(preparation.rowCount,s.publishableIds);assert.equal(preparation.total,s.rawRows);assert.equal(preparation.duplicates,s.supersededRows);assert.equal(preparation.quarantined,s.quarantinedRows);assert.deepEqual(preparation.savedRevisionSelection,s);
 assert.equal(preparation.supplierRequests,0);assert.equal(preparation.catalogManifestWrites,0);assert.equal(preparation.offerWrites,0);assert.equal(preparation.priceWrites,0);
 if(s.quarantinedIds){assert.equal(report.paidInputWitness,undefined);assert.equal(report.rawRetirementBlocked,'saved_revision_quarantine');}
 assert.ok(report.rawStoragePins.length>0);report.rawStoragePins.forEach(assertRawHandoff);
 assert.ok(report.rawStoragePins.some(pin=>pin.references.some(ref=>ref.root===q.root)),'quarantine_source_root_not_pinned');
 assert.equal(receipt.owner.runId,process.env.GITHUB_RUN_ID);assert.equal(receipt.owner.attempt,process.env.GITHUB_RUN_ATTEMPT);assert.equal(receipt.owner.revision,sourceSha);assert.equal(receipt.reportDigest,rawDigest(report));
 await assertLocalIntakeArchive({storage,directory:dir,receipt});
 const checkpoint={version:1,phase:'prepare-only',prepared:true,installed:false,published:false,liveReady:false,retirementReady:false,
  completeSourceReplacement:s.quarantinedIds===0&&Boolean(report.paidInputWitness),sourceProcessingCompleted:true,quarantineRequiresReview:s.quarantinedIds>0,
  sourceSha,source:expected,selection:s,receipt,reportSha256:rawDigest(report),reportRootPins:report.rawStoragePins,
  controlsBeforeRevision:before.controlsRevision,controlsAfterRevision:controls.revision,
  generationBefore:before.generationId,generationAfter:manifest.generationId,manifestChangedExternally:before.manifestSha256!==rawDigest(manifest),requiresFreshPublicationAuthority:true,
  supplierRequests:0,manifestWrites:0,checkedAt:new Date().toISOString()};
 await fs.writeFile('saved-encar-checkpoint/after.json',JSON.stringify(checkpoint,null,2));
 await fs.copyFile(dir+'/report.json','saved-encar-checkpoint/intake-report.json');await fs.copyFile(dir+'/own-storage-receipt.json','saved-encar-checkpoint/own-storage-receipt.json');
 console.log(JSON.stringify({stage:'saved_encar_prepared_only',prepared:true,published:false,retirementReady:false,...s,archiveRoot:receipt.root}));
}

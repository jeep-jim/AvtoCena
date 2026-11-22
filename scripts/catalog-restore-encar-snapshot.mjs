import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {buildSavedEncarSelection,rawHash} from './lib/paid-encar-saved-revisions.mjs';
import path from 'node:path';
import { getJsonStorage } from '../apps/web/lib/data.ts';
import { EncarDirectAdapter } from '../apps/web/lib/catalog/adapters.ts';
import { isEncarNonCashContract } from '../apps/web/lib/catalog/encar-sale-contract.ts';
import { observationShardWriter } from './lib/catalog-intake-checkpoint.mjs';
import { preparePaidEncarReports } from './catalog-prepare-paid-encar-reports.mjs';
import { paidEncarSavedPageVerifier } from './catalog-paid-encar-intake.mjs';
import {openRawFeedPin,rawProducerOwner,readRawRootHandoff} from './lib/catalog-raw-provenance.mjs';
import { normalizePaidEncarOffer } from './lib/paid-encar-offer.mjs';
import {createIndependentPaidInput,paidContributionWorkerSource} from './lib/catalog-paid-encar-contributions.mjs';

const run = process.env.ENCAR_SNAPSHOT_RUN;
const attempt = process.env.ENCAR_SNAPSHOT_ATTEMPT;
if (!/^\d+$/.test(run || '') || !/^\d+$/.test(attempt || '')) throw Error('Invalid snapshot identity');
const prefix = 'catalog/intake-staging/encar/' + run + '/' + attempt;
let storage = getJsonStorage();
const owner=rawProducerOwner();
const rawPin=await openRawFeedPin({storage,owner,operationId:`encar-restore-${owner.runId}-${owner.attempt}`,
  references:[{kind:'encar-snapshot',root:prefix}]});
await rawPin.add([]);
storage=rawPin.storage;
const snapshot = await storage.readJson(prefix + '/complete.json', null);
if (!Number.isSafeInteger(snapshot?.pages) || snapshot.pages < 1 ||
    !Number.isSafeInteger(snapshot.count) || snapshot.count < 1 ||
    !Number.isFinite(Date.parse(snapshot.completedAt))) throw Error('Missing complete Encar snapshot');
await rawPin.add([{kind:'encar-reports',root:`catalog/paid-encar-reports/v1/${Date.parse(snapshot.completedAt)}`}]);
const reconcileSavedRevisions=process.env.ENCAR_RECONCILE_SAVED_REVISIONS==='1';
const snapshotContext={runId:run,attempt,headSha:process.env.GITHUB_SHA};
if(reconcileSavedRevisions || process.env.ENCAR_SNAPSHOT_PRODUCER_SHA || process.env.ENCAR_SNAPSHOT_SHA256){
  // Resume a verified foreign producer only with both externally supplied pins.
  // Never derive expected authority from the snapshot being checked.
  assert.match(process.env.ENCAR_SNAPSHOT_PRODUCER_SHA||'',/^[a-f0-9]{40}$/);
  assert.match(process.env.ENCAR_SNAPSHOT_SHA256||'',/^[a-f0-9]{64}$/);
  assert.equal(rawHash(snapshot),process.env.ENCAR_SNAPSHOT_SHA256,'encar_revision_snapshot_pin');
  snapshotContext.headSha=process.env.ENCAR_SNAPSHOT_PRODUCER_SHA;
}
const pageVerifier=paidEncarSavedPageVerifier(snapshot,snapshotContext);
let selection=null;
if(reconcileSavedRevisions){
  const {readCollectionControls}=await import('../apps/web/lib/catalog/collection-controls.ts');
  const {collectionEnabled}=await import('../apps/web/lib/catalog/collection-controls-schema.ts');
  const assertEnabled=async()=>assert.ok(collectionEnabled(await readCollectionControls(storage),'encar_feed'),'paid_report_disabled_by_owner');
  selection=await buildSavedEncarSelection({storage,root:prefix,snapshot,
    pageVerifier:paidEncarSavedPageVerifier(snapshot,snapshotContext),assertEnabled,
    onProgress:p=>console.log(JSON.stringify({stage:'saved_encar_revision_prepass',...p}))});
  console.log(JSON.stringify({stage:'saved_encar_revision_selected',...selection.summary}));
}
const output = path.resolve(process.env.CATALOG_INTAKE_DIR || 'catalog-intake-korea');
await fs.mkdir(output, {recursive:true});
if ((await fs.readdir(output)).length) throw Error('Intake directory must be empty');
if(selection)await fs.writeFile(process.env.ENCAR_QUARANTINE_OUTPUT||'paid-encar-revision-quarantine.json',JSON.stringify(selection.quarantineManifest()));
const adapter = new EncarDirectAdapter();
const write = observationShardWriter(output, adapter.sourceId);
const independentInput = createIndependentPaidInput({storage, run, attempt, snapshot, owner, sourceSha: paidContributionWorkerSource()});
const seen = new Set();
let count = 0;
let excluded = 0;
let observations = 0;
const fieldCoverage = {rows:0, withGroups:0, withOptions:0, options:0, withHp:0, withCc:0, withFuel:0};
const sampleSpecs = [];
let superseded = 0;
let quarantined = 0;
for (let page = 1; page <= snapshot.pages; page++) {
  const rows = await independentInput.readPage(page);
  if (!Array.isArray(rows) || (!rows.length && page !== snapshot.pages)) throw Error('Missing saved Encar page ' + page);
  if (pageVerifier) {
    const receipt = await storage.readJson(prefix + '/page-receipts/' + page + '.json', null);
    pageVerifier.verify(page, rows, receipt);
  }
  selection?.assertPage(page,rows);
  for (const [rowIndex,row] of rows.entries()) {
    count++;
    if(selection){const decision=selection.classify(page,rowIndex+1,row);if(decision==='quarantined'){quarantined++;continue;}if(decision==='superseded'){superseded++;continue;}}
    const d = row.data;
    const id = String(row.inner_id);
    if (!/^\d+$/.test(id) || String(d?.inner_id) !== id) throw Error('Encar identity mismatch');
    if (d.advertisement_type !== 'Продажа' || d.sales_status !== 'Доступно' ||
        isEncarNonCashContract(d) || Number(d.price) <= 0 || d.is_duplicate === true) { excluded++; continue; }
    const price = Number(d.price);
    if (d.currency !== 'KRW' || !Number.isSafeInteger(price)) throw Error('Invalid Encar cash price');
    const offer = normalizePaidEncarOffer(d, {id, observedAt:snapshot.completedAt, adapter});
    if (!offer) throw Error('Invalid listing identity for Encar ' + id);
    const groups = offer.operational.sourceSpecifications?.groups || [];
    const options = Object.values(d.options || {}).filter(Array.isArray).reduce((n,list) =>
      n + new Set(list.filter(value => typeof value === 'string' && value.trim()).map(value=>value.trim())).size, 0);
    fieldCoverage.rows++;
    fieldCoverage.withGroups += Number(groups.length > 0);
    fieldCoverage.withOptions += Number(options > 0);
    fieldCoverage.options += options;
    fieldCoverage.withHp += Number(offer.powerHp > 0);
    fieldCoverage.withCc += Number(offer.engineCc > 0);
    fieldCoverage.withFuel += Number(Boolean(offer.fuel));
    if (sampleSpecs.length < 2 || ['42799484','42760061'].includes(id)) {
      const sample = {sourceOfferId:id, id:offer.id, rawHp:d.power ?? null, mappedHp:offer.powerHp ?? null,
        rawCc:d.displacement_cc ?? null, mappedCc:offer.engineCc ?? null, hasFuel:Boolean(offer.fuel), options,
        displayedFields:groups.reduce((n,group)=>n+group.items.length,0)};
      sampleSpecs.push(sample);
      console.log(JSON.stringify({stage:'saved_encar_vehicle_fields', ...sample}));
    }
    offer.sourcePrice = price;
    offer.images = [...new Set(Array.isArray(d.photos) ? d.photos : [])].filter(value => {
      try {
        const url = new URL(value);
        return url.origin === 'https://ci.encar.com' && !url.username && !url.password &&
          url.pathname.split('/').pop().startsWith(id + '_');
      } catch { return false; }
    }).map(url => ({id:'',url,objectKey:'',checksum:'',size:0,mimeType:'image/jpeg'}));
    Object.assign(offer.operational, {provider:'auto_api_encar', exactDetail:true,
      detailIdentityVerified:true, exactPhotos:offer.images.length>0, photoIdentityVerified:offer.images.length>0,
      galleryImageCount:offer.images.length});
    independentInput.recordOffer(row, offer);
    await write({stage:'detail', observedAt:snapshot.completedAt, offer});
    seen.add(offer.id);
    observations++;
  }
  if(selection&&page%250===0)console.log(JSON.stringify({stage:'saved_encar_restore_progress',pagesRead:page,totalPages:snapshot.pages,count,observations,excluded,superseded,quarantined}));
}
pageVerifier?.finish();
if (count !== snapshot.count || observations + excluded + superseded + quarantined !== count || !seen.size) throw Error('Encar snapshot totals mismatch');
selection?.assertSnapshot(await storage.readJson(prefix+'/complete.json',null));
if(selection){assert.equal(superseded,selection.summary.supersededRows,'encar_revision_superseded_count');assert.equal(quarantined,selection.summary.quarantinedRows,'encar_revision_quarantine_count');}
// Witness still covers every original raw page; superseded rows are explicit
// non-output input, not a second normalized payload for the same identity.
const rawPaidInputWitness = await independentInput.finish({observations, excluded:excluded+superseded+quarantined});
// Quarantined raw versions are not replaced by selected normalized output.
// Withhold optional retirement proof so existing provenance keeps raw roots.
const paidInputWitness = quarantined===0 ? rawPaidInputWitness : null;
const report = {version:1,market:'korea',provider:'auto_api_encar',completed:true,completedAt:snapshot.completedAt,
  snapshotRun:run,snapshotAttempt:attempt,fieldCoverage,sampleSpecs,...(selection?{savedRevisionSelection:selection.summary,savedRevisionQuarantine:selection.quarantineManifest(),...(quarantined?{rawRetirementBlocked:'saved_revision_quarantine'}:{})}:{}),requiredSourceIds:[adapter.sourceId],confirmedWithdrawals:[],
  ...(paidInputWitness ? {paidInputWitness} : {}),
  sources:[{sourceId:adapter.sourceId,provider:'auto_api_encar',observations,uniqueOffers:seen.size,
    stopReason:'source_finished',syncMode:'snapshot',pages:snapshot.pages,excluded,...(selection?{superseded,quarantined}: {})}]};
// A completed paid intake must include verified reports for the same source
// observation before any publication route can receive its completion report.
const reportPreparation=await preparePaidEncarReports({selection});
const sourceHandoff=await readRawRootHandoff(storage,prefix,snapshot);
report.rawStoragePins=[await rawPin.handoff(),...(sourceHandoff?[sourceHandoff]:[]),...reportPreparation.rawStoragePins];
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report));
console.log(JSON.stringify({count,excluded,superseded,quarantined,observations,uniqueOffers:seen.size,fieldCoverage}));

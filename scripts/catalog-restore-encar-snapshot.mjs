import fs from 'node:fs/promises';
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
const pageVerifier = paidEncarSavedPageVerifier(snapshot,
  {runId: run, attempt, headSha: process.env.GITHUB_SHA});
const output = path.resolve(process.env.CATALOG_INTAKE_DIR || 'catalog-intake-korea');
await fs.mkdir(output, {recursive:true});
if ((await fs.readdir(output)).length) throw Error('Intake directory must be empty');
const adapter = new EncarDirectAdapter();
const write = observationShardWriter(output, adapter.sourceId);
const independentInput = createIndependentPaidInput({storage, run, attempt, snapshot, owner, sourceSha: paidContributionWorkerSource()});
const seen = new Set();
let count = 0;
let excluded = 0;
let observations = 0;
for (let page = 1; page <= snapshot.pages; page++) {
  const rows = await independentInput.readPage(page);
  if (!Array.isArray(rows) || (!rows.length && page !== snapshot.pages)) throw Error('Missing saved Encar page ' + page);
  if (pageVerifier) {
    const receipt = await storage.readJson(prefix + '/page-receipts/' + page + '.json', null);
    pageVerifier.verify(page, rows, receipt);
  }
  for (const row of rows) {
    count++;
    const d = row.data;
    const id = String(row.inner_id);
    if (!/^\d+$/.test(id) || String(d?.inner_id) !== id) throw Error('Encar identity mismatch');
    if (d.advertisement_type !== 'Продажа' || d.sales_status !== 'Доступно' ||
        isEncarNonCashContract(d) || Number(d.price) <= 0 || d.is_duplicate === true) { excluded++; continue; }
    const price = Number(d.price);
    if (d.currency !== 'KRW' || !Number.isSafeInteger(price)) throw Error('Invalid Encar cash price');
    const offer = normalizePaidEncarOffer(d, {id, observedAt:snapshot.completedAt, adapter});
    if (!offer) throw Error('Invalid listing identity for Encar ' + id);
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
}
pageVerifier?.finish();
if (count !== snapshot.count || observations + excluded !== count || !seen.size) throw Error('Encar snapshot totals mismatch');
const paidInputWitness = await independentInput.finish({observations, excluded});
const report = {version:1,market:'korea',provider:'auto_api_encar',completed:true,completedAt:snapshot.completedAt,
  snapshotRun:run,snapshotAttempt:attempt,requiredSourceIds:[adapter.sourceId],confirmedWithdrawals:[],
  ...(paidInputWitness ? {paidInputWitness} : {}),
  sources:[{sourceId:adapter.sourceId,provider:'auto_api_encar',observations,uniqueOffers:seen.size,
    stopReason:'source_finished',syncMode:'snapshot',pages:snapshot.pages,excluded}]};
// A completed paid intake must include verified reports for the same source
// observation before any publication route can receive its completion report.
const reportPreparation=await preparePaidEncarReports();
const sourceHandoff=await readRawRootHandoff(storage,prefix,snapshot);
report.rawStoragePins=[await rawPin.handoff(),...(sourceHandoff?[sourceHandoff]:[]),...reportPreparation.rawStoragePins];
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report));
console.log(JSON.stringify({count,excluded,observations,uniqueOffers:seen.size}));

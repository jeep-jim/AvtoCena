import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls.ts';
await assertCollectionEnabled('che168_feed');
import fs from 'node:fs/promises';
import path from 'node:path';
import {autoApiChe168Client, collectAutoApiChe168, autoApiChe168Resume} from './lib/auto-api-che168-client.mjs';
import {observationShardWriter} from './lib/catalog-intake-checkpoint.mjs';
import {normalizeAutoApiChe168, autoApiChe168RejectionReason, isAutoApiChe168QuarantineReason, AUTO_API_CHE168_SOURCE as sourceId} from '../apps/web/lib/catalog/auto-api-che168.ts';
import {catalogInventoryAgeDecision, catalogHeavyVehicleExcluded} from '../apps/web/lib/catalog/inventory-admission.ts';
import {stableOfferId} from '../apps/web/lib/catalog/storage.ts';

const directory = process.env.AUTO_API_INTAKE_DIR || 'catalog-intake-china';
await fs.mkdir(directory, {recursive:true});
const files = await fs.readdir(directory);
let prior;
if (files.length) {
  // The workflow collects Autohome new cars first, in the same market artifact.
  if (files.some(name => name !== 'report.json' && !/^autohome_new_china_open-\d+\.jsonl$/.test(name))) throw Error('auto_api_intake_output_not_empty');
  prior = JSON.parse(await fs.readFile(path.join(directory, 'report.json'), 'utf8'));
  if (prior.market !== 'china' || !prior.completedAt || !Array.isArray(prior.sources)
    || prior.sources.some(row => row.sourceId !== 'autohome_new_china_open')) throw Error('auto_api_invalid_prior_intake');
}
const write = observationShardWriter(directory, sourceId);
const deadline = Date.now() + Math.min(300*60000, Number(process.env.CATALOG_INTAKE_TIME_MS || 210*60000));
const request = autoApiChe168Client({fetchImpl:async (...args)=>{await assertCollectionEnabled('che168_feed');return fetch(...args);},apiKey:process.env.AUTO_API_CHE168_KEY, deadline});
const yearFrom=new Date(Date.now()+7*3600000).getUTCFullYear()-6;
const {getJsonStorage}=await import('../apps/web/lib/data.ts');
const saved=await getJsonStorage().readJson('catalog/intake-cursors/v1/china.json',null);
const resume=autoApiChe168Resume(saved,{yearFrom,forceSnapshot:process.env.CATALOG_INTAKE_RESUME==='0'});
const report = {version:1, market:'china', provider:'auto_api_che168', productionWrites:false,
  startedAt:new Date().toISOString(), completed:false, sources:[], confirmedWithdrawals:[]};
const withdrawn = new Map(), seen = new Set();
const rejectionReasons={};
const quarantined=new Set();
let observations = 0, rejectedIdentity = 0, outOfScope = 0, withImages = 0, withExactCc = 0, withPower = 0;
let lastLog = 0;
let lastProgress = {};
async function checkpoint(progress = lastProgress) {
  lastProgress = progress;
  report.sources = [{sourceId, provider:'auto_api_che168', ...progress, syncMode:progress.mode, observations, uniqueOffers:seen.size, rejectedIdentity, rejectionReasons, quarantined:quarantined.size, outOfScope,
    withImages, withExactCc, withPower, stopReason:report.completed ? (progress.mode==='delta'?'source_changes_finished':'source_finished') : 'collecting'}];
  report.sources.push(...(prior?.sources || []));
  report.confirmedWithdrawals = [...withdrawn.values(), ...(prior?.confirmedWithdrawals || [])];
  await fs.writeFile(path.join(directory, 'report.tmp'), JSON.stringify(report));
  await fs.rename(path.join(directory, 'report.tmp'), path.join(directory, 'report.json'));
  if (Date.now()-lastLog > 60000 || report.completed) { console.log(JSON.stringify({market:'china', ...report.sources[0], completed:report.completed})); lastLog=Date.now(); }
}
await checkpoint();
try {
  const completed = await collectAutoApiChe168({request,
    yearFrom, resume,
    onOffer:async (row, observedAt) => {
      const offer = normalizeAutoApiChe168(row, observedAt);
      if (!offer) {
        const reason=autoApiChe168RejectionReason(row)||'unknown'; rejectionReasons[reason]=(rejectionReasons[reason]||0)+1;
        if(isAutoApiChe168QuarantineReason(reason)) {
          // Observed provider defects: isolate one bound listing, never invent
          // a model or production year needed by admission/calculation.
          quarantined.add(String(row.inner_id));
          await fs.appendFile(path.join(directory,'quarantine.ndjson'),JSON.stringify({innerId:String(row.inner_id),reason,observedAt})+'\n');
        } else rejectedIdentity++;
        return;
      }
      // Keep out-of-scope revisions too: the converter replaces a former active
      // revision; the existing publisher owns final admission/calculation.
      if (!catalogInventoryAgeDecision(offer).eligible || catalogHeavyVehicleExcluded(offer)) outOfScope++;
      seen.add(offer.id); observations++; if (offer.images.length) withImages++;
      if (offer.engineCc) withExactCc++; if (offer.powerHp) withPower++;
      await write({stage:'detail', observedAt, offer});
    },
    onRemoval:async (change) => {
      const sourceOfferId = String(change.inner_id), id = stableOfferId(sourceId, sourceOfferId);
      const row = {id, sourceId, sourceOfferId, market:'china', status:'removed', observedAt:change.created_at};
      const previous = withdrawn.get(id);
      if (!previous || Date.parse(previous.observedAt) < Date.parse(row.observedAt)) withdrawn.set(id, row);
      // Keep removals in the dated report. The publisher compares event time
      // with the latest offer observation; an old event cannot erase a newer
      // active revision, even when they arrived out of order during the scan.
    },
    onProgress:async progress => {
      const disk = await fs.statfs(directory);
      if (disk.bavail*disk.bsize < 2*1024**3) throw Error('auto_api_disk_budget');
      await checkpoint(progress);
    },
  });
  if (!seen.size && !resume) throw Error('auto_api_empty_inventory');
  // A changed upstream contract must not silently publish a truncated fleet.
  if (rejectedIdentity) throw Error('auto_api_rejected_identity_review_required');
  if (quarantined.size>1000 || quarantined.size>10 && quarantined.size/Math.max(1,seen.size+quarantined.size)>0.005) throw Error('auto_api_quarantine_review_required');
  Object.assign(report, {completed:true, completedAt:completed.completedAt});
  await checkpoint(completed);
} catch (error) {
  report.failure = /^auto_api_[a-z0-9_]+$/.test(String(error?.message)) ? error.message : 'auto_api_collection_failed';
  await checkpoint();
  throw Error(report.failure);
}

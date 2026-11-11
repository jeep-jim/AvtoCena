import fs from 'node:fs/promises';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {publishedIntakeCheckpoint} from './lib/catalog-intake-checkpoint.mjs';
import {collectionComplete,refreshOutcome} from './lib/catalog-refresh-outcome.mjs';
const runId=process.env.SOURCE_RUN_ID, generationId=process.env.EXPECTED_GENERATION;
if(!/^\d+$/.test(runId||'')||!/^gen_[a-zA-Z0-9_]+$/.test(generationId||''))throw Error('repair_inputs_invalid');
const intake=JSON.parse(await fs.readFile('repair-intake/report.json','utf8'));
const storage=getJsonStorage(),key='catalog/operations/markets/uae.json';
const previous=await storage.readJsonWithMeta(key,null);
const manifest=await storage.readJson('catalog/manifest.json',null);
const checkpoint=await storage.readJson('catalog/intake-cursors/v1/uae.json',null);
const old=previous.value;
if(!previous.etag||old?.market!=='uae'||String(old.runId)!==runId||old.publicationStatus!=='published'
 ||old.generationId!==generationId||manifest?.generationId!==generationId||checkpoint?.generationId!==generationId
 ||old.publishedCount!==manifest.markets?.uae?.count||old.lastCollectionAttempt!==intake.completedAt)throw Error('repair_publication_mismatch');
const required=intake.requiredSourceIds||old.sources.filter(row=>row.required).map(row=>row.sourceId);
if(!required.includes('dubicars_uae_exact')||!collectionComplete(intake,required))throw Error('repair_collection_not_complete');
const publication={published:true,market:'uae',generationId,publishedAt:old.lastPublicationSuccess,publishedMarketCount:old.publishedCount,powerMix:{uae:old.powerMix},sourceShare:{uae:old.sourceShare}};
const expected=publishedIntakeCheckpoint(intake,publication);
for(const row of expected.sources){const saved=checkpoint.sources?.find(s=>s.sourceId===row.sourceId);if(!saved||saved.cursor!==row.cursor||saved.stopReason!==row.stopReason)throw Error('repair_cursor_mismatch');}
const outcome=refreshOutcome({market:'uae',previous:old,intake,publication,now:old.lastAttemptAt,runId:old.runId,requiredSourceIds:required});
outcome.outcomeRepair={at:new Date().toISOString(),runId:process.env.GITHUB_RUN_ID,reason:'dubicars_nonzero_snapshot_cursor'};
await storage.writeJson(key,outcome,{ifMatch:previous.etag});
const saved=await storage.readJson(key,null);
if(saved?.collectionComplete!==true||saved.generationId!==generationId)throw Error('repair_verify_failed');
console.log(JSON.stringify({market:'uae',generationId,publishedCount:saved.publishedCount,collectionComplete:saved.collectionComplete,publicationStatus:saved.publicationStatus}));

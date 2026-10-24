import fs from 'node:fs/promises';
import {validateBatch,planModelResearch} from './research-batch.mjs';
import {MANIFEST} from '../../apps/web/lib/encyclopedia/records.ts';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {readCurrentCatalogProjectionSnapshot,getOfferWithoutEditorial} from '../../apps/web/lib/catalog/storage.ts';
import {applyEncyclopediaCalculation,compileModelFacts,checksum,factFields,modelKey} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
import {applyUaeManualSpecifications} from '../../apps/web/lib/catalog/uae-manual-specifications.ts';
import {specificationEvidenceComplete} from '../../apps/web/lib/catalog/modification-matching.ts';
import {ajesOffer} from '../../apps/web/lib/catalog/ajes-offer.ts';
import {convertToRub} from '../../apps/web/lib/catalog/rates.ts';
import {japanPreviewParameters} from '../../apps/web/lib/catalog/japan-preview-parameters.ts';
const store=getJsonStorage();
if(store.driver!=='object')throw Error('object_storage_required');
store.writeJson=async()=>{throw Error('read_only_audit_write_attempt');};
const marker=JSON.parse(await fs.readFile('.github/market-runs/encyclopedia-technical-audit.json','utf8'));
if(!/^[a-f0-9]{64}$/.test(marker.indexDigest))throw Error('invalid_index_digest');
let index=await store.readJson(`knowledge/encyclopedia/calculation-indexes/${marker.indexDigest}.json`,null);
if(!index||index.digest!==marker.indexDigest||checksum(index.models)!==index.digest)throw Error('index_digest_mismatch');
let previewChanges=0;
if(marker.previewBatch){
 if(!/^docs\/encyclopedia\/batches\/[a-z0-9-]+\.json$/.test(marker.previewBatch))throw Error('invalid_preview_batch');
 const batch=validateBatch(JSON.parse(await fs.readFile(marker.previewBatch,'utf8'))),manifest=await store.readJson(MANIFEST,null);
 index=structuredClone(index);
 for(const id of new Set(batch.entries.map(e=>e.modelId))){const summary=manifest.models.find(m=>m.id===id);if(!summary)throw Error('preview_model_missing');const record=await store.readJson(summary.key,null);const plan=planModelResearch(record,batch.entries.filter(e=>e.modelId===id),batch);if(plan.skipped.length)throw Error('preview_changed');previewChanges+=plan.changes.length;const added=compileModelFacts({...plan.record,variants:plan.record.variants.filter(v=>plan.changes.some(c=>c.variantId===v.id))});const key=modelKey(record.make,record.model);index.models[key]=[...(index.models[key]||[]),...added];}
 index.digest=checksum(index.models);
}
const snapshot=await readCurrentCatalogProjectionSnapshot();
const report={checkedAt:new Date().toISOString(),indexDigest:index.digest,generationId:snapshot.generationId,previewChanges,scope:'Five-market saved projection plus bounded existing Japanese query cache. No supplier requests, no database writes; not whole Japan inventory.',markets:{},japanCache:{slots:128,uniqueLots:0,converted:0,rejected:0},samples:[],japanMissingLinks:[],savedDetailProbe:[]};
function identityCode(raw){return raw.chassisCode||raw.operational?.chassisCode;}
function inspect(raw){
 const source=applyUaeManualSpecifications(raw),before=applyEncyclopediaCalculation(source,index,{technicalIdentity:false}),after=applyEncyclopediaCalculation(source,index);
 const r=report.markets[raw.market]||={rows:0,withTechnicalCode:0,modelYearKnown:0,baselineMatched:0,technicalMatched:0,specificationMatched:0,newlyFilledRecords:0,newlyFilledFields:0,newlyCompleteSpecifications:0,japanPreviewBefore:0,japanPreviewAfter:0};r.rows++;
 r.withTechnicalCode+=Number(Boolean(source.chassisCode||source.engineCode||source.operational?.chassisCode));
 r.modelYearKnown+=Number((index.models[modelKey(raw.make,raw.model)]||[]).some(v=>v.year===raw.year));
 r.baselineMatched+=Number(Boolean(before.operational?.encyclopediaCalculation));r.technicalMatched+=Number(after.operational?.encyclopediaCalculation?.matchMethod==='technical_identity');r.specificationMatched+=Number(after.operational?.encyclopediaCalculation?.matchMethod==='specification_consensus');
 if(raw.market==='japan'&&!after.operational?.encyclopediaCalculation&&report.japanMissingLinks.length<40){
 const facts=index.models[modelKey(raw.make,raw.model)]||[],annual=facts.filter(v=>v.year===raw.year);
 report.japanMissingLinks.push({id:raw.id,make:raw.make,model:raw.model,year:raw.year,trim:raw.trim,chassisCode:identityCode(source),engineCc:source.engineCc,fuel:source.fuel,transmission:source.transmission,factsForModel:facts.length,factsForYear:annual.length,withChassis:annual.filter(v=>v.constraints.chassisCode).length,donorExamples:annual.slice(0,3).map(v=>({trim:v.trims,chassisCode:v.constraints.chassisCode,engineCode:v.constraints.engineCode}))});
 }
 const fields=factFields.filter(f=>!before[f]&&after[f]);r.newlyFilledRecords+=Number(fields.length>0);r.newlyFilledFields+=fields.length;
 r.newlyCompleteSpecifications+=Number(!specificationEvidenceComplete(before)&&specificationEvidenceComplete(after));
 if(raw.market==='japan'){try{japanPreviewParameters(before);r.japanPreviewBefore++;}catch{}try{japanPreviewParameters(after);r.japanPreviewAfter++;}catch{}}
 if(fields.length&&report.samples.filter(x=>x.market===raw.market).length<20)report.samples.push({id:raw.id,market:raw.market,make:raw.make,model:raw.model,year:raw.year,trim:raw.trim,chassisCode:source.chassisCode||source.operational?.chassisCode,engineCode:source.engineCode,fields,values:Object.fromEntries(fields.map(f=>[f,after[f]])),donors:after.operational.encyclopediaCalculation.provenance});
}
for(const row of snapshot.items)inspect(row);
console.log('SAVED_MARKETS_CHECKED',JSON.stringify(report.markets));
// A bounded diagnostic of stored full records, never AJES/Green live getters.
for(const market of ['china','europe','korea','uae','georgia']){
 const rows=snapshot.items.filter(r=>r.market===market&&/^[a-f0-9]{24}$/.test(r.id)&&!r.totalRub).slice(0,8);
 for(const row of rows){const full=await getOfferWithoutEditorial(row.id);report.savedDetailProbe.push({id:row.id,market,found:!!full,projectionChassis:identityCode(row),fullChassis:full&&identityCode(full),fullEngine:full?.engineCode,fullGeneration:full?.generation});}
}

const lots=new Map();
for(let start=0;start<128;start+=8){const slots=await Promise.all(Array.from({length:8},(_,n)=>store.readJson(`catalog/partner-cache/ajes/queries/${start+n}.json`,null)));for(const slot of slots)for(const lot of slot?.value?.items||[])if(lot.table==='stats'&&(!lots.has(lot.id)||Date.parse(slot.value.observedAt)>Date.parse(lots.get(lot.id).observedAt)))lots.set(lot.id,{lot,observedAt:slot.value.observedAt});}
report.japanCache.uniqueLots=lots.size;
for(const {lot,observedAt} of lots.values()){try{const rate=await convertToRub(lot.finalPriceJpy,'JPY');if(!rate)throw Error('rate_missing');const offer=ajesOffer(lot,rate,observedAt);inspect(offer);report.japanCache.converted++;}catch{report.japanCache.rejected++;}}
if((await store.readJson('catalog/manifest.json',null))?.generationId!==snapshot.generationId)throw Error('catalog_changed');
await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/encyclopedia-technical-transfer.json',JSON.stringify(report,null,2));
console.log('TECHNICAL_TRANSFER_AUDIT',JSON.stringify({...report,samples:report.samples.length}));

import fs from 'node:fs/promises';
import {applyActiveBusinessPriceBatch} from '../../apps/web/lib/catalog/live-business-pricing.ts';
import {validateBatch,planModelResearch,digest} from './research-batch.mjs';
import {MANIFEST} from '../../apps/web/lib/encyclopedia/records.ts';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {readCurrentCatalogProjectionSnapshot,getOfferWithoutEditorial} from '../../apps/web/lib/catalog/storage.ts';
import {applyEncyclopediaCalculation,compileModelFacts,checksum,factFields,modelKey} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
import {applyUaeManualSpecifications} from '../../apps/web/lib/catalog/uae-manual-specifications.ts';
import {specificationEvidenceComplete} from '../../apps/web/lib/catalog/modification-matching.ts';
import {ajesOffer} from '../../apps/web/lib/catalog/ajes-offer.ts';
import {convertToRub} from '../../apps/web/lib/catalog/rates.ts';
import {applyJapanFactoryFuel} from '../../apps/web/lib/encyclopedia/japan-fuel-reference.ts';
import {japanPreviewParameters} from '../../apps/web/lib/catalog/japan-preview-parameters.ts';
const store=getJsonStorage();
if(store.driver!=='object')throw Error('object_storage_required');
store.writeJson=async()=>{throw Error('read_only_audit_write_attempt');};
const marker=JSON.parse(await fs.readFile('.github/market-runs/encyclopedia-spec-transfer.json','utf8'));
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
 const source=applyUaeManualSpecifications(raw),before=applyJapanFactoryFuel(applyEncyclopediaCalculation(source,index,{technicalIdentity:true,specificationIdentity:true,ordinarySpecificationIdentity:false})),after=applyJapanFactoryFuel(applyEncyclopediaCalculation(source,index,{technicalIdentity:true,specificationIdentity:true}));
 const r=report.markets[raw.market]||={rows:0,withTechnicalCode:0,modelYearKnown:0,baselineMatched:0,technicalMatched:0,newlyFilledRecords:0,newlyFilledFields:0,newlyCompleteSpecifications:0,newlyCompletePending:0,newlyFilledByField:{},newlyCompleteByPowertrain:{},japanPreviewBefore:0,japanPreviewAfter:0,afterComplete:0,afterMissingByField:{},unmatchedReasons:{},retainedDelivered:0};r.rows++;
 r.afterComplete+=Number(specificationEvidenceComplete(after));
 r.retainedDelivered+=Number(Number(raw.totalRub)>0&&raw.catalogPricingMode!=='seller');
 for(const field of factFields)if(after[field]===undefined||after[field]===null||after[field]===''||after[field]==='unknown')r.afterMissingByField[field]=(r.afterMissingByField[field]||0)+1;
 if(!after.operational?.encyclopediaCalculation){const facts=index.models[modelKey(raw.make,raw.model)]||[];const reason=!facts.length?'model_absent_from_calculation_index':!facts.some(v=>v.year===raw.year)?'year_absent_from_calculation_index':'no_compatible_field_consensus';r.unmatchedReasons[reason]=(r.unmatchedReasons[reason]||0)+1;}
 r.withTechnicalCode+=Number(Boolean(source.chassisCode||source.engineCode||source.operational?.chassisCode));
 r.modelYearKnown+=Number((index.models[modelKey(raw.make,raw.model)]||[]).some(v=>v.year===raw.year));
 r.baselineMatched+=Number(Boolean(before.operational?.encyclopediaCalculation));r.technicalMatched+=Number(after.operational?.encyclopediaCalculation?.matchMethod==='specification_consensus');
 if(raw.market==='japan'&&!after.operational?.encyclopediaCalculation&&report.japanMissingLinks.length<40){
 const facts=index.models[modelKey(raw.make,raw.model)]||[],annual=facts.filter(v=>v.year===raw.year);
 report.japanMissingLinks.push({id:raw.id,make:raw.make,model:raw.model,year:raw.year,trim:raw.trim,chassisCode:identityCode(source),engineCc:source.engineCc,fuel:source.fuel,transmission:source.transmission,factsForModel:facts.length,factsForYear:annual.length,withChassis:annual.filter(v=>v.constraints.chassisCode).length,donorExamples:annual.slice(0,3).map(v=>({trim:v.trims,chassisCode:v.constraints.chassisCode,engineCode:v.constraints.engineCode}))});
 }
 const fields=factFields.filter(f=>!before[f]&&after[f]);r.newlyFilledRecords+=Number(fields.length>0);r.newlyFilledFields+=fields.length;for(const f of fields)r.newlyFilledByField[f]=(r.newlyFilledByField[f]||0)+1;
 const newlyComplete=!specificationEvidenceComplete(before)&&specificationEvidenceComplete(after);r.newlyCompleteSpecifications+=Number(newlyComplete);if(newlyComplete){r.newlyCompleteByPowertrain[after.powertrainKind||'unknown']=(r.newlyCompleteByPowertrain[after.powertrainKind||'unknown']||0)+1;if(!(Number(raw.totalRub)>0&&raw.catalogPricingMode!=='seller'))r.newlyCompletePending++;}
 if(raw.market==='japan'){try{japanPreviewParameters(before);r.japanPreviewBefore++;}catch{}try{japanPreviewParameters(after);r.japanPreviewAfter++;}catch{}}
 if(fields.length&&report.samples.filter(x=>x.market===raw.market).length<20)report.samples.push({id:raw.id,market:raw.market,make:raw.make,model:raw.model,year:raw.year,trim:raw.trim,chassisCode:source.chassisCode||source.operational?.chassisCode,engineCode:source.engineCode,fields,values:Object.fromEntries(fields.map(f=>[f,after[f]]))});
}
for(const row of snapshot.items)inspect(row);
console.log('SAVED_MARKETS_CHECKED',JSON.stringify(report.markets));
report.targetOffers=[];
for(const id of (marker.targetOfferIds||[]).slice(0,12)){
 const raw=snapshot.items.find(x=>x.id===id);if(!raw){report.targetOffers.push({id,missing:true});continue;}
 const enriched=applyEncyclopediaCalculation(applyUaeManualSpecifications(raw),index);
 const [priced]=await applyActiveBusinessPriceBatch([enriched],{readOnly:true});
 report.targetOffers.push({id,make:raw.make,model:raw.model,year:raw.year,before:{engineCc:raw.engineCc,powerHp:raw.powerHp,totalRub:raw.totalRub,mode:raw.catalogPricingMode},after:{engineCc:priced.engineCc,powerHp:priced.powerHp,totalRub:priced.totalRub,mode:priced.catalogPricingMode,complete:specificationEvidenceComplete(enriched),status:priced.calculationStatus},fields:enriched.operational?.encyclopediaCalculation?.filledFields});
}
console.log('TARGET_CALCULATION_PROBE',JSON.stringify(report.targetOffers));
const lots=new Map();
for(let start=0;start<128;start+=8){const slots=await Promise.all(Array.from({length:8},(_,n)=>store.readJson(`catalog/partner-cache/ajes/queries/${start+n}.json`,null)));for(const slot of slots)for(const lot of slot?.value?.items||[])if(lot.table==='stats'&&(!lots.has(lot.id)||Date.parse(slot.value.observedAt)>Date.parse(lots.get(lot.id).observedAt)))lots.set(lot.id,{lot,observedAt:slot.value.observedAt});}
report.japanCache.uniqueLots=lots.size;
for(const {lot,observedAt} of lots.values()){try{const rate=await convertToRub(lot.finalPriceJpy,'JPY');if(!rate)throw Error('rate_missing');const offer=ajesOffer(lot,rate,observedAt);inspect(offer);report.japanCache.converted++;}catch{report.japanCache.rejected++;}}
if((await store.readJson('catalog/manifest.json',null))?.generationId!==snapshot.generationId)throw Error('catalog_changed');
if(Array.isArray(marker.researchModels)){
 const manifest=await store.readJson(MANIFEST,null);report.researchModels=[];
 for(const target of marker.researchModels.slice(0,16)){
  const summary=manifest.models.find(m=>modelKey(m.make,m.model)===modelKey(target.make,target.model));
  if(!summary){report.researchModels.push({...target,missing:true});continue;}
  const record=await store.readJson(summary.key,null);
  const variants=record.variants.filter(v=>target.years.includes(v.year)).slice(0,128).map(v=>({id:v.id,year:v.year,trim:v.trim,status:v.status,expectedDigest:digest(v),values:Object.fromEntries([...factFields,'chassisCode','generation'].filter(f=>v[f]!==undefined).map(f=>[f,v[f]]))}));
  report.researchModels.push({modelId:record.id,make:record.make,model:record.model,revision:record.revision,variants});
 }
 console.log('RESEARCH_MODEL_PROBE',JSON.stringify(report.researchModels));
}
await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/encyclopedia-spec-transfer.json',JSON.stringify(report,null,2));
console.log('SPEC_TRANSFER_AUDIT',JSON.stringify({...report,samples:report.samples.length}));

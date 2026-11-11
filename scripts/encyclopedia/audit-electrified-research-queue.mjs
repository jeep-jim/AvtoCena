import fs from 'node:fs/promises';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {MANIFEST} from '../../apps/web/lib/encyclopedia/records.ts';
import {checksum,modelKey,applyEncyclopediaCalculation} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
import {astraPower30Key,matchAstraPower30,astraPower30FactsForKey} from '../../apps/web/lib/encyclopedia/astra-power30.ts';
import {readCurrentPublicCatalogProjection} from '../../apps/web/lib/catalog/storage.ts';
import {classifySpecificationEvidence,SPECIFICATION_AUDIT_FIELDS} from '../../apps/web/lib/catalog/specification-evidence-audit.ts';
import {digest} from './research-batch.mjs';
const storage=getJsonStorage();if(storage.driver!=='object')throw Error('object_required');storage.writeJson=async()=>{throw Error('read_only');};
const marker=JSON.parse(await fs.readFile('.github/market-runs/power30-blockers.json','utf8'));
let indexDigest='11839d1317e7bf5cb55e82bd0cf044ca33e909dd3a28567fa4da47697191db42';
if(marker.previewIndexDigest){
 if(marker.inspectRelease||! /^[a-f0-9]{64}$/.test(marker.previewIndexDigest))throw Error('invalid_preview_index');
 indexDigest=marker.previewIndexDigest;
}
async function verifyActiveRelease(){
 if(!marker.inspectRelease)return;
 if(!/^[a-f0-9]{40}$/.test(marker.inspectRelease))throw Error('invalid_release');
 const response=await fetch('https://avtocena.com/api/health',{cache:'no-store',signal:AbortSignal.timeout(30000)});
 if(!response.ok||(await response.json()).releaseSha!==marker.inspectRelease)throw Error('release_not_active');
}
if(marker.inspectRelease){
 await verifyActiveRelease();
 const binding=await storage.readJson(`knowledge/encyclopedia/calculation-releases/${marker.inspectRelease}.json`,null);
 if(binding?.release!==marker.inspectRelease||! /^[a-f0-9]{64}$/.test(binding.digest)||binding.key!==`knowledge/encyclopedia/calculation-indexes/${binding.digest}.json`)throw Error('invalid_release_binding');
 indexDigest=binding.digest;
}
const index=await storage.readJson(`knowledge/encyclopedia/calculation-indexes/${indexDigest}.json`,null);if(index?.digest!==indexDigest||checksum(index.models)!==indexDigest)throw Error('index_checksum');
const manifest=await storage.readJson(MANIFEST,null),manifestDigest=checksum(manifest.models.map(x=>[x.id,x.revision,x.key]));
if(manifestDigest!==index.manifestDigest)throw Error('index_manifest_mismatch');
const annualIndex={...index,models:Object.fromEntries(Object.entries(index.models).filter(([k])=>!k.startsWith(astraPower30Key(''))))};
const projection=await readCurrentPublicCatalogProjection();
const groups=new Map(),totals={checked:0,withPower30:0,completeSpecifications:0,byFuel:{},blockedFields:{}};
const fields=['year','fuel','powertrainKind','engineCc','powerHp','powerKw','icePowerKw','motorPeakKw','drive','transmission','bodyType','engineCode','chassisCode','power30MinKw'];
const inc=(o,k)=>o[k]=(o[k]||0)+1;
for(const o of projection.rows){if(!['electric','hybrid'].includes(o.fuel))continue;totals.checked++;inc(totals.byFuel,o.fuel);
 const key=modelKey(o.make,o.model),g=groups.get(key)||{make:o.make,model:o.model,count:0,fuels:{},markets:{},reasons:{},blockedFields:{},examples:[],completeSpecifications:0,withPower30:0};groups.set(key,g);g.count++;inc(g.fuels,o.fuel);inc(g.markets,o.market);
 const a=applyEncyclopediaCalculation(o,annualIndex),result=applyEncyclopediaCalculation(o,index),match=matchAstraPower30(a,astraPower30FactsForKey(index.models,key));inc(g.reasons,match.reason);
 const blocked=SPECIFICATION_AUDIT_FIELDS.filter(f=>!['exact','not_applicable'].includes(classifySpecificationEvidence(result,f).state));
 if(!blocked.length){totals.completeSpecifications++;g.completeSpecifications++;}for(const f of blocked){inc(totals.blockedFields,f);inc(g.blockedFields,f);}
 if(result.power30MinKw>0){totals.withPower30++;g.withPower30++;}
 if(g.examples.length<3&&blocked.length&&o.market==='china')g.examples.push({before:Object.fromEntries(fields.filter(k=>o[k]!==undefined).map(k=>[k,o[k]])),after:Object.fromEntries(fields.filter(k=>result[k]!==undefined).map(k=>[k,result[k]])),blocked,reason:match.reason});
}
const sorted=[...groups.values()].sort((a,b)=>b.count-a.count);
const reasons={};for(const g of sorted)for(const [reason,count] of Object.entries(g.reasons))reasons[reason]=(reasons[reason]||0)+count;
const requested=new Set(['Baojun:Yueye Plus','Infiniti:QX60','BYD:SEAL','Zeekr:MIX','Mercedes-Benz:GLC','BMW:i4','BMW:iX1','BMW:iX3','Mercedes-Benz:C','Mercedes-Benz:E','Mercedes-Benz:S'].map(s=>{const [m,n]=s.split(':');return modelKey(m,n);}));
const selected=[...sorted.filter((g,i)=>i<20||requested.has(modelKey(g.make,g.model))),...['i4','iX1','iX3'].map(model=>({make:'BMW',model})),...['C','E','S'].map(model=>({make:'Mercedes-Benz',model}))],researchModels=[];
for(const g of selected){const summaries=manifest.models.filter(m=>modelKey(m.make,m.model)===modelKey(g.make,g.model));for(const s of summaries){const r=await storage.readJson(s.key,null);if(r?.revision!==s.revision)throw Error('revision_changed');
 const variants=(r.variants||[]).filter(v=>Number.isInteger(v.year)&&['electric','hybrid'].includes(v.fuel)).sort((a,b)=>b.year-a.year);
 researchModels.push({id:r.id,make:r.make,model:r.model,revision:r.revision,annualVariants:variants.length,rows:variants.slice(0,30).map(v=>({variantId:v.id,expectedDigest:digest(v),trim:v.trim,status:v.status,manualEdited:Boolean(v.manualEditedAt),...Object.fromEntries(fields.filter(k=>v[k]!==undefined).map(k=>[k,v[k]]))}))});}}
if(checksum((await storage.readJson(MANIFEST,null)).models.map(x=>[x.id,x.revision,x.key]))!==manifestDigest)throw Error('manifest_changed');
await verifyActiveRelease();
const report={version:1,checkedAt:new Date().toISOString(),release:marker.inspectRelease||null,indexDigest,manifestDigest,generationId:projection.generationId,totals,reasons,models:sorted.length,groups:sorted,researchModels,storageWrites:0};
await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/power30-blockers.json',JSON.stringify(report,null,2));
console.log('ELECTRIFIED_RESEARCH_TOTALS',JSON.stringify({...report,groups:undefined,researchModels:undefined}));
console.log('ELECTRIFIED_RESEARCH_GROUPS',JSON.stringify(sorted.slice(0,60)));
for(const r of researchModels)console.log('ELECTRIFIED_RESEARCH_MODEL',JSON.stringify(r));

for(const key of [modelKey('BYD','Dolphin'),modelKey('BYD','Han'),modelKey('Tesla','Model Y'),modelKey('Mercedes-Benz','C')]){const facts=index.models[astraPower30Key(key)]||[];const unique=[...new Map(facts.map(f=>[JSON.stringify([f.constraints,f.values]),f])).values()];console.log('ELECTRIFIED_REFERENCE_DETAIL',JSON.stringify({key,total:facts.length,rows:unique.slice(0,30)}));}

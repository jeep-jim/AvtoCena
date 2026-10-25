import fs from 'node:fs/promises';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {MANIFEST} from '../../apps/web/lib/encyclopedia/records.ts';
import {checksum,modelKey,applyEncyclopediaCalculation} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
import {astraPower30Key,matchAstraPower30} from '../../apps/web/lib/encyclopedia/astra-power30.ts';
import {readCurrentPublicCatalogProjection} from '../../apps/web/lib/catalog/storage.ts';
import {classifySpecificationEvidence,SPECIFICATION_AUDIT_FIELDS} from '../../apps/web/lib/catalog/specification-evidence-audit.ts';
import {digest} from './research-batch.mjs';
const storage=getJsonStorage();if(storage.driver!=='object')throw Error('object_required');storage.writeJson=async()=>{throw Error('read_only');};
const indexDigest='11839d1317e7bf5cb55e82bd0cf044ca33e909dd3a28567fa4da47697191db42';
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
 const a=applyEncyclopediaCalculation(o,annualIndex),result=applyEncyclopediaCalculation(o,index),match=matchAstraPower30(a,index.models[astraPower30Key(key)]||[]);inc(g.reasons,match.reason);
 const blocked=SPECIFICATION_AUDIT_FIELDS.filter(f=>!['exact','not_applicable'].includes(classifySpecificationEvidence(result,f).state));
 if(!blocked.length){totals.completeSpecifications++;g.completeSpecifications++;}for(const f of blocked){inc(totals.blockedFields,f);inc(g.blockedFields,f);}
 if(result.power30MinKw>0){totals.withPower30++;g.withPower30++;}
 if(g.examples.length<3&&blocked.length)g.examples.push({before:Object.fromEntries(fields.filter(k=>o[k]!==undefined).map(k=>[k,o[k]])),after:Object.fromEntries(fields.filter(k=>result[k]!==undefined).map(k=>[k,result[k]])),blocked,reason:match.reason});
}
const sorted=[...groups.values()].sort((a,b)=>b.count-a.count);
const requested=new Set(['Baojun:Yueye Plus','Infiniti:QX60','BYD:SEAL','Zeekr:MIX','Mercedes-Benz:GLC'].map(s=>{const [m,n]=s.split(':');return modelKey(m,n);}));
const selected=sorted.filter((g,i)=>i<20||requested.has(modelKey(g.make,g.model))),researchModels=[];
for(const g of selected){const summaries=manifest.models.filter(m=>modelKey(m.make,m.model)===modelKey(g.make,g.model));for(const s of summaries){const r=await storage.readJson(s.key,null);if(r?.revision!==s.revision)throw Error('revision_changed');
 const variants=(r.variants||[]).filter(v=>Number.isInteger(v.year)&&['electric','hybrid'].includes(v.fuel)).sort((a,b)=>b.year-a.year);
 researchModels.push({id:r.id,make:r.make,model:r.model,revision:r.revision,annualVariants:variants.length,rows:variants.slice(0,30).map(v=>({variantId:v.id,expectedDigest:digest(v),trim:v.trim,status:v.status,manualEdited:Boolean(v.manualEditedAt),...Object.fromEntries(fields.filter(k=>v[k]!==undefined).map(k=>[k,v[k]]))}))});}}
if(checksum((await storage.readJson(MANIFEST,null)).models.map(x=>[x.id,x.revision,x.key]))!==manifestDigest)throw Error('manifest_changed');
const report={version:1,checkedAt:new Date().toISOString(),indexDigest,manifestDigest,generationId:projection.generationId,totals,models:sorted.length,groups:sorted,researchModels,storageWrites:0};
await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/power30-blockers.json',JSON.stringify(report,null,2));
console.log('ELECTRIFIED_RESEARCH_TOTALS',JSON.stringify({...report,groups:undefined,researchModels:undefined}));
console.log('ELECTRIFIED_RESEARCH_GROUPS',JSON.stringify(sorted.slice(0,60)));
for(const r of researchModels)console.log('ELECTRIFIED_RESEARCH_MODEL',JSON.stringify(r));
